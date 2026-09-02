import { describe, expect, test } from 'bun:test';
import {
  AuthStatusData,
  AuthBeginData,
  AuthTokenData,
  AuthCompletedEventData,
  AuthFailedEventData,
  PROTOCOL_VERSION,
  parseInbound,
  makeAuthStatus,
  makeAuthBegin,
  makeAuthLogout,
} from '../src/index';

describe('auth protocol schemas', () => {
  test('validates unauthenticated AuthStatusData', () => {
    const raw = {
      v: PROTOCOL_VERSION,
      state: 'unauthenticated',
      accountId: null,
      scopes: [],
      storage: 'keyring',
      accessTokenExpiresAt: null,
      authUrl: null,
    };
    const parsed = AuthStatusData.safeParse(raw);
    expect(parsed.success).toBe(true);
  });

  test('validates authenticating AuthStatusData with authUrl', () => {
    const raw = {
      v: PROTOCOL_VERSION,
      state: 'authenticating',
      accountId: null,
      scopes: ['user-read-playback-state'],
      storage: 'keyring',
      accessTokenExpiresAt: null,
      authUrl: 'https://accounts.spotify.com/authorize?client_id=xyz',
    };
    const parsed = AuthStatusData.safeParse(raw);
    expect(parsed.success).toBe(true);
  });

  test('validates authenticated AuthStatusData', () => {
    const raw = {
      v: PROTOCOL_VERSION,
      state: 'authenticated',
      accountId: 'spotify-user-123',
      scopes: ['user-read-playback-state', 'playlist-read-private'],
      storage: 'keyring',
      accessTokenExpiresAt: Date.now() + 3600_000,
      authUrl: null,
    };
    const parsed = AuthStatusData.safeParse(raw);
    expect(parsed.success).toBe(true);
  });

  test('validates AuthBeginData with scopes', () => {
    const parsed = AuthBeginData.safeParse({ scopes: ['user-read-private'] });
    expect(parsed.success).toBe(true);
  });

  test('validates AuthTokenData', () => {
    const parsed = AuthTokenData.safeParse({
      accessToken: 'BQD...secret',
      expiresAt: Date.now() + 3600_000,
    });
    expect(parsed.success).toBe(true);
  });

  test('validates AuthCompletedEventData', () => {
    const parsed = AuthCompletedEventData.safeParse({
      accountId: 'user-xyz',
      scopes: ['user-read-private'],
    });
    expect(parsed.success).toBe(true);
  });

  test('validates AuthFailedEventData', () => {
    const parsed = AuthFailedEventData.safeParse({
      reason: 'user_denied',
      message: 'User cancelled the login flow',
    });
    expect(parsed.success).toBe(true);
  });

  test('envelope helpers produce valid command lines', () => {
    const s = makeAuthStatus('req-1');
    expect(s.command).toBe('auth.status');
    expect(s.id).toBe('req-1');

    const b = makeAuthBegin('req-2', ['user-read-private']);
    expect(b.command).toBe('auth.begin');

    const l = makeAuthLogout('req-3');
    expect(l.command).toBe('auth.logout');
  });

  test('parses auth.changed event line', () => {
    const eventLine = JSON.stringify({
      v: PROTOCOL_VERSION,
      type: 'event',
      event: 'auth.changed',
      seq: 1,
      data: {
        v: PROTOCOL_VERSION,
        state: 'authenticated',
        accountId: 'u1',
        scopes: [],
        storage: 'keyring',
        accessTokenExpiresAt: null,
        authUrl: null,
      },
    });
    const parsed = parseInbound(eventLine);
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.value.type === 'event') {
      expect(parsed.value.event).toBe('auth.changed');
    }
  });
});
