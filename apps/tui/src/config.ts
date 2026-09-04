import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface AppConfig {
  version?: number;
  spotify?: {
    clientId?: string;
    redirectPort?: number;
  };
  playback?: {
    volume?: number;
    autoplay?: boolean;
  };
}

export const KEYMASTER_CLIENT_ID = '65b708073fc0480ea92a077233ca87bd';
export const KEYMASTER_REDIRECT_PORT = 8898;
export const DEFAULT_REDIRECT_PORT = 8989;

export function resolveRedirectPort(): number {
  if (process.env.SPOTOEI_REDIRECT_PORT) {
    const parsed = Number.parseInt(process.env.SPOTOEI_REDIRECT_PORT.trim(), 10);
    if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 65535) {
      return parsed;
    }
  }

  const configPath = getConfigPath();
  try {
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(content) as AppConfig;
      if (typeof parsed?.spotify?.redirectPort === 'number') {
        return parsed.spotify.redirectPort;
      }
    }
  } catch {
    // ignore
  }

  const cRes = resolveClientId();
  if (cRes.clientId === KEYMASTER_CLIENT_ID) {
    return KEYMASTER_REDIRECT_PORT;
  }

  return DEFAULT_REDIRECT_PORT;
}

export function getRedirectUri(port?: number): string {
  const p = port ?? resolveRedirectPort();
  const cRes = resolveClientId();
  if (cRes.clientId === KEYMASTER_CLIENT_ID && p === KEYMASTER_REDIRECT_PORT) {
    return `http://127.0.0.1:${p}/login`;
  }
  return `http://127.0.0.1:${p}/callback`;
}

export function getConfigDir(): string {
  const platform = process.platform;
  if (process.env.SPOTOEI_CONFIG_DIR) {
    return process.env.SPOTOEI_CONFIG_DIR;
  }
  if (process.env.XDG_CONFIG_HOME) {
    return join(process.env.XDG_CONFIG_HOME, 'spotoei');
  }
  const home = homedir();
  if (platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'spotoei');
  }
  if (platform === 'win32') {
    return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'spotoei');
  }
  return join(home, '.config', 'spotoei');
}

export function getCacheDir(): string {
  if (process.env.SPOTOEI_CACHE_DIR) {
    return process.env.SPOTOEI_CACHE_DIR;
  }
  const platform = process.platform;
  if (process.env.XDG_CACHE_HOME) {
    return join(process.env.XDG_CACHE_HOME, 'spotoei');
  }
  const home = homedir();
  if (platform === 'darwin') {
    return join(home, 'Library', 'Caches', 'spotoei');
  }
  if (platform === 'win32') {
    return join(process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'spotoei');
  }
  return join(home, '.cache', 'spotoei');
}

export function getConfigPath(): string {
  return join(getConfigDir(), 'config.json');
}

export function getLogPath(): string {
  if (process.env.SPOTOEI_LOG_FILE) {
    return process.env.SPOTOEI_LOG_FILE;
  }
  return join(getConfigDir(), 'spotoei.log');
}

// Hand-rolled validator for `config.json`. Reject malformed configs and fall
// back to defaults. Adding a runtime dep just for this is overkill.
function isValidConfig(value: unknown): value is AppConfig {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if ('version' in v && typeof v.version !== 'number') return false;
  if ('spotify' in v) {
    const s = v.spotify;
    if (s === null || typeof s !== 'object') return false;
    const sr = s as Record<string, unknown>;
    if ('clientId' in sr && typeof sr.clientId !== 'string') return false;
    if ('redirectPort' in sr) {
      if (typeof sr.redirectPort !== 'number') return false;
      if (!Number.isInteger(sr.redirectPort)) return false;
      if (sr.redirectPort < 0 || sr.redirectPort > 65535) return false;
    }
  }
  if ('playback' in v) {
    const p = v.playback;
    if (p === null || typeof p !== 'object') return false;
    const pr = p as Record<string, unknown>;
    if ('volume' in pr && (typeof pr.volume !== 'number' || pr.volume < 0 || pr.volume > 100))
      return false;
    if ('autoplay' in pr && typeof pr.autoplay !== 'boolean') return false;
  }
  return true;
}

export function readValidConfig(path: string = getConfigPath()): AppConfig {
  try {
    if (!existsSync(path)) return {};
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!isValidConfig(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}
function parseEnvFile(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

export interface ClientIdResolution {
  clientId?: string;
  source: 'env' | 'dotenv' | 'config' | 'default' | 'none';
  configPath: string;
}

export function resolveClientId(allowDefault = false): ClientIdResolution {
  const configPath = getConfigPath();

  // 1. Explicit environment variable
  if (process.env.SPOTOEI_CLIENT_ID && process.env.SPOTOEI_CLIENT_ID.trim().length > 0) {
    return {
      clientId: process.env.SPOTOEI_CLIENT_ID.trim(),
      source: 'env',
      configPath,
    };
  }

  // 2. .env or .env.local in cwd
  for (const dotenvFile of ['.env.local', '.env']) {
    try {
      const dotenvPath = join(process.cwd(), dotenvFile);
      if (existsSync(dotenvPath)) {
        const parsed = parseEnvFile(readFileSync(dotenvPath, 'utf8'));
        if (parsed.SPOTOEI_CLIENT_ID && parsed.SPOTOEI_CLIENT_ID.trim().length > 0) {
          const id = parsed.SPOTOEI_CLIENT_ID.trim();
          process.env.SPOTOEI_CLIENT_ID = id;
          return { clientId: id, source: 'dotenv', configPath };
        }
      }
    } catch {
      // ignore
    }
  }

  // 3. User config.json
  try {
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, 'utf8');
      const json = JSON.parse(content) as AppConfig;
      const id = json.spotify?.clientId?.trim();
      if (id && id.length > 0) {
        process.env.SPOTOEI_CLIENT_ID = id;
        return { clientId: id, source: 'config', configPath };
      }
    }
  } catch {
    // ignore
  }

  if (allowDefault) {
    return { clientId: KEYMASTER_CLIENT_ID, source: 'default', configPath };
  }

  return { source: 'none', configPath };
}

export function saveClientId(rawId: string): ClientIdResolution {
  const clientId = rawId.trim();
  const dir = getConfigDir();
  const configPath = getConfigPath();

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  let config: AppConfig = { version: 1 };
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, 'utf8')) as AppConfig;
    } catch {
      config = { version: 1 };
    }
  }

  config.version = config.version ?? 1;
  config.spotify = {
    ...config.spotify,
    clientId,
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  process.env.SPOTOEI_CLIENT_ID = clientId;

  return {
    clientId,
    source: 'config',
    configPath,
  };
}

export function saveRedirectPort(port: number): { port: number; configPath: string } {
  const dir = getConfigDir();
  const configPath = getConfigPath();

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  let config: AppConfig = { version: 1 };
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, 'utf8')) as AppConfig;
    } catch {
      config = { version: 1 };
    }
  }

  config.version = config.version ?? 1;
  config.spotify = {
    ...config.spotify,
    redirectPort: port,
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  process.env.SPOTOEI_REDIRECT_PORT = String(port);

  return {
    port,
    configPath,
  };
}

export function logToFile(message: string): void {
  try {
    const logPath = getLogPath();
    const timestamp = new Date().toISOString();
    appendFileSync(logPath, `[${timestamp}] ${message}\n`, 'utf8');
  } catch {
    // Ignore file write errors
  }
}
