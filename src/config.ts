import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface AppConfig {
  llm: {
    provider: string;
    model: string;
    apiKey: string;
  };
  platforms: {
    cursor: boolean;
    'claude-code': boolean;
    codex: boolean;
  };
  server: {
    port: number;
  };
  notifications: {
    enabled: boolean;
  };
}

const CONFIG_DIR = join(homedir(), '.ai-chat-digest');
export const CONFIG_FILE_PATH = join(CONFIG_DIR, 'config.json');

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getDefaultConfig(): AppConfig {
  return {
    llm: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: '',
    },
    platforms: {
      cursor: true,
      'claude-code': true,
      codex: true,
    },
    server: {
      port: 3000,
    },
    notifications: {
      enabled: true,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeConfig(base: AppConfig, partial: unknown): AppConfig {
  if (!isRecord(partial)) {
    return base;
  }

  const out: AppConfig = structuredClone(base);

  if (isRecord(partial.llm)) {
    const llm = partial.llm;
    if (typeof llm.provider === 'string') out.llm.provider = llm.provider;
    if (typeof llm.model === 'string') out.llm.model = llm.model;
    if (typeof llm.apiKey === 'string') out.llm.apiKey = llm.apiKey;
  }

  if (isRecord(partial.platforms)) {
    const p = partial.platforms;
    if (typeof p.cursor === 'boolean') out.platforms.cursor = p.cursor;
    if (typeof p['claude-code'] === 'boolean') out.platforms['claude-code'] = p['claude-code'];
    if (typeof p.codex === 'boolean') out.platforms.codex = p.codex;
  }

  if (isRecord(partial.server) && typeof partial.server.port === 'number') {
    out.server.port = partial.server.port;
  }

  if (isRecord(partial.notifications) && typeof partial.notifications.enabled === 'boolean') {
    out.notifications.enabled = partial.notifications.enabled;
  }

  return out;
}

export function loadConfig(): AppConfig {
  const defaults = getDefaultConfig();
  if (!existsSync(CONFIG_FILE_PATH)) {
    return defaults;
  }
  try {
    const raw = readFileSync(CONFIG_FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return mergeConfig(defaults, parsed);
  } catch {
    return defaults;
  }
}

export function saveConfig(config: AppConfig): void {
  const dir = dirname(CONFIG_FILE_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(CONFIG_FILE_PATH, JSON.stringify(config, null, 2), 'utf8');
}
