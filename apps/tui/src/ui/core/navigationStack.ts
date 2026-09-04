// Back-stack helpers for typed routes. Stack is bounded at 50 entries per spec §4.

import type { RouteT } from 'spotoei-protocol';

export const ROUTE_STACK_LIMIT = 50;

export function pushRoute(stack: RouteT[], current: RouteT, next: RouteT): RouteT[] {
  if (sameRoute(current, next)) return stack;
  const updated = [...stack, current];
  if (updated.length > ROUTE_STACK_LIMIT) {
    return updated.slice(updated.length - ROUTE_STACK_LIMIT);
  }
  return updated;
}

export function popRoute(stack: RouteT[]): { stack: RouteT[]; popped: RouteT | null } {
  if (stack.length === 0) return { stack, popped: null };
  const last = stack[stack.length - 1];
  if (last === undefined) return { stack, popped: null };
  return { stack: stack.slice(0, -1), popped: last };
}

export function clearRouteStack(): RouteT[] {
  return [];
}

export function sameRoute(a: RouteT, b: RouteT): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'home': {
      const ha = a as { tab: string; browse?: { category?: string; entry?: string } };
      const hb = b as { tab: string; browse?: { category?: string; entry?: string } };
      return (
        ha.tab === hb.tab &&
        (ha.browse?.category ?? '') === (hb.browse?.category ?? '') &&
        (ha.browse?.entry ?? '') === (hb.browse?.entry ?? '')
      );
    }
    case 'browse': {
      const pa = a as { path?: { category?: string; entry?: string } };
      const pb = b as { path?: { category?: string; entry?: string } };
      return (
        (pa.path?.category ?? '') === (pb.path?.category ?? '') &&
        (pa.path?.entry ?? '') === (pb.path?.entry ?? '')
      );
    }
    case 'search':
      return (a.query ?? '') === ((b as { query?: string }).query ?? '');
    case 'library':
      return (a as { section: string }).section === (b as { section?: string }).section;
    case 'artist':
    case 'album':
    case 'playlist':
      return (a as { id: string }).id === (b as { id?: string }).id;
    case 'queue':
    case 'lyrics':
    case 'settings':
    case 'onboarding':
    case 'visualizer':
      return true;
    default:
      return false;
  }
}

export function defaultRoute(): RouteT {
  return { kind: 'home', tab: 'for_you' };
}

export function homeRoute(): RouteT {
  return { kind: 'home', tab: 'for_you' };
}

export function routeFromLegacy(input: string | RouteT): RouteT {
  if (typeof input !== 'string') return input;
  switch (input) {
    case 'home':
      return { kind: 'home', tab: 'for_you' };
    case 'browse':
      return { kind: 'home', tab: 'browse' };
    case 'search':
      return { kind: 'search' };
    case 'library':
      return { kind: 'library', section: 'saved_tracks' };
    case 'queue':
      return { kind: 'queue' };
    case 'lyrics':
      return { kind: 'lyrics' };
    case 'settings':
      return { kind: 'settings' };
    case 'onboarding':
      return { kind: 'onboarding' };
    case 'visualizer':
      return { kind: 'visualizer' };
    default:
      return { kind: 'home', tab: 'for_you' };
  }
}

export function routeKind(r: RouteT | string): string {
  if (typeof r === 'string') return r;
  return r.kind;
}
