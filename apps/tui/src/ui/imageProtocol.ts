import type { ImageRenderProtocol } from '@opentui/core';

// herdr advertises the capabilities of its internal terminal engine
// (libghostty reports kitty graphics), but the client attached to it may be a
// terminal that cannot display kitty graphics (e.g. VTE/xfce4-terminal). The
// image is then written but never shown. Blocks are the only protocol every
// terminal can render, so prefer them under herdr. SPOTOEI_IMAGE_PROTOCOL
// overrides the choice for terminals where kitty/sixel are known to work.
export function resolveImageProtocol(): ImageRenderProtocol {
  const override = process.env.SPOTOEI_IMAGE_PROTOCOL?.trim().toLowerCase();
  if (
    override === 'auto' ||
    override === 'kitty' ||
    override === 'sixel' ||
    override === 'blocks'
  ) {
    return override;
  }
  if (process.env.HERDR_ENV) {
    return 'blocks';
  }
  return 'auto';
}
