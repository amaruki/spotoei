# TSD 06 — TypeScript ↔ Rust IPC Contract

## 1. Transport

MVP uses newline-delimited JSON (NDJSON):

- TypeScript writes commands to child `stdin`.
- Rust writes protocol responses/events to `stdout`.
- Rust writes human/debug logs to `stderr` only.
- TypeScript MUST treat any non-protocol `stdout` line as a protocol violation.

No TCP port, Unix socket, named pipe, or daemon transport is required in MVP.

## 2. Goals

- easy to inspect and record;
- cross-platform;
- deterministic lifecycle tied to child process;
- versionable;
- testable with fixtures;
- enough throughput for 60 FPS compact visualizer frames.

## 3. Envelope

Every message includes protocol version and type.

### Command

```json
{ "v": 1, "type": "command", "id": "01J...", "command": "play", "data": {} }
```

### Response

```json
{ "v": 1, "type": "response", "id": "01J...", "ok": true, "data": {} }
```

### Error Response

```json
{
  "v": 1,
  "type": "response",
  "id": "01J...",
  "ok": false,
  "error": { "code": "PLAYBACK_FAILED", "message": "Unable to start playback", "retryable": true }
}
```

### Event

```json
{ "v": 1, "type": "event", "event": "playback.changed", "seq": 42, "data": {} }
```

## 4. Versioning

`v` is the protocol major version.

Rules:

- incompatible envelope/semantic changes increment major;
- additive optional fields do not increment major;
- unknown optional fields MUST be ignored;
- unknown command/event names MUST be handled as unsupported rather than crashing;
- handshake rejects unsupported major versions before normal operation.

## 5. Handshake

After spawn, Rust emits or answers a handshake within a bounded startup timeout.

Suggested flow:

```text
TS → {command:"hello", data:{protocols:[1], uiVersion:"..."}}
Rust → response {protocol:1, playerVersion:"...", capabilities:[...]}
```

Capability examples:

- `lyrics.synced`
- `lyrics.plain`
- `visualizer.spectrum`
- `visualizer.waveform`
- `queue.mutation`
- `auth.single-token-session`

UI MUST capability-gate optional behavior.

Only implement queue mutations proven reliable by the selected librespot integration.

## 6. Command IDs

Use unique opaque IDs generated with the runtime cryptographic UUID primitive (for example `crypto.randomUUID()` in TypeScript). Ordering is not required for command correlation.

The Rust response MUST echo the command ID.

Events do not need request IDs but MUST carry monotonic `seq` per player process where ordering matters.

## 7. Core Commands

MVP command names:

```text
hello
auth.status
auth.begin
auth.logout
auth.get_web_token
playback.load
playback.play
playback.pause
playback.toggle
playback.next
playback.previous
playback.seek
playback.set_volume
playback.set_shuffle
playback.set_repeat
playback.set_autoplay
queue.get
queue.add
lyrics.get
visualizer.configure
player.status
shutdown
```

Only implement queue mutations proven reliable by the selected librespot integration (see capability gate above).

## 8. Playback Load

```json
{
  "v": 1,
  "type": "command",
  "id": "...",
  "command": "playback.load",
  "data": {
    "contextUri": "spotify:album:...",
    "trackUri": "spotify:track:...",
    "autoplay": true
  }
}
```

At least one supported context/track target is required.

Do not let the UI pass arbitrary librespot-specific load options.

## 9. Playback Events

### `playback.changed`

```json
{
  "v": 1,
  "type": "event",
  "event": "playback.changed",
  "seq": 120,
  "data": {
    "revision": 31,
    "state": "playing",
    "track": { "uri": "spotify:track:...", "name": "...", "artists": ["..."] },
    "positionMs": 92531,
    "durationMs": 238000,
    "volume": 0.8,
    "shuffle": false,
    "repeat": "off",
    "autoplay": true,
    "observedAtMonotonicMs": 5549201
  }
}
```

Domain fields may evolve additively.

### `playback.position`

Optional lightweight event for periodic reconciliation:

```json
{
  "v": 1,
  "type": "event",
  "event": "playback.position",
  "seq": 121,
  "data": { "positionMs": 93420, "revision": 31 }
}
```

Target approximately 4-5 Hz, not 60 Hz.

## 10. Queue Events

```json
{
  "v": 1,
  "type": "event",
  "event": "queue.changed",
  "seq": 130,
  "data": {
    "revision": 17,
    "current": { "uri": "spotify:track:...", "name": "..." },
    "previous": [],
    "next": []
  }
}
```

Queue `revision` is independent from generic event `seq` and represents queue data revision.

## 11. Lyrics

Response/event payload:

```json
{
  "kind": "synced",
  "language": "en",
  "lines": [
    { "startMs": 1230, "text": "..." },
    { "startMs": 4870, "text": "..." }
  ]
}
```

Plain lyrics omit `startMs` and use `kind:"plain"`.

## 12. Visualizer Configure

```json
{
  "v": 1,
  "type": "command",
  "id": "...",
  "command": "visualizer.configure",
  "data": {
    "enabled": true,
    "mode": "spectrum",
    "fps": 60,
    "bands": 64,
    "waveformSamples": 120
  }
}
```

Rust MAY clamp values to supported limits and returns effective configuration.

## 13. Visualizer Events

High-frequency messages MUST be minimal.

Spectrum:

```json
{
  "v": 1,
  "type": "event",
  "event": "visualizer.spectrum",
  "seq": 5001,
  "data": { "bands": [0.1, 0.2, 0.8, 0.4] }
}
```

Waveform:

```json
{
  "v": 1,
  "type": "event",
  "event": "visualizer.waveform",
  "seq": 5002,
  "data": { "samples": [-0.2, 0.1, 0.7, -0.4] }
}
```

No timestamps are necessary if each payload is render-now/latest-value data. `seq` allows detection of drops; dropped visualizer sequences are normal.

## 14. Auth Token Request

If TypeScript requires a Web API access token:

```json
{ "v": 1, "type": "command", "id": "...", "command": "auth.get_web_token", "data": {} }
```

Response:

```json
{"v":1,"type":"response","id":"...","ok":true,"data":{"accessToken":"...","expiresAtUnixMs":...}}
```

This response is sensitive:

- never log full payload;
- never cache/persist access token;
- diagnostic recorder MUST redact it.

An alternative future design may move HTTP into Rust to avoid token crossing IPC; MVP keeps Web API in TypeScript for simplicity.

## 15. Error Codes

Wire-stable codes:

```text
AUTH_REQUIRED
AUTH_DENIED
AUTH_FAILED
API_UNAVAILABLE
PLAYER_UNAVAILABLE
PLAYBACK_FAILED
AUDIO_DEVICE_UNAVAILABLE
LYRICS_UNAVAILABLE
INVALID_REQUEST
UNSUPPORTED
TIMEOUT
INTERNAL
```

Infrastructure-specific messages belong in optional redacted `detail`, not in stable code semantics.

## 16. Timeouts

Recommended initial bounds:

- hello/handshake: 5 s;
- normal local control command response: 2 s expectation, 5 s hard UI timeout;
- auth flow: interactive/no short command timeout after browser opened;
- shutdown grace: 2 s before force termination.

Network-backed operations may have separate cancellation/deadline policy.

## 17. Message Limits

To protect both processes:

- impose maximum NDJSON line size;
- recommended general cap: 1 MiB;
- visualizer lines should remain far below this cap;
- reject oversized input with `INVALID_REQUEST` and do not allocate unbounded buffers.

Lyrics or huge queue payloads approaching the cap SHOULD be bounded/paginated or represented efficiently rather than raising the cap casually.

## 18. Backpressure

### Commands/Responses

Preserve order and do not drop.

### Critical Events

Playback/queue/auth events must not be silently lost due to visualizer traffic. Use separate internal queues/priorities before serialization if required.

### Visualizer Events

Drop/replace freely; only latest frame matters.

## 19. stdout/stderr Discipline

Rust:

- protocol only on stdout;
- logs only on stderr;
- no `println!` debugging in production paths that writes to stdout.

CI SHOULD have a protocol harness that fails if unexpected stdout content appears.

## 20. Contract Testing

Maintain fixtures under `fixtures/protocol/v1/` containing:

- valid commands;
- valid responses;
- valid events;
- unknown additive fields;
- malformed JSON;
- unsupported version;
- oversized line;
- sensitive auth payload redaction cases.

Both TypeScript and Rust test suites consume the same fixtures.
