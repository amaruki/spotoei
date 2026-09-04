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
  private targetFps: number;
  private currentFps: number;
  private bands: number;
  private waveformSamples: number;
  private enabled: boolean = true;
  private listeners: Set<VisualizerFrameListener> = new Set();
  private pending = new Map<string, PendingRequest>();
  private lineListener: ((line: string) => void) | null = null;
  private running = false;

  // Adaptive FPS state — windowed hysteresis (ring of last 120 frameTimes)
  private frameTimes: number[] = [];
  private lastFrameTimestamp: number = 0;
  private lastEvalAt: number = 0;
  private downgradedAt: number = 0;
  private stableSince: number = 0;

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
    const modes: VisualizerModeT[] = ['spectrum', 'winamp', 'oscilloscope', 'off'];
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
    return this.currentFps;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private recordFrameLatency(ms: number): void {
    this.frameTimes.push(ms);
    if (this.frameTimes.length > 120) this.frameTimes.shift();
    if (this.frameTimes.length < 10) return;
    const now = performance.now();
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
    const drop22 = this.frameTimes.filter((t) => t > 22).length / this.frameTimes.length;
    const drop40 = this.frameTimes.filter((t) => t > 40).length / this.frameTimes.length;
    const WINDOW_MS = 2000;
    const STABLE_MS = 10000;
    const COOLDOWN_MS = 15000;
    if (this.currentFps === 60) {
      const windowOk = now - this.lastEvalAt >= WINDOW_MS || this.frameTimes.length < 120;
      if (windowOk && p95 > 22 && drop22 > 0.08) {
        this.currentFps = 30;
        this.downgradedAt = now;
        this.lastEvalAt = now;
        this.stableSince = 0;
        this.syncConfig().catch(() => {});
      } else if (p95 <= 22) this.lastEvalAt = now;
    } else if (this.currentFps === 30) {
      const inCooldown = now - this.downgradedAt < COOLDOWN_MS;
      const recovery = p95 <= 40 && drop40 < 0.05;
      if (!recovery) { this.stableSince = 0; return; }
      const timeStable = this.stableSince !== 0 && now - this.stableSince >= STABLE_MS;
      const countStable = this.frameTimes.filter((t) => t <= 40).length >= 60;
      if (this.stableSince === 0) this.stableSince = now;
      if ((timeStable || countStable) && (!inCooldown || countStable)) {
        this.currentFps = this.targetFps;
        this.lastEvalAt = now;
        this.stableSince = 0;
        this.downgradedAt = 0;
        this.syncConfig().catch(() => {});
      }
    }
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
      fps: this.currentFps,
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
