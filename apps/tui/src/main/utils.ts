import type { Deferred } from './types';

export function deferred<T>(): Deferred<T> {
  let trigger!: (val: T) => void;
  const promise = new Promise<T>((resolve) => {
    trigger = resolve;
  });
  return { promise, trigger };
}

export function isUpperKey(
  k: { name?: string; sequence?: string; shift?: boolean },
  char: string,
): boolean {
  const upper = char.toUpperCase();
  const lower = char.toLowerCase();
  return (
    k.sequence === upper ||
    k.name === upper ||
    (Boolean(k.shift) && (k.name === lower || k.name === upper))
  );
}

export function isLowerKey(
  k: { name?: string; sequence?: string; shift?: boolean },
  char: string,
): boolean {
  const lower = char.toLowerCase();
  const upper = char.toUpperCase();
  if (k.shift) return false;
  if (k.sequence === upper || k.name === upper) return false;
  return k.name === lower || k.sequence === lower;
}

export function formatArtistsList(raw?: Array<string | { name: string }>): string[] {
  if (!raw || !Array.isArray(raw)) return [];
  return raw
    .map((a) => (typeof a === 'string' ? a : a?.name ?? ''))
    .filter((s) => s.trim().length > 0);
}

export function capitalCase(s: string): string {
  return s
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
