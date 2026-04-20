import { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import { loadConfig, saveConfig, getConfigDir, CONFIG_FILE_PATH } from '../config.js';
import { getDatabase } from '../storage/database.js';
import { seedBuiltinRoles } from '../roles/library.js';
import { WorkflowEngine } from '../workflow/engine.js';
import { summarizeCampaign } from '../summarizer/campaign.js';
import { startMcpServer } from '../mcp/server.js';

const ansi = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

const program = new Command();

program
  .name('agent-forge')
  .description('MCP-first multi-agent orchestration platform')
  .version('0.1.0');

// ── mcp ─────────────────────────────────────────────────────────────────────

program
  .command('mcp')
  .description('Start the MCP server on stdio (for Cursor / Claude Code integration)')
  .action(async () => {
    await startMcpServer();
  });

// ── init ─────────────────────────────────────────────────────────────────────

program
  .command('init')
  .description('Bootstrap config and seed builtin roles in the database')
  .action(() => {
    const configDir = getConfigDir();
    mkdirSync(configDir, { recursive: true });

    if (!existsSync(CONFIG_FILE_PATH)) {
      const defaults = {
        llm: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          apiKey: process.env.ANTHROPIC_API_KEY ?? 'SET_YOUR_API_KEY',
        },
        spawner: { mode: 'sdk', fallbackToCli: true },
        server: { port: 3000 },
        playwright: {
          browser: 'chromium',
          screenshotDir: join(configDir, 'screenshots'),
        },
      };
      writeFileSync(CONFIG_FILE_PATH, JSON.stringify(defaults, null, 2), 'utf8');
      console.log(`${ansi.green}Created${ansi.reset} ${CONFIG_FILE_PATH}`);
    } else {
      console.log(`${ansi.dim}Config already exists:${ansi.reset} ${CONFIG_FILE_PATH}`);
    }

    const db = getDatabase();
    db.init();
    seedBuiltinRoles(db);
    db.close();
    console.log(`${ansi.green}Seeded${ansi.reset} builtin roles: product, developer, tester`);
    console.log(`\n${ansi.bold}Next steps:${ansi.reset}`);
    console.log(`  1. Edit ${ansi.cyan}${CONFIG_FILE_PATH}${ansi.reset} and set your API key`);
    console.log(`  2. Add to Claude Code: ${ansi.cyan}claude mcp add agent-forge -- node /path/to/dist/mcp/server.js${ansi.reset}`);
    console.log(`  3. Or add to Cursor's mcp.json`);
  });

// ── workflow ──────────────────────────────────────────────────────────────────

program
  .command('workflow')
  .description('Workflow management commands')
  .addCommand(
    new Command('start')
      .description('Start a new vibe coding campaign')
      .argument('<projectPath>', 'Absolute path to the project')
      .argument('<title>', 'Campaign title')
      .option('-b, --brief <text>', 'Initial requirement brief')
      .action((projectPath: string, title: string, opts: { brief?: string }) => {
        const db = getDatabase();
        db.init();
        seedBuiltinRoles(db);
        const engine = new WorkflowEngine(db);
        const campaign = engine.initWorkflow(projectPath, title, opts.brief);
        console.log(`${ansi.green}Campaign started${ansi.reset}`);
        console.log(`  ID:    ${ansi.cyan}${campaign.id}${ansi.reset}`);
        console.log(`  Title: ${campaign.title}`);
        if (campaign.brief) console.log(`  Brief: ${ansi.dim}${campaign.brief}${ansi.reset}`);
        db.close();
      }),
  )
  .addCommand(
    new Command('list')
      .description('List all campaigns')
      .action(() => {
        const db = getDatabase();
        db.init();
        const campaigns = db.listCampaigns();
        db.close();
        if (campaigns.length === 0) {
          console.log(`${ansi.dim}No campaigns yet. Run: agent-forge workflow start <path> <title>${ansi.reset}`);
          return;
        }
        for (const c of campaigns) {
          const statusColor = c.status === 'active' ? ansi.green : ansi.dim;
          console.log(`${ansi.bold}${c.title}${ansi.reset} ${ansi.dim}(${c.id})${ansi.reset}`);
          console.log(`  Status: ${statusColor}${c.status}${ansi.reset}  Started: ${ansi.dim}${c.startedAt}${ansi.reset}`);
          if (c.brief) console.log(`  Brief:  ${ansi.dim}${c.brief.slice(0, 100)}${ansi.reset}`);
        }
      }),
  )
  .addCommand(
    new Command('status')
      .description('Show active cycle and tasks for a campaign')
      .argument('<campaignId>')
      .action((campaignId: string) => {
        const db = getDatabase();
        db.init();
        const engine = new WorkflowEngine(db);
        const state = engine.getCycleState(undefined, campaignId);
        db.close();
        if (!state) {
          console.log(`${ansi.yellow}No active cycle${ansi.reset} for campaign ${campaignId}`);
          return;
        }
        const { cycle, tasks } = state;
        console.log(`${ansi.bold}Cycle ${cycle.cycleNum}${ansi.reset} — status: ${ansi.cyan}${cycle.status}${ansi.reset}`);
        if (cycle.productBrief) {
          console.log(`${ansi.dim}Product brief: ${cycle.productBrief.slice(0, 200)}${ansi.reset}`);
        }
        const devTasks = tasks.filter((t) => t.role === 'dev');
        const testTasks = tasks.filter((t) => t.role === 'test');
        if (devTasks.length) {
          console.log(`\n${ansi.bold}Dev tasks (${devTasks.length}):${ansi.reset}`);
          for (const t of devTasks) {
            const icon = t.status === 'completed' ? '✓' : t.status === 'failed' ? '✗' : '○';
            console.log(`  ${icon} ${t.title} ${ansi.dim}[${t.status}]${ansi.reset}`);
          }
        }
        if (testTasks.length) {
          console.log(`\n${ansi.bold}Test tasks (${testTasks.length}):${ansi.reset}`);
          for (const t of testTasks) {
            const icon = t.status === 'completed' ? '✓' : t.status === 'failed' ? '✗' : '○';
            console.log(`  ${icon} ${t.title} ${ansi.dim}[${t.status}]${ansi.reset}`);
          }
        }
      }),
  );

// ── roles ─────────────────────────────────────────────────────────────────────

program
  .command('roles')
  .description('List all agent roles')
  .action(() => {
    const db = getDatabase();
    db.init();
    seedBuiltinRoles(db);
    const roles = db.listRoles();
    db.close();
    if (roles.length === 0) {
      console.log(`${ansi.dim}No roles. Run: agent-forge init${ansi.reset}`);
      return;
    }
    for (const r of roles) {
      const tag = r.isBuiltin ? `${ansi.dim}[builtin]${ansi.reset}` : `${ansi.green}[custom]${ansi.reset}`;
      console.log(`${ansi.cyan}${r.id}${ansi.reset} ${tag} — ${r.name}`);
      if (r.docPath) console.log(`  ${ansi.dim}doc: ${r.docPath}${ansi.reset}`);
    }
  });

// ── campaign ──────────────────────────────────────────────────────────────────

program
  .command('campaign')
  .description('Campaign summary commands')
  .addCommand(
    new Command('summarize')
      .description('Generate a cross-cycle campaign summary (why, what, evolution)')
      .argument('<campaignId>')
      .action(async (campaignId: string) => {
        const config = loadConfig();
        if (!config.llm.apiKey || config.llm.apiKey === 'SET_YOUR_API_KEY') {
          console.error(`${ansi.red}Error:${ansi.reset} Set llm.apiKey in ${CONFIG_FILE_PATH}`);
          process.exitCode = 1;
          return;
        }
        const db = getDatabase();
        db.init();
        console.log(`${ansi.dim}Summarizing campaign ${campaignId}…${ansi.reset}`);
        try {
          const summary = await summarizeCampaign(db, campaignId, config);
          console.log(`\n${ansi.bold}=== WHY ===${ansi.reset}\n${summary.why}`);
          console.log(`\n${ansi.bold}=== KEY DECISIONS ===${ansi.reset}`);
          for (const d of summary.keyDecisions) console.log(`  • ${d}`);
          console.log(`\n${ansi.bold}=== OVERALL PATH ===${ansi.reset}\n${summary.overallPath}`);
        } finally {
          db.close();
        }
      }),
  );

program.parse();
