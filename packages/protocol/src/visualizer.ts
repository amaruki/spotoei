// Visualizer protocol types: configuration, spectrum and waveform frames.
// Both the player (publisher) and the TUI (consumer) parse against these
// schemas at their respective boundaries.

import { z } from 'zod';

export const VisualizerMode = z.enum(['spectrum', 'winamp', 'oscilloscope']);
export type VisualizerModeT = z.infer<typeof VisualizerMode>;

export const VisualizerConfig = z.object({
  enabled: z.boolean(),
  mode: VisualizerMode,
  fps: z.number().int().min(1).max(120),
  bands: z.number().int().min(8).max(256),
  waveformSamples: z.number().int().min(16).max(512),
});
export type VisualizerConfigT = z.infer<typeof VisualizerConfig>;

export const SpectrumFrame = z.object({
  bands: z.array(z.number().min(0).max(1)),
});
export type SpectrumFrameT = z.infer<typeof SpectrumFrame>;

export const WaveformFrame = z.object({
  samples: z.array(z.number().min(-1).max(1)),
});
export type WaveformFrameT = z.infer<typeof WaveformFrame>;
