# Glance — Results

## Stage 0 — environment checks (Mon 9 Nov 2026)

`VideoEncoder.isConfigSupported` at 1280×720, 30 fps, `latencyMode: 'realtime'` (local Chrome):

| Codec | quantizer | constant (500 kbps) |
|-------|-----------|---------------------|
| VP9 `vp09.00.10.08` | OK | OK |
| AV1 `av01.0.04M.08` | OK | OK |
| AVC `avc1.42001F` | OK | OK |

Note: the plan's `avc1.42001E` (Level 3.0) **fails** at 720p — 720p needs Level 3.1, so use `42001F`.

Headless Chrome 157 on Linux (autopilot container): VP9 + AV1 OK in both modes; **AVC quantizer unsupported** (constant OK). Smoke test treats only VP9 as required.

MediaPipe Face Landmarker loads from vendored `/mediapipe/wasm` + `/mediapipe/models` (no CDN), ~250–500 ms. Network check (10 Nov): every request from the built app goes to localhost only.

UNISAL (pretrained, CPU, torch 2.15 + torchvision 0.29) runs unmodified on a 30-frame 720p test clip: 30 maps out, 1280×720, range 0–255. Needed `torchvision` in addition to pyfvvdp deps.
Run: `cd offline/unisal && TRAIN_DIR=training_runs ../../.venv/Scripts/python run.py predictions_from_folder <dir with images/> --is_video True`

## Stage 1 — gaze accuracy
_TODO_

## Experiments (Stages 3–4, offline harness)
Generated, regenerable report: [results_experiments.md](results_experiments.md) (`python3 offline/experiments/run.py --report`; raw data in `results/raw/`, charts in `results/charts/`).
Short version (synthetic gaze, call clips only): the equal-bandwidth quality claim is not supported (mean foveal PSNR gain -1.15 dB, positive in 5 of 29 conditions); equal-quality saving 1.5–15.9 % in 6 of 10 conditions, not reached in 4; simulated tracker error makes Glance lose in 21 of 21 conditions.
