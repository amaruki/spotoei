// Per-route view positions: selected index + scroll offset keyed by
// serializable route ID only (never API responses). Restores Search,
// Browse, Library, and entity pages on back navigation.

import type { RouteT } from 'spotoei-protocol';

export interface ViewPosition {
  selected: number;
  scroll: number;
}

export function routePositionKey(route: RouteT): string {
  switch (route.kind) {
    case 'home':
      return `home:${route.tab}:${route.browse?.category ?? ''}:${route.browse?.entry ?? ''}`;
    case 'search':
      return `search:${route.query ?? ''}`;
    case 'library':
      return `library:${route.section}`;
    case 'artist':
    case 'album':
    case 'playlist':
      return `${route.kind}:${route.id}`;
    default:
      return route.kind;
  }
}

export class ViewPositionStore {
  private positions = new Map<string, ViewPosition>();

  save(route: RouteT, pos: ViewPosition): void {
    this.positions.set(routePositionKey(route), { ...pos });
  }

  restore(route: RouteT): ViewPosition {
    return this.positions.get(routePositionKey(route)) ?? { selected: 0, scroll: 0 };
  }

  saveKey(key: string, pos: ViewPosition): void {
    this.positions.set(key, { ...pos });
  }

  restoreKey(key: string): ViewPosition {
    return this.positions.get(key) ?? { selected: 0, scroll: 0 };
  }
}

export function panelPositionKey(route: RouteT, view: string, panel: string): string {
  return `${routePositionKey(route)}:${view}:${panel}`;
}
