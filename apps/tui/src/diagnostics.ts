import { logToFile } from './config';

export type ErrorLayer = 'runtime' | 'ui' | 'application' | 'api' | 'ipc' | 'sidecar';
export function redact(text: string): string {
  return text
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(
      /((?:access_token|refresh_token|accessToken|refreshToken|client_secret|authorization|code)["']?\s*[:=]\s*["']?)[^\s,"'&}]+/gi,
      '$1[REDACTED]',
    );
}
export function diagnostic(
  layer: ErrorLayer,
  operation: string,
  fields: Record<string, unknown> = {},
): void {
  logToFile(JSON.stringify({ session: process.pid, layer, operation, ...fields }));
}
export function reportFailure(layer: ErrorLayer, operation: string, error: unknown): string {
  const known = error as { diagnosticId?: string; code?: string } | null;
  const id = known?.diagnosticId ?? crypto.randomUUID().slice(0, 8);
  diagnostic(layer, operation, {
    level: 'error',
    diagnosticId: id,
    code: known?.code,
    message: redact(error instanceof Error ? error.message : String(error)),
    stack:
      error instanceof Error && process.env.SPOTOEI_DEV === '1'
        ? redact(error.stack ?? '')
        : undefined,
  });
  return id;
}

export function homeFailure(section: string, error: unknown): string {
  const id = reportFailure('application', `home.${section}`, error);
  const message = error instanceof Error ? error.message : String(error);
  const reauth = /AUTH_REQUIRED|AUTH_EXPIRED|AUTH_DENIED|insufficient.*scope|missing user-/i.test(
    message,
  );
  const reason = reauth
    ? 'authorization required — press a to reauthorize'
    : /QUOTA/.test(message)
      ? 'Spotify API quota exceeded'
      : /RATE_LIMITED/.test(message)
        ? 'Spotify rate limit — retry later'
        : /FORBIDDEN|403/.test(message)
          ? 'Spotify denied access for this app or account'
          : 'request failed — press r to retry';
  return `${reason} [${id}]`;
}
