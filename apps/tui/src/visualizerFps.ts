// Adaptive FPS state machine for the visualizer. Tracks visualizer frame
// latency and throttles 60 -> 30 with hysteresis so the terminal UI never
// bogs down on slow terminal emulators. Extracted from visualizer.ts to
// keep every module under the 300 LoC cap.

export class AdaptiveFpsTracker {
  private targetFps: number;
  private currentFps: number;
  private onFpsChange: () => void;

  // Windowed hysteresis (ring of last 120 frameTimes)
  private frameTimes: number[] = [];
  private lastEvalAt: number = 0;
  private downgradedAt: number = 0;
  private stableSince: number = 0;

  constructor(targetFps: number, onFpsChange: () => void) {
    this.targetFps = targetFps;
    this.currentFps = targetFps;
    this.onFpsChange = onFpsChange;
  }

  getFps(): number {
    return this.currentFps;
  }

  recordFrameLatency(ms: number): void {
    this.frameTimes.push(ms);
    if (this.frameTimes.length > 120) this.frameTimes.shift();
    if (this.frameTimes.length < 10) return;
    const now = performance.now();
    const sorted = this.frameTimes.toSorted((a, b) => a - b);
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
        this.onFpsChange();
      } else if (p95 <= 22) this.lastEvalAt = now;
    } else if (this.currentFps === 30) {
      const inCooldown = now - this.downgradedAt < COOLDOWN_MS;
      const recovery = p95 <= 40 && drop40 < 0.05;
      if (!recovery) {
        this.stableSince = 0;
        return;
      }
      const timeStable = this.stableSince !== 0 && now - this.stableSince >= STABLE_MS;
      const countStable = this.frameTimes.filter((t) => t <= 40).length >= 60;
      if (this.stableSince === 0) this.stableSince = now;
      if ((timeStable || countStable) && (!inCooldown || countStable)) {
        this.currentFps = this.targetFps;
        this.lastEvalAt = now;
        this.stableSince = 0;
        this.downgradedAt = 0;
        this.onFpsChange();
      }
    }
  }
}
