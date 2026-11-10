# Autopilot task queue

The server agent does the first unchecked item each run, top to bottom.
**Before boarding:** tick or delete anything already built on main, reorder as you like, push.

## Stage 2 — foveation + dual encode (mouse gaze)
- [ ] App shell: real app entry in `web/src/main.ts`, with the current codec/MediaPipe checks kept at `?smoke`. Video source (`video/source.ts`): a clip from `assets/clips/` if one exists, else a synthetic animated canvas at 1280×720 with fine detail (moving text, a face-like shape, textures). Mouse position = gaze.
- [ ] `video/foveate.ts` (WebGL2): 2–3 blur levels, per-pixel eccentricity in degrees from the gaze point (px_per_deg from BUILD_PLAN §4, default 60 px/°), Gaussian quality falloff, sharp inside radius r (default 7°). Output `new VideoFrame(canvas, {timestamp})`.
- [ ] `video/encoders.ts`: two VP9 `VideoEncoder`s, identical config, `latencyMode: 'realtime'`, `bitrateMode: 'quantizer'`, same QP (30), keyframe every 2 s on both; per-second byte counts.
- [ ] `metrics/stats.ts` + `ui/dashboard.ts`: live kbps for both streams and % saved (uPlot). Smoke test asserts the foveated stream is smaller over ~5 s.

## Stage 3 — metrics, modes, views
- [ ] `video/decoders.ts` + `metrics/psnr.ts` / `metrics/ssim.ts`: decode both streams, PSNR and SSIM inside the gaze circle and full-frame, every Nth frame. Show on dashboard.
- [ ] Bad-network mode: toggle reconfigures both encoders to `bitrateMode: 'constant'` with the same cap (500 kbps). Dashboard compares foveal PSNR baseline vs Glance.
- [ ] Views: viewer window (Glance decode only), "what was sent" window (decoded foveated frame + gaze spot + radius ring), dashboard window, via `window.open` + `BroadcastChannel`.
- [ ] `recorder.ts`: export gaze trace `{t, x, y, σ}` + clip id as JSON (download button).

## Stage 4 — differentiator (code paths only)
- [ ] Uncertainty-aware radius: `r = r0 + k·σ_total`, σ from rolling gaze variance over 500 ms (+ calibration residual term, 0 until Stage 1 calib exists), clamped 4°–12°; show σ and r on the dashboard.
- [ ] Face-prior saliency fusion (call mode): MediaPipe Face Detector on the *video*, posterior ∝ N(gaze, σ²)·(ε + S), only pulls within 2σ of raw gaze; on/off toggle.

## Blocked
