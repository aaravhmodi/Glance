# Glance — Results

## Stage 0 — environment checks (Mon 9 Nov 2026)

`VideoEncoder.isConfigSupported` at 1280×720, 30 fps, `latencyMode: 'realtime'` (local Chrome):

| Codec | quantizer | constant (500 kbps) |
|-------|-----------|---------------------|
| VP9 `vp09.00.10.08` | OK | OK |
| AV1 `av01.0.04M.08` | OK | OK |
| AVC `avc1.42001F` | OK | OK |

Note: the plan's `avc1.42001E` (Level 3.0) **fails** at 720p — 720p needs Level 3.1, so use `42001F`.

MediaPipe Face Landmarker loads from vendored `/mediapipe/wasm` + `/mediapipe/models` (no CDN), ~250–500 ms.

## Stage 1 — gaze accuracy
_TODO_
