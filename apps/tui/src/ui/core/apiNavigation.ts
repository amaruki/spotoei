// @ts-nocheck
// Navigation, focus, status, and visualizer-frame setters extracted from
// api.ts for the 300 LoC cap.

import { routeFromLegacy } from './navigationStack';
import type { FocusArea, Route, UiCoreContext, VisualizerFrame } from './types';

export function createNavigationSetters(ctx: UiCoreContext) {
  const { focus, latestVizFrame, route } = ctx;
  const { helpers } = ctx;

  return {
    navigateBack(): boolean {
      return helpers.navigateBack();
    },
    toggleSidebar(): void {
      helpers.toggleSidebar();
    },
    getRouteStack(): Route[] {
      return [...ctx.routeStack];
    },
    setRoute(next: Route | string): void {
      const target = routeFromLegacy(next);
      helpers.showRoute(target);
      helpers.setNavSelected(target);
      helpers.setFocusArea('main');
    },
    getRoute(): Route {
      return route.current;
    },
    setFocus(next: FocusArea): void {
      helpers.setFocusArea(next);
    },
    getFocus(): FocusArea {
      return focus.current;
    },
    setStatus: helpers.setStatus,
    // One-shot browse notice (offline fallback). Fire-and-forget on purpose:
    // folding it into every later status polluted unrelated messages, so a
    // cleared or superseded banner simply stops appearing.
    setBrowseBanner(banner: string | null): void {
      if (banner) helpers.setStatus(banner, true);
    },
    setVisualizerFrame(frame: VisualizerFrame | null): void {
      latestVizFrame.value = frame;
      helpers.paintViz();
    },
  };
}
