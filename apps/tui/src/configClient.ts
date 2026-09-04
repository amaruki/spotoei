// Helpers for resolving and updating Spotify Client ID and redirect ports in user configs.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppConfig } from './config';
import { getConfigDir, getConfigPath, KEYMASTER_CLIENT_ID, readValidConfig } from './config';

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
  const cleanId = rawId.trim();
  const configPath = getConfigPath();
  const configDir = getConfigDir();

  if (!/^[0-9a-f]{32}$/i.test(cleanId)) {
    throw new Error('Spotify Client ID must be 32 hex characters (found in Spotify Dashboard)');
  }

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  let currentConfig: AppConfig = {};
  if (existsSync(configPath)) {
    try {
      currentConfig = readValidConfig(configPath);
    } catch {
      currentConfig = {};
    }
  }

  const updatedConfig: AppConfig = {
    ...currentConfig,
    spotify: {
      ...currentConfig.spotify,
      clientId: cleanId,
    },
  };

  writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2), 'utf8');
  process.env.SPOTOEI_CLIENT_ID = cleanId;

  return {
    clientId: cleanId,
    source: 'config',
    configPath,
  };
}

export function saveRedirectPort(port: number): { port: number; configPath: string } {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid port: ${port}. Must be an integer between 0 and 65535.`);
  }

  const configPath = getConfigPath();
  const configDir = getConfigDir();

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  let currentConfig: AppConfig = {};
  if (existsSync(configPath)) {
    try {
      currentConfig = readValidConfig(configPath);
    } catch {
      currentConfig = {};
    }
  }

  const updatedConfig: AppConfig = {
    ...currentConfig,
    spotify: {
      ...currentConfig.spotify,
      redirectPort: port,
    },
  };

  writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2), 'utf8');

  return {
    port,
    configPath,
  };
}
