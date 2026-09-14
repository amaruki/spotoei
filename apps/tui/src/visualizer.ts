// Visualizer client and controller: subscribes to player spectrum and
// waveform events, tracks render latency, and applies adaptive FPS
// throttling (60 -> 30 with hysteresis) so the terminal UI never bogs
// down on slow terminal emulators.

import type { ChildProcess } from 'node:child_process';
import { getSharedReadline } from './player';
import {
  SpectrumFrame,
  WaveformFrame,
  makeVisualizerConfigure,
  parseInbound,
  type VisualizerModeT,
  type CommandT,
} from 'spotoei-protocol';
import { AdaptiveFpsTracker } from './visualizerFps';
import { formatSpectrumBar } from './visualizerFormat';

export {
  SPECTRUM_BLOCK_CHARS,
  formatBlockMeter,
  formatSpectrumBar,
  resampleBands,
} from './visualizerFormat';

export interface VisualizerClientOptions {
  child: ChildProcess;
  timeoutMs?: number;
  initialMode?: VisualizerModeT;
  targetFps?: number;
  bands?: number;
  waveformSamples?: number;
}

export type VisualizerFrameListener = (mode: VisualizerModeT, data: number[]) => void;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const MAX_PENDING = 32;

export class VisualizerController {
  private child: ChildProcess;
  private timeoutMs: number;
  private mode: VisualizerModeT;
  private bands: number;
  private waveformSamples: number;
  private enabled: boolean = true;
  private listeners: Set<VisualizerFrameListener> = new Set();
  private pending = new Map<string, PendingRequest>();
  private latestBands: number[] = [];
  private latestSamples: number[] = [];
  private lineListener: ((line: string) => void) | null = null;
  private running = false;

  // Adaptive FPS state — windowed hysteresis (ring of last 120 frameTimes)
  private fpsTracker: AdaptiveFpsTracker;
  private lastFrameTimestamp: number = 0;

  constructor(opts: VisualizerClientOptions) {
    this.child = opts.child;
    this.timeoutMs = opts.timeoutMs ?? 5_000;
    this.mode = opts.initialMode ?? 'spectrum';
    this.fpsTracker = new AdaptiveFpsTracker(opts.targetFps ?? 60, () => {
      this.syncConfig().catch(() => {});
    });
    this.bands = opts.bands ?? 64;
    this.waveformSamples = opts.waveformSamples ?? 120;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const rl = getSharedReadline(this.child);

    this.lineListener = (line: string): void => {
      const parsed = parseInbound(line);
      if (!parsed.ok) return;

      const msg = parsed.value;

      if (msg.type === 'response') {
        const req = this.pending.get(msg.id);
        if (req) {
          clearTimeout(req.timer);
          this.pending.delete(msg.id);
          if (msg.ok) {
            req.resolve(msg.data);
          } else {
            req.reject(
              new Error(`${msg.error?.code ?? 'ERROR'}: ${msg.error?.message ?? 'unknown'}`),
            );
          }
        }
        return;
      }

      if (msg.type === 'event') {
        if (!this.enabled) return;

        // Adaptive FPS measurement must only see visualizer frames;
        // otherwise unrelated events (auth, playback, lyrics) skew
        // the latency history and trigger spurious throttling.
        if (msg.event === 'visualizer.spectrum' || msg.event === 'visualizer.waveform') {
          const now = performance.now();
          if (this.lastFrameTimestamp > 0) {
            const frameTime = now - this.lastFrameTimestamp;
            this.recordFrameLatency(frameTime);
          }
          this.lastFrameTimestamp = now;
        }

        if (msg.event === 'visualizer.spectrum') {
          const result = SpectrumFrame.safeParse(msg.data);
          if (result.success) {
            this.latestBands = result.data.bands;
            for (const l of this.listeners) {
              try {
                l(this.mode, result.data.bands);
              } catch {
                // ignore listener exceptions
              }
            }
          }
        } else if (msg.event === 'visualizer.waveform') {
          const result = WaveformFrame.safeParse(msg.data);
          if (result.success) {
            this.latestSamples = result.data.samples;
            for (const l of this.listeners) {
              try {
                l(this.mode, result.data.samples);
              } catch {
                // ignore listener exceptions
              }
            }
          }
        }
      }
    };

    rl.on('line', this.lineListener);
    this.syncConfig().catch(() => {
      // Ignore initial config sync failure
    });
  }

  stop(): void {
    this.running = false;
    if (this.lineListener) {
      const rl = getSharedReadline(this.child);
      rl.off('line', this.lineListener);
      this.lineListener = null;
    }
    for (const req of this.pending.values()) {
      clearTimeout(req.timer);
      req.reject(new Error('visualizer controller stopped'));
    }
    this.pending.clear();
    this.listeners.clear();
  }

  subscribe(listener: VisualizerFrameListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async setMode(mode: VisualizerModeT): Promise<void> {
    this.mode = mode;
    this.enabled = mode !== 'off';
    await this.syncConfig();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.mode = 'off' as VisualizerModeT;
    } else if (this.mode === ('off' as VisualizerModeT)) {
      this.mode = 'spectrum';
    }
    this.syncConfig().catch(() => {});
  }

  cycleMode(): VisualizerModeT {
    const modes: VisualizerModeT[] = ['spectrum', 'winamp', 'oscilloscope', 'circular', 'off'];
    const cur = this.enabled ? this.mode : ('off' as VisualizerModeT);
    const nextIdx = (modes.indexOf(cur as VisualizerModeT) + 1) % modes.length;
    const next = modes[nextIdx] ?? 'spectrum';
    this.setMode(next).catch(() => {});
    return next;
  }

  getMode(): VisualizerModeT {
    return this.mode;
  }

  getCurrentFps(): number {
    return this.fpsTracker.getFps();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getLatestBands(): number[] {
    return [...this.latestBands];
  }

  getLatestSamples(): number[] {
    return [...this.latestSamples];
  }

  renderBar(width?: number): string {
    if (!this.enabled || this.mode === 'off' || this.latestBands.length === 0) {
      return width ? ' '.repeat(width) : '';
    }
    return formatSpectrumBar(this.latestBands, width ?? this.bands);
  }

  private recordFrameLatency(ms: number): void {
    this.fpsTracker.recordFrameLatency(ms);
  }

  private async sendCommand<T>(cmd: CommandT): Promise<T> {
    if (this.pending.size >= MAX_PENDING) {
      throw new Error(`visualizer pending queue full (${MAX_PENDING})`);
    }

    const { promise, resolve, reject } = Promise.withResolvers<T>();

    const timer = setTimeout(() => {
      this.pending.delete(cmd.id);
      reject(new Error(`timeout waiting for response to ${cmd.command}`));
    }, this.timeoutMs);

    this.pending.set(cmd.id, {
      resolve: (v) => resolve(v as T),
      reject,
      timer,
    });

    const line = JSON.stringify(cmd) + '\n';

    if (!this.child.stdin || !this.child.stdin.writable) {
      clearTimeout(timer);
      this.pending.delete(cmd.id);
      reject(new Error('player stdin not writable'));
      return promise;
    }

    await new Promise<void>((resolveWrite, rejectWrite) => {
      this.child.stdin!.write(line, (err) => (err ? rejectWrite(err) : resolveWrite()));
    }).catch((err: unknown) => {
      clearTimeout(timer);
      this.pending.delete(cmd.id);
      reject(err instanceof Error ? err : new Error(String(err)));
    });

    return promise;
  }

  private async syncConfig(): Promise<void> {
    const cmd = makeVisualizerConfigure(crypto.randomUUID(), {
      enabled: this.enabled,
      mode: this.mode,
      fps: this.fpsTracker.getFps(),
      bands: this.bands,
      waveformSamples: this.waveformSamples,
    });
    await this.sendCommand(cmd);
  }
}

export function createVisualizerController(options: VisualizerClientOptions): VisualizerController {
  const ctrl = new VisualizerController(options);
  ctrl.start();
  return ctrl;
}
