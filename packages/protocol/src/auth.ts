import { z } from 'zod';

import { PROTOCOL_VERSION } from './version';

// Auth state machine. The player is the single source of truth; the TUI
// mirrors this on every `auth.changed` event.
export const AuthState = z.enum([
  'unauthenticated',
  'authenticating',
  'authenticated',
  'refresh-failed',
]);
export type AuthStateT = z.infer<typeof AuthState>;

// Credential storage tier. `keyring` means refresh tokens persist in the
// OS keyring; `memory` means refresh tokens live only for the current run.
export const CredentialStorage = z.enum(['keyring', 'memory', 'unavailable']);
export type CredentialStorageT = z.infer<typeof CredentialStorage>;

// `auth.status` reply. The player MUST never include tokens in this reply.
export const AuthStatusData = z.object({
  v: z.literal(PROTOCOL_VERSION),
  state: AuthState,
  accountId: z.string().nullable(),
  scopes: z.array(z.string()),
  storage: CredentialStorage,
  // Unix-epoch milliseconds of the current access-token expiry, or null
  // when the state is unauthenticated.
  accessTokenExpiresAt: z.number().int().nonnegative().nullable(),
  // PKCE flow target, populated only when `state === 'authenticating'`.
  authUrl: z.string().url().nullable(),
});
export type AuthStatusDataT = z.infer<typeof AuthStatusData>;

// `auth.begin` request. The TUI does not provide a verifier; the player
// generates one and uses it only in the in-progress transaction.
export const AuthBeginData = z.object({
  // Optional override list. If absent, the player uses its default scope set.
  scopes: z.array(z.string().min(1)).max(64).optional(),
});
export type AuthBeginDataT = z.infer<typeof AuthBeginData>;

// `auth.logout` carries no data. The current account is the active one.
export const AuthLogoutData = z.object({}).default({});
export type AuthLogoutDataT = z.infer<typeof AuthLogoutData>;

// `auth.get_web_token` reply. Only the access token value is returned and
// only because the TS adapter is the sole consumer and never persists it.
export const AuthTokenData = z.object({
  accessToken: z.string().min(1),
  expiresAt: z.number().int().nonnegative(),
});
export type AuthTokenDataT = z.infer<typeof AuthTokenData>;

// `auth.completed` event payload (player -> TUI, on successful callback).
export const AuthCompletedEventData = z.object({
  accountId: z.string().min(1),
  scopes: z.array(z.string()),
});
export type AuthCompletedEventDataT = z.infer<typeof AuthCompletedEventData>;

// `auth.failed` event payload (player -> TUI, on callback/refresh failure).
export const AuthFailedEventData = z.object({
  reason: z.enum(['user_denied', 'state_mismatch', 'token_exchange', 'network', 'other']),
  message: z.string().min(1),
});
export type AuthFailedEventDataT = z.infer<typeof AuthFailedEventData>;

// `auth.changed` event payload. Mirrors the current AuthStatusData on every
// transition; the TUI treats it as the canonical auth state.
export const AuthChangedEventData = AuthStatusData;
export type AuthChangedEventDataT = AuthStatusDataT;
