import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { platform } from 'node:os';
import { join } from 'node:path';

import { Command } from 'commander';

import { createApiServer } from '../api/server.js';
import { loadConfig, getConfigDir } from '../config.js';
import { Daemon } from '../daemon/index.js';
import { summarizeSession } from '../summarizer/index.js';
import { ChatDigestDB } from '../storage/database.js';
import { searchSummaries } from '../storage/search.js';
import type { AppConfig } from '../config.js';
import type { Platform, StoredSummary } from '../types/index.js';

const ansi = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function pidFilePath(): string {
  return join(getConfigDir(), 'ai-chat-digest.pid');
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(): number | undefined {
  const path = pidFilePath();
  if (!existsSync(path)) {
    return undefined;
  }
  const raw = readFileSync(path, 'utf8').trim();
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function writePid(): void {
  writeFileSync(pidFilePath(), `${process.pid}\n`, 'utf8');
}

function removePidFile(): void {
  try {
    unlinkSync(pidFilePath());
  } catch {
    /* ignore */
  }
}

async function insertSummarizationResult(
  db: ChatDigestDB,
  config: AppConfig,
  sessionId: string,
  transcriptPath: string,
  plat: Platform,
): Promise<void> {
  const result = await summarizeSession({
    transcriptPath,
    platform: plat,
    config,
  });
  if (!result) {
    console.log(`${ansi.dim}Skipped (no result)${ansi.reset} ${sessionId}`);
    return;
  }
  const now = new Date().toISOString();
  const summary: StoredSummary = {
    id: randomUUID(),
    sessionId,
    title: result.title,
    topics: [],
    tags: result.tags,
    contextProvided: {
      internalTools: [],
      internalDefinitions: [],
      externalResources: [],
    },
    discussionProcess: [],
    problemsDiscovered: [],
    decidedSolutions: [],
    domainKnowledge: {},
    rawSummary: '',
    createdAt: now,
    modelUsed: config.llm.model,
  };
  db.insertSummary(summary);
  db.markSummarized(sessionId);
  console.log(`${ansi.green}Summarized${ansi.reset} ${sessionId} — ${result.title}`);
}

function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1 || n > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return n;
}

const program = new Command();

program.name('ai-chat-digest').description('AI chat digest — daemon, API, and CLI').version('0.1.0');

program
  .command('start')
  .description('Start daemon and API server (foreground)')
  .option('-p, --port <port>', 'HTTP port (overrides config)')
  .action(async (opts: { port?: string }) => {
    const config = loadConfig();
    const port = parsePort(opts.port, config.server.port);
    const db = new ChatDigestDB();
    db.init();
    const daemon = new Daemon(config);
    const { httpServer, wss } = createApiServer(db, port);

    const shutdown = async (signal: string) => {
      console.log(`\n${ansi.yellow}${signal}${ansi.reset} shutting down…`);
      removePidFile();
      await daemon.stop();
      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
      httpServer.close(() => {
        db.close();
        process.exit(0);
      });
    };

    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));

    httpServer.listen(port, () => {
      writePid();
      daemon.start();
      console.log(
        `${ansi.green}${ansi.bold}ai-chat-digest${ansi.reset} ${ansi.dim}listening on${ansi.reset} ${ansi.cyan}http://127.0.0.1:${port}${ansi.reset}`,
      );
      console.log(`${ansi.dim}PID ${process.pid} → ${pidFilePath()}${ansi.reset}`);
    });
  });

program
  .command('stop')
  .description('Stop a running instance (via PID file)')
  .action(() => {
    const pid = readPid();
    if (pid === undefined) {
      console.log(`${ansi.yellow}Not running${ansi.reset} (no PID file)`);
      return;
    }
    if (!isProcessRunning(pid)) {
      console.log(`${ansi.yellow}Stale PID file${ansi.reset} (${pid})`);
      removePidFile();
      return;
    }
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`${ansi.green}Sent SIGTERM${ansi.reset} to ${pid}`);
    } catch (e) {
      console.log(`${ansi.red}Failed to stop${ansi.reset}`, e);
    }
    removePidFile();
  });

program
  .command('status')
  .description('Show whether the service is running and list active sessions from the database')
  .action(() => {
    const pid = readPid();
    const running = pid !== undefined && isProcessRunning(pid);
    if (running) {
      console.log(`${ansi.green}Running${ansi.reset} (pid ${pid})`);
    } else {
      if (pid !== undefined) {
        console.log(`${ansi.yellow}Stale PID${ansi.reset} (${pid})`);
        removePidFile();
      } else {
        console.log(`${ansi.dim}Not running${ansi.reset}`);
      }
    }
    const db = new ChatDigestDB();
    db.init();
    const active = db.listSessions({ status: 'active' });
    console.log(`${ansi.bold}Active sessions (DB)${ansi.reset}: ${active.length}`);
    for (const s of active) {
      console.log(`  ${ansi.cyan}${s.id}${ansi.reset} ${ansi.dim}${s.platform}${ansi.reset} msgs=${s.messageCount}`);
    }
    db.close();
  });

program
  .command('summarize')
  .description('Manually run summarization for a session (or all completed, unsummarized)')
  .argument('[sessionId]', 'Session id (omit to process all eligible)')
  .action(async (sessionId: string | undefined) => {
    const config = loadConfig();
    const db = new ChatDigestDB();
    db.init();
    try {
      if (sessionId) {
        const session = db.getSession(sessionId);
        if (!session) {
          console.log(`${ansi.red}Unknown session${ansi.reset} ${sessionId}`);
          process.exitCode = 1;
          return;
        }
        await insertSummarizationResult(
          db,
          config,
          session.id,
          session.transcriptPath,
          session.platform,
        );
        return;
      }
      const candidates = db.listSessions().filter((s) => !s.summarized && s.status === 'completed');
      if (candidates.length === 0) {
        console.log(`${ansi.dim}No completed unsummarized sessions.${ansi.reset}`);
        return;
      }
      for (const s of candidates) {
        await insertSummarizationResult(db, config, s.id, s.transcriptPath, s.platform);
      }
    } finally {
      db.close();
    }
  });

program
  .command('search')
  .description('Search stored summaries (FTS)')
  .argument('<query>', 'Search query')
  .option('-l, --limit <n>', 'Max results', '20')
  .action((query: string, opts: { limit?: string }) => {
    const limit = Number.parseInt(opts.limit ?? '20', 10) || 20;
    const db = new ChatDigestDB();
    db.init();
    try {
      const hits = searchSummaries(db, query, { limit });
      if (hits.length === 0) {
        console.log(`${ansi.dim}No results.${ansi.reset}`);
        return;
      }
      for (const h of hits) {
        console.log(`${ansi.bold}${h.title}${ansi.reset} ${ansi.dim}(${h.id})${ansi.reset}`);
        console.log(`  ${ansi.cyan}session${ansi.reset} ${h.sessionId}  ${ansi.dim}${h.tags.join(', ')}${ansi.reset}`);
      }
    } finally {
      db.close();
    }
  });

program
  .command('tags')
  .description('List all tags with usage counts')
  .action(() => {
    const db = new ChatDigestDB();
    db.init();
    try {
      const tags = db.listTags();
      if (tags.length === 0) {
        console.log(`${ansi.dim}No tags.${ansi.reset}`);
        return;
      }
      for (const t of tags) {
        const c = t.count ?? 0;
        console.log(`${ansi.cyan}${t.name}${ansi.reset} ${ansi.dim}(${c})${ansi.reset}`);
      }
    } finally {
      db.close();
    }
  });

program
  .command('open')
  .description('Open the dashboard in a browser')
  .option('-p, --port <port>', 'HTTP port (overrides config)')
  .action((opts: { port?: string }) => {
    const config = loadConfig();
    const port = parsePort(opts.port, config.server.port);
    const url = `http://127.0.0.1:${port}`;
    const os = platform();
    const cmd =
      os === 'darwin' ? 'open' : os === 'win32' ? 'cmd' : 'xdg-open';
    const args = os === 'win32' ? ['/c', 'start', '""', url] : [url];
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.unref();
    console.log(`${ansi.green}Opening${ansi.reset} ${url}`);
  });

program.parse();
