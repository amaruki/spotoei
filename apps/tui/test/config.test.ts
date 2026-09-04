import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getConfigDir,
  getConfigPath,
  resolveClientId,
  saveClientId,
  resolveRedirectPort,
  getRedirectUri,
  saveRedirectPort,
  DEFAULT_REDIRECT_PORT,
} from '../src/config';

describe('configuration and client ID resolution', () => {
  const originalEnv = process.env.SPOTOEI_CLIENT_ID;
  const originalPort = process.env.SPOTOEI_REDIRECT_PORT;
  const originalXdg = process.env.XDG_CONFIG_HOME;
  let testConfigDir = '';

  beforeEach(() => {
    delete process.env.SPOTOEI_CLIENT_ID;
    delete process.env.SPOTOEI_REDIRECT_PORT;
    testConfigDir = mkdtempSync(join(tmpdir(), 'spotoei-config-test-'));
    process.env.XDG_CONFIG_HOME = testConfigDir;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.SPOTOEI_CLIENT_ID = originalEnv;
    } else {
      delete process.env.SPOTOEI_CLIENT_ID;
    }
    if (originalPort !== undefined) {
      process.env.SPOTOEI_REDIRECT_PORT = originalPort;
    } else {
      delete process.env.SPOTOEI_REDIRECT_PORT;
    }
    if (originalXdg !== undefined) {
      process.env.XDG_CONFIG_HOME = originalXdg;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }
    if (testConfigDir && existsSync(testConfigDir)) {
      rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  it('computes valid config directory and config path', () => {
    const dir = getConfigDir();
    const path = getConfigPath();
    expect(dir.length).toBeGreaterThan(0);
    expect(path.endsWith('config.json')).toBe(true);
  });

  it('resolves client ID from environment variable', () => {
    process.env.SPOTOEI_CLIENT_ID = 'test-client-id-from-env';
    const res = resolveClientId();
    expect(res.source).toBe('env');
    expect(res.clientId).toBe('test-client-id-from-env');
  });

  it('returns none when environment variable and config files are absent', () => {
    delete process.env.SPOTOEI_CLIENT_ID;
    const res = resolveClientId();
    expect(res.source).toBe('none');
    expect(res.clientId).toBeUndefined();
  });

  it('saves client ID to config.json and resolves it', () => {
    const validId = '0123456789abcdef0123456789abcdef';
    const res = saveClientId(validId);
    expect(res.source).toBe('config');
    expect(res.clientId).toBe(validId);
    expect(existsSync(res.configPath)).toBe(true);

    const content = JSON.parse(readFileSync(res.configPath, 'utf8'));
    expect(content.spotify?.clientId).toBe(validId);

    // delete env to ensure reading from config works
    delete process.env.SPOTOEI_CLIENT_ID;
    const resolved = resolveClientId();
    expect(resolved.source).toBe('config');
    expect(resolved.clientId).toBe(validId);
  });

  it('resolves default redirect port 8989 and constructs redirect URI', () => {
    delete process.env.SPOTOEI_REDIRECT_PORT;
    expect(resolveRedirectPort()).toBe(DEFAULT_REDIRECT_PORT);
    expect(DEFAULT_REDIRECT_PORT).toBe(8989);
    expect(getRedirectUri()).toBe('http://127.0.0.1:8989/callback');
  });

  it('resolves redirect port from environment variable', () => {
    process.env.SPOTOEI_REDIRECT_PORT = '9095';
    expect(resolveRedirectPort()).toBe(9095);
    expect(getRedirectUri()).toBe('http://127.0.0.1:9095/callback');
  });

  it('saves redirect port to config.json and resolves it', () => {
    delete process.env.SPOTOEI_REDIRECT_PORT;
    const res = saveRedirectPort(8080);
    expect(res.port).toBe(8080);
    expect(existsSync(res.configPath)).toBe(true);

    delete process.env.SPOTOEI_REDIRECT_PORT;
    expect(resolveRedirectPort()).toBe(8080);
    expect(getRedirectUri()).toBe('http://127.0.0.1:8080/callback');
  });
});
