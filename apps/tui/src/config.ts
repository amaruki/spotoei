import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { BrowseConfigT } from 'spotoei-protocol';
import { DEFAULT_BROWSE_CONFIG } from './browse';
import { isValidBrowse } from './browseConfigValidator';
import { resolveClientId } from './configClient';
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
  browse?: BrowseConfigT;
}

export const DEFAULT_BROWSE: BrowseConfigT = DEFAULT_BROWSE_CONFIG;

export const KEYMASTER_CLIENT_ID = '65b708073fc0480ea92a077233ca87bd';
export const NCSPOT_CLIENT_ID = 'd420a117a32841c2b3474932e49fb54b';
export const DEFAULT_CLIENT_ID = KEYMASTER_CLIENT_ID;
export const KEYMASTER_REDIRECT_PORT = 8989;
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

  return DEFAULT_REDIRECT_PORT; // 8989
}

export function getRedirectUri(port?: number): string {
  const p = port ?? resolveRedirectPort();
  const cRes = resolveClientId();
  if ((cRes.clientId === NCSPOT_CLIENT_ID || cRes.clientId === KEYMASTER_CLIENT_ID) && (p === 8989 || p === 8898)) {
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
  if ('browse' in v && !isValidBrowse(v.browse)) return false;
  return true;
}

export function getBrowseConfig(config: AppConfig = readValidConfig()): BrowseConfigT {
  return config.browse ?? DEFAULT_BROWSE_CONFIG;
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

export { resolveClientId, saveClientId, saveRedirectPort } from './configClient';
export type { ClientIdResolution } from './configClient';
export const MAX_LOG_SIZE_BYTES = 2 * 1024 * 1024; // 2 MiB
let logWriteCounter = 0;

export function rotateLogIfNeeded(logPath: string, maxSize = MAX_LOG_SIZE_BYTES): void {
  try {
    if (!existsSync(logPath)) return;
    const stats = statSync(logPath);
    if (stats.size >= maxSize) {
      const backupPath = `${logPath}.1`;
      try {
        renameSync(logPath, backupPath);
      } catch {
        // Fallback truncation if rename is blocked by lock
        writeFileSync(logPath, '', 'utf8');
      }
    }
  } catch {
    // Ignore rotation check errors
  }
}

export function logToFile(message: string): void {
  try {
    const logPath = getLogPath();
    mkdirSync(dirname(logPath), { recursive: true });
    if (logWriteCounter === 0) {
      rotateLogIfNeeded(logPath);
    }
    logWriteCounter = (logWriteCounter + 1) % 100;
    const timestamp = new Date().toISOString();
    appendFileSync(logPath, `[${timestamp}] ${message}\n`, 'utf8');
  } catch {
    // Ignore file write errors
  }
}
