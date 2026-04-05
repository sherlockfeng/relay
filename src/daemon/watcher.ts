import { EventEmitter } from 'node:events';
import { homedir } from 'node:os';
import { join } from 'node:path';

import chokidar, { type FSWatcher } from 'chokidar';

import type { AppConfig } from '../config.js';
import type { Platform } from '../types/index.js';

/** Default transcript roots: `~/.cursor`, `~/.claude`, `~/.codex`. */
export function getPlatformBaseDirs(): Record<Platform, string> {
  const home = homedir();
  return {
    cursor: join(home, '.cursor'),
    'claude-code': join(home, '.claude'),
    codex: join(home, '.codex'),
  };
}

export interface TranscriptFilePayload {
  filePath: string;
  platform: Platform;
}

export class TranscriptWatcher extends EventEmitter {
  private readonly config: AppConfig;
  private watchers: FSWatcher[] = [];
  private running = false;

  constructor(config: AppConfig) {
    super();
    this.config = config;
  }

  private buildGlobs(): { pattern: string; platform: Platform }[] {
    const { platforms } = this.config;
    const roots = getPlatformBaseDirs();
    const globs: { pattern: string; platform: Platform }[] = [];

    if (platforms.cursor) {
      globs.push({
        pattern: join(roots.cursor, 'projects', '*', 'agent-transcripts', '**', '*.jsonl'),
        platform: 'cursor',
      });
    }
    if (platforms['claude-code']) {
      globs.push({
        pattern: join(roots['claude-code'], 'projects', '*', '*.jsonl'),
        platform: 'claude-code',
      });
    }
    if (platforms.codex) {
      globs.push({
        pattern: join(roots.codex, 'sessions', '**', '*.jsonl'),
        platform: 'codex',
      });
    }

    return globs;
  }

  /** Infer platform from an absolute file path. */
  static detectPlatformFromPath(filePath: string): Platform | null {
    const normalized = filePath.replace(/\\/g, '/');
    const roots = getPlatformBaseDirs();
    const entries: [Platform, string][] = [
      ['cursor', roots.cursor.replace(/\\/g, '/')],
      ['claude-code', roots['claude-code'].replace(/\\/g, '/')],
      ['codex', roots.codex.replace(/\\/g, '/')],
    ];
    for (const [platform, base] of entries) {
      if (normalized.startsWith(base)) {
        return platform;
      }
    }
    return null;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;

    const globs = this.buildGlobs();
    for (const { pattern, platform } of globs) {
      const w = chokidar.watch(pattern, {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
      });

      w.on('add', (filePath: string) => {
        const payload: TranscriptFilePayload = { filePath, platform };
        this.emit('new-session', payload);
        this.emit('file-path', payload);
      });

      w.on('change', (filePath: string) => {
        const payload: TranscriptFilePayload = { filePath, platform };
        this.emit('session-changed', payload);
        this.emit('file-path', payload);
      });

      this.watchers.push(w);
    }
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    this.running = false;
    await Promise.all(this.watchers.map((w) => w.close()));
    this.watchers = [];
  }
}
