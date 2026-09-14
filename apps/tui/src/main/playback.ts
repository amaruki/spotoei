import { createPlaybackCore } from './playbackCore';
import { createNavigationActions } from './playbackNavigation';
import { createRadioActions } from './playbackRadio';
import { createTransportActions } from './playbackTransport';
import type { AppContext } from './types';

export type { PlayTrackMeta, PlayTrackOpts } from './playbackCore';

export function createPlaybackActions(ctx: AppContext) {
  const core = createPlaybackCore(ctx);
  const navigation = createNavigationActions(ctx, core);
  const transport = createTransportActions(ctx, core);
  const radio = createRadioActions(ctx, core);

  return {
    playTrackOrContext: core.playTrackOrContext,
    playRadio: radio.playRadio,
    ...navigation,
    ...transport,
  };
}
