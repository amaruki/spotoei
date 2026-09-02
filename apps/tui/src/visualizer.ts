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

export interface VisualizerClientOptions {
  child: ChildProcess;
  timeoutMs?: number;
  initialMode?: VisualizerModeT;
  targetFps?: number;
  bands?: number;
  waveformSamples?: number;
}

export type VisualizerFrameListener = (
  mode: VisualizerModeT,
  data: number[],
) => void;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class VisualizerController {
  private child: ChildProcess;
  private timeoutMs: number;
  private mode: VisualizerModeT;
  private targetFps: number;
  private currentFps: number;
  private bands: number;
  private waveformSamples: number;
  private enabled: boolean = true;
  private listeners: Set<VisualizerFrameListener> = new Set();
  private pending = new Map<string, PendingRequest>();
  private lineListener: ((line: string) => void) | null = null;

  // Adaptive FPS state
  private frameLatencies: number[] = [];
  private lastFrameTimestamp: number = 0;
  private slowFrameCount: number = 0;
  private fastFrameCount: number = 0;

  constructor(opts: VisualizerClientOptions) {
    this.child = opts.child;
    this.timeoutMs = opts.timeoutMs ?? 5_000;
    this.mode = opts.initialMode ?? 'spectrum';
    this.targetFps = opts.targetFps ?? 60;
    this.currentFps = this.targetFps;
    this.bands = opts.bands ?? 64;
    this.waveformSamples = opts.waveformSamples ?? 120;
  }

  start(): void {
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
              new Error(
                `${msg.error?.code ?? 'ERROR'}: ${msg.error?.message ?? 'unknown'}`,
              ),
            );
          }
        }
        return;
      }

      if (msg.type === 'event') {
        if (!this.enabled) return;

        const now = performance.now();
        if (this.lastFrameTimestamp > 0) {
          const frameTime = now - this.lastFrameTimestamp;
          this.recordFrameLatency(frameTime);
        }
        this.lastFrameTimestamp = now;

        if (msg.event === 'visualizer.spectrum') {
          const result = SpectrumFrame.safeParse(msg.data);
          if (result.success) {
            for (const l of this.listeners) {
              try {
                l(this.mode, result.data.bands);
              } catch {
                // ignore listener errors
              }
            }
          }
        } else if (msg.event === 'visualizer.waveform') {
          const result = WaveformFrame.safeParse(msg.data);
          if (result.success) {
            for (const l of this.listeners) {
              try {
                l(this.mode, result.data.samples);
              } catch {
                // ignore listener errors
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
    if (this.lineListener) {
      const rl = getSharedReadline(this.child);
      rl.off('line', this.lineListener);
      this.lineListener = null;
    }
  }

  subscribe(listener: VisualizerFrameListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getMode(): VisualizerModeT {
    return this.mode;
  }

  setMode(mode: VisualizerModeT): void {
    if (this.mode !== mode) {
      this.mode = mode;
      this.syncConfig().catch(() => {});
    }
  }

  cycleMode(): VisualizerModeT {
    const modes: VisualizerModeT[] = ['spectrum', 'winamp', 'oscilloscope'];
    const nextIdx = (modes.indexOf(this.mode) + 1) % modes.length;
    this.setMode(modes[nextIdx]);
    return this.mode;
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled !== enabled) {
      this.enabled = enabled;
      this.syncConfig().catch(() => {});
    }
  }

  getCurrentFps(): number {
    return this.currentFps;
  }

  private recordFrameLatency(ms: number): void {
    this.frameLatencies.push(ms);
    if (this.frameLatencies.length > 30) {
      this.frameLatencies.shift();
    }

    if (ms > 22) {
      this.slowFrameCount++;
      this.fastFrameCount = 0;
    } else if (ms < 18) {
      this.fastFrameCount++;
      this.slowFrameCount = 0;
    }

    if (this.currentFps === 60 && this.slowFrameCount >= 10) {
      this.currentFps = 30;
      this.slowFrameCount = 0;
      this.syncConfig().catch(() => {});
    } else if (this.currentFps === 30 && this.fastFrameCount >= 60) {
      this.currentFps = 60;
      this.fastFrameCount = 0;
      this.syncConfig().catch(() => {});
    }
  }

  private sendCommand<T>(cmd: CommandT): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(cmd.id);
        reject(
          new Error(`timeout waiting for response to ${cmd.command}`),
        );
      }, this.timeoutMs);

      this.pending.set(cmd.id, {
        resolve: (v) => resolve(v as T),
        reject,
        timer,
      });

      const line = JSON.stringify(cmd) + '\n';
      this.child.stdin?.write(line, (err) => {
        if (err) {
          this.pending.delete(cmd.id);
          clearTimeout(timer);
          reject(err);
        }
      });
    });
  }

  private async syncConfig(): Promise<void> {
    const cmd = makeVisualizerConfigure(crypto.randomUUID(), {
      enabled: this.enabled,
      mode: this.mode,
      fps: this.currentFps,
      bands: this.bands,
      waveformSamples: this.waveformSamples,
    });
    await this.sendCommand(cmd);
  }
}

export function createVisualizerController(
  options: VisualizerClientOptions,
): VisualizerController {
  const ctrl = new VisualizerController(options);
  ctrl.start();
  return ctrl;
}
