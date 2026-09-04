// Spec §4 Esc/back resolution as a pure function for testability.
// Callers map the returned action to stack pops or browse transitions.

import type { RouteT } from 'spotoei-protocol';

export type BackAction =
  | 'close_overlay'
  | 'browse_results_to_entries'
  | 'browse_entries_to_categories'
  | 'browse_to_home'
  | 'pop_route';

interface BackInput {
  route: RouteT;
  browse: { category?: string; entry?: string };
  overlayOpen?: boolean;
  paletteOpen?: boolean;
  priorHomeTab?: string;
}

export function resolveBackAction(input: BackInput): BackAction {
  if (input.overlayOpen || input.paletteOpen) return 'close_overlay';
  const r = input.route;
  if (r.kind === 'home' && r.tab === 'browse') {
    const b = r.browse ?? input.browse;
    if (b?.entry && b?.category) return 'browse_results_to_entries';
    if (b?.category) return 'browse_entries_to_categories';
    return 'browse_to_home';
  }
  if (r.kind === 'browse') {
    const b = (r as { path?: { category?: string; entry?: string } }).path ?? input.browse;
    if (b?.entry && b?.category) return 'browse_results_to_entries';
    if (b?.category) return 'browse_entries_to_categories';
    return 'pop_route';
  }
  return 'pop_route';
}
