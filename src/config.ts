import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface AppConfig {
  llm: {
    provider: 'anthropic' | 'openai';
    model: string;
    apiKey: string;
    embeddingModel?: string;
  };
  cursor?: {
    apiKey: string;
    model: string;
    workspacePath: string;
  };
  spawner: {
    mode: 'sdk' | 'cli';
    fallbackToCli: boolean;
  };
  server: {
    port: number;
  };
  playwright: {
    browser: 'chromium' | 'firefox' | 'webkit';
    screenshotDir: string;
  };
}

const CONFIG_DIR = join(homedir(), '.relay');
export const CONFIG_FILE_PATH = join(CONFIG_DIR, 'config.json');

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getDefaultConfig(): AppConfig {
  return {
    llm: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    },
    cursor: {
      apiKey: process.env.CURSOR_API_KEY ?? '',
      model: 'composer-2',
      workspacePath: process.cwd(),
    },
    spawner: {
      mode: 'sdk',
      fallbackToCli: true,
    },
    server: {
      port: 3000,
    },
    playwright: {
      browser: 'chromium',
      screenshotDir: join(homedir(), '.relay', 'screenshots'),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeConfig(base: AppConfig, partial: unknown): AppConfig {
  if (!isRecord(partial)) return base;
  const out: AppConfig = structuredClone(base);

  if (isRecord(partial.llm)) {
    const llm = partial.llm;
    if (llm.provider === 'anthropic' || llm.provider === 'openai') out.llm.provider = llm.provider;
    if (typeof llm.model === 'string') out.llm.model = llm.model;
    if (typeof llm.apiKey === 'string') out.llm.apiKey = llm.apiKey;
    if (typeof llm.embeddingModel === 'string') out.llm.embeddingModel = llm.embeddingModel;
  }

  if (isRecord(partial.cursor)) {
    const cursor = partial.cursor;
    out.cursor ??= { apiKey: process.env.CURSOR_API_KEY ?? '', model: 'composer-2', workspacePath: process.cwd() };
    if (typeof cursor.apiKey === 'string') out.cursor.apiKey = cursor.apiKey;
    if (typeof cursor.model === 'string') out.cursor.model = cursor.model;
    if (typeof cursor.workspacePath === 'string') out.cursor.workspacePath = cursor.workspacePath;
  }

  if (isRecord(partial.spawner)) {
    const s = partial.spawner;
    if (s.mode === 'sdk' || s.mode === 'cli') out.spawner.mode = s.mode;
    if (typeof s.fallbackToCli === 'boolean') out.spawner.fallbackToCli = s.fallbackToCli;
  }

  if (isRecord(partial.server) && typeof partial.server.port === 'number') {
    out.server.port = partial.server.port;
  }

  if (isRecord(partial.playwright)) {
    const p = partial.playwright;
    if (p.browser === 'chromium' || p.browser === 'firefox' || p.browser === 'webkit') {
      out.playwright.browser = p.browser;
    }
    if (typeof p.screenshotDir === 'string') out.playwright.screenshotDir = p.screenshotDir;
  }

  return out;
}

export function loadConfig(): AppConfig {
  const defaults = getDefaultConfig();
  if (!existsSync(CONFIG_FILE_PATH)) return defaults;
  try {
    const raw = readFileSync(CONFIG_FILE_PATH, 'utf8');
    return mergeConfig(defaults, JSON.parse(raw) as unknown);
  } catch {
    return defaults;
  }
}

export function saveConfig(config: AppConfig): void {
  const dir = dirname(CONFIG_FILE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CONFIG_FILE_PATH, JSON.stringify(config, null, 2), 'utf8');
}
