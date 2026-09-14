// @ts-nocheck
// Input focus, audio config, private session, and lifecycle setters extracted
// from api.ts for the 300 LoC cap.

import type { UiAudioConfig } from '../types';
import type { UiCoreContext } from './types';

export function createMiscSetters(ctx: UiCoreContext) {
  const { built, renderer, state, statusTimer } = ctx;
  const { helpers } = ctx;

  return {
    focusClientIdInput(): void {
      helpers.showRoute('onboarding', true, true);
      helpers.setFocusArea('main');
      built.clientIdInput.focus();
    },
    isAnyInputFocused(): boolean {
      return Boolean(
        built.searchInput.focused || built.clientIdInput.focused || built.paletteInput.focused,
      );
    },
    setAudioConfig(cfg: Partial<UiAudioConfig>): void {
      state.audioConfig = { ...state.audioConfig, ...cfg };
      helpers.refreshSettings();
    },
    setPrivateSession(active: boolean): void {
      state.isPrivateSession = active;
      helpers.refreshNav();
      helpers.renderPlaybackBar();
    },
    async start(): Promise<void> {
      // Renderer is already started.
    },
    async shutdown(): Promise<void> {
      helpers.stopPlaybackTickTimer?.();
      clearTimeout(statusTimer.value as NodeJS.Timeout);
      clearTimeout(ctx.lyricsResumeTimer?.value as NodeJS.Timeout);
      await renderer.destroy();
    },
  };
}
