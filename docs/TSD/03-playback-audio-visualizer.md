# TSD 03 — Playback, Audio, and Visualizer

## 1. Scope

This document specifies local playback ownership, librespot integration, audio output, queue/autoplay behavior, DSP boundaries, visualizer algorithms, and adaptive frame-rate behavior.

## 2. Playback Core Responsibilities

`spotoei-player` owns:

- session establishment;
- Spotify Connect/local device activation;
- load/play/pause/seek/next/previous;
- queue/context state;
- repeat/shuffle/autoplay state;
- player events;
- audio sink lifecycle;
- decoded-audio analysis;
- lyrics retrieval through librespot capabilities when available;
- playback recovery/error mapping.

It does NOT own:

- terminal rendering;
- navigation;
- library/search Web API HTTP requests;
- SQLite UI metadata cache;
- command palette state.

## 3. librespot Integration

Pin librespot to an explicitly reviewed version or revision. Baseline documentation currently exposes `librespot 0.8.0`, but release implementation MUST record the exact resolved revision in `Cargo.lock` and release metadata.

Wrap librespot behind SPOTOEI traits such as:

```rust
trait PlaybackEngine {
    async fn play(&self) -> Result<()>;
    async fn pause(&self) -> Result<()>;
    async fn seek(&self, position_ms: u64) -> Result<()>;
    async fn load_context(&self, uri: &str, start: Option<&str>) -> Result<()>;
    async fn queue_snapshot(&self) -> Result<QueueSnapshot>;
}
```

No IPC structure should serialize librespot internal structs directly.

## 4. Playback State Machine

Authoritative domain states:

```text
Starting
  ↓
Connecting
  ↓
Ready
  ├─ Loading
  │    └─ Buffering
  │          └─ Playing
  ├─ Playing ↔ Paused
  ├─ Reconnecting → Ready/Playing
  └─ Error
```

The domain may refine these internally; UI-facing state SHOULD remain compact and stable.

`stopped`, `paused`, `playing`, and `buffering` MUST never be represented as independent booleans that can contradict each other.

## 5. Audio Defaults

MVP defaults:

- preferred bitrate: 320 kbps when available;
- audio format: choose the format expected by the selected librespot/Rodio path, with `f32` analysis representation preferred internally;
- normalization: enabled;
- gapless: enabled;
- software volume: enabled through the playback mixer;
- autoplay: enabled;
- crossfade: not implemented by SPOTOEI MVP;
- EQ: not implemented by SPOTOEI MVP.

## 6. Audio Backend

Use the librespot default Rodio backend unless a release target requires a proven alternative.

Current librespot playback feature baseline:

```text
librespot playback
   ↓
Rodio backend
   ↓
CPAL
   ↓
OS audio stack/device
```

Platform packaging MUST ensure end users do not need development headers even when build workers need them.

## 7. PCM Analysis Tap

SPOTOEI requires a custom/wrapped audio sink or equivalent supported playback interception point so decoded audio can feed analysis without system-wide loopback capture.

Conceptual flow:

```text
librespot decoded AudioPacket
          │
          ▼
  SPOTOEI analyzing sink
     │            │
     │            └─► convert/downmix analysis samples
     │                         │
     │                         ├─► FFT analyzer
     │                         └─► waveform sampler
     ▼
 wrapped Rodio sink
     ▼
 audio output
```

The analyzer MUST NOT alter the audio samples in MVP.

The wrapper MUST preserve underlying sink `start`, `write`, and `stop` semantics.

## 8. Real-Time Isolation

The audio write path MUST NOT block on UI or IPC.

Use bounded/latest-value channels:

```text
Audio thread
   │ try_send/latest replace
   ▼
Analyzer worker
   │ latest frame
   ▼
IPC visualizer publisher
```

If analyzer/IPC is slow, visual frames are dropped. Audio is not delayed.

Any mutex on the audio path MUST be short-lived and uncontended by UI/network work.

## 9. Spectrum Analysis

Recommended MVP algorithm:

1. Convert input samples to `f32` for analysis.
2. Downmix stereo to mono for the primary spectrum (`0.5 * (L + R)`), while preserving the option for stereo modes later.
3. Use window size 2048 samples by default; 1024 MAY be selected for lower-latency/low-power targets.
4. Apply Hann window.
5. Run real/complex FFT using `rustfft` or an appropriate helper around it.
6. Convert magnitude to a log/dB-like perceptual scale.
7. Group bins into logarithmically distributed bands.
8. Normalize to a bounded `0.0..1.0` visual domain.
9. Apply attack/release smoothing.
10. Apply peak hold/decay for Winamp-style mode.

## 10. Visualizer Modes

### 10.1 Spectrum

- 32 or 64 logical bands depending on available width.
- Log-frequency spacing.
- Smoothed magnitude.
- No requirement for peak markers.

### 10.2 Winamp Style

- Same underlying spectrum data.
- Stronger visual smoothing.
- Peak hold and decay.
- Terminal bar/glyph renderer creates the classic falling-peak feel.

### 10.3 Oscilloscope

- Uses downsampled waveform samples, not FFT magnitudes.
- Samples MUST be resampled/downsampled to the current terminal width before IPC or render when practical.
- Must not send full raw PCM to the TypeScript process.

### 10.4 Off

Analyzer MAY suspend high-frequency work when visualizer is disabled, while retaining only inexpensive state needed for immediate re-enable.

## 11. Visualizer Event Shape

Prefer compact normalized payloads.

Spectrum example:

```json
{"v":1,"type":"event","event":"visualizer.spectrum","seq":8112,"bands":[0.05,0.12,0.48,0.91]}
```

Waveform example:

```json
{"v":1,"type":"event","event":"visualizer.waveform","seq":8113,"samples":[-0.1,0.2,0.7,0.1,-0.4]}
```

Do not include track metadata in every visualizer frame.

## 12. Adaptive FPS

### 12.1 Default

Target 60 FPS (`~16.67 ms` frame period).

### 12.2 Measurement Ownership

The TypeScript renderer measures whether the terminal/render loop can consume frames. It reports a desired visualizer rate to the player core.

### 12.3 Recommended Downgrade Policy

Use a rolling 2-second window. Downgrade 60 → 30 when either condition is sustained:

- more than roughly 10% of visualizer frames miss the expected render window; or
- p95 visualizer render/commit latency exceeds approximately 20-22 ms.

These thresholds are implementation defaults and MAY be tuned by benchmarks.

### 12.4 Recommended Upgrade Policy

Return 30 → 60 only after at least 10 seconds of stable rendering with:

- very low dropped-frame ratio (for example <2%); and
- p95 render latency comfortably inside the 60 FPS budget.

Use a minimum cooldown of about 15 seconds between rate switches to prevent oscillation.

### 12.5 Backpressure

At most one unpublished visualizer frame needs to be retained. Newer frames SHOULD replace older pending frames.

No historical visualizer queue is required.

## 13. Position Events

Do not emit playback-position events at visualizer frequency.

Recommended player snapshot/update cadence while playing: approximately 4-5 Hz, plus immediate events on:

- seek;
- track change;
- pause/resume;
- buffering transition.

The TUI interpolates progress locally using a monotonic clock.

This reduces IPC traffic while keeping progress smooth.

## 14. Queue

The player core maps librespot queue/context events into `QueueSnapshot`.

```rust
struct QueueSnapshot {
    revision: u64,
    current: Option<QueueItem>,
    previous: Vec<QueueItem>,
    next: Vec<QueueItem>,
}
```

The revision MUST increase when the authoritative queue changes.

TypeScript MUST replace/reconcile against the revisioned snapshot rather than independently invent queue order.

## 15. Autoplay

Autoplay policy:

- stored as a user setting;
- enabled by default;
- command updates the player context behavior;
- when explicit context ends, continuation is delegated to Spotify/librespot behavior;
- SPOTOEI does not implement its own recommendation engine.

If no continuation is available, emit normal stopped/end-of-context state.

## 16. Shuffle and Repeat

Expose stable SPOTOEI enums:

```text
shuffle: off | on
repeat: off | context | track
```

Map to/from librespot capabilities. Unsupported state combinations MUST be rejected with `UNSUPPORTED` rather than silently lying to the UI.

## 17. Audio Device Handling

MVP SHOULD use the OS default output device initially.

A future device picker may be added; it is not required for MVP.

On device loss:

1. map backend error;
2. attempt safe re-open/default fallback if supported;
3. emit `audio.device_changed` or `audio.error`;
4. never spin in a tight reopen loop.

## 18. Lyrics Retrieval Boundary

If the pinned librespot version exposes lyrics retrieval, the player process maps it into a SPOTOEI `LyricsDocument`:

```text
LyricsDocument
├─ source: playback
├─ kind: synced | plain
├─ language?: string
└─ lines[]
   ├─ start_ms?: number
   └─ text: string
```

Lyrics retrieval failures are non-fatal and map to `LYRICS_UNAVAILABLE`.

## 19. Future DSP Extension Point

Although EQ is excluded from MVP, the audio path SHOULD allow future processors without redesign:

```text
Decoded PCM
  ↓
[future DSP chain: EQ / limiter / crossfade if required]
  ↓
analysis tap (post-DSP when DSP exists)
  ↓
output
```

Do not build a generic plugin framework now. A small explicit processor chain interface is enough.

## 20. Playback Tests

Required:

- commands map correctly to fake engine;
- invalid state transitions rejected;
- position snapshots/interpolation reconciliation;
- queue revision monotonicity;
- autoplay toggle persistence/command mapping;
- analyzer cannot block audio test sink;
- visualizer bounded queue drops old frames;
- adaptive FPS command honored;
- FFT output bounded and deterministic for generated sine tones;
- oscillator/waveform downsampling bounded;
- sink wrapper forwards start/write/stop;
- player shutdown does not hang.

## 21. Performance Benchmarks

Maintain repeatable local benchmarks for:

- analyzer CPU at 44.1/48 kHz;
- 32/64 band FFT;
- 60 FPS event serialization;
- 30 FPS event serialization;
- visualizer message sizes;
- long-running playback memory stability.

Performance optimization MUST not compromise audio correctness for visual effects.
