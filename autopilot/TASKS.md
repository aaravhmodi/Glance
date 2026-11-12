# Autopilot task queue

The server agent does the first unchecked item each run, top to bottom.
Priorities come from `docs/COURSE_CORRECTION.md` (P1 → P2 → P3). Process rules: `docs/AGENT_TEAM.md`.

## Done
- [x] App shell: `?smoke` page kept, app entry, source abstraction, mouse position.

## P1 — real eye tracking (laptop webcam + computer vision)
- [x] `gaze/types.ts` + gaze plumbing: the `GazeSource` interface `{x, y, sigma, timestamp, confidence}` (screen px), a mouse source, and a switch: key `M` toggles mouse/eyes, automatic fallback to mouse when no face for ~0.5 s, current source shown on screen. Replace the app's direct mouse use with it.
- [x] `gaze/tracker.ts`: getUserMedia webcam → Face Landmarker (VIDEO mode, vendored files) → per-frame features: iris centres relative to eye corners (normalised by eye width) for both eyes, head pose from the facial transformation matrix, face scale. **Test:** make a fake-webcam file from `web/public/clips/talking-heads.mp4` with ffmpeg (`.y4m` or `.mjpeg`) and launch Chrome in the smoke test with `--use-file-for-fake-video-capture=<file>` so a real face is detected end to end.
- [x] `gaze/calib.ts`: 9-point calibration screen (~1 s per dot, drop the first 300 ms), ridge regression on 2nd-order polynomial features → screen x,y; residual σ kept; key `C` recalibrates; target under 30 s total. Unit-test the regression on synthetic features with a known mapping.
- [x] `gaze/filter.ts`: One-Euro filter + saccade snap (large fast jump → bypass the filter). Unit-test both behaviours on synthetic traces.
- [x] `gaze/validate.ts`: 20-dot validation screen; mean and max error in degrees at a configurable distance (default 60 cm, px/cm from screen size); GO / GO-with-big-fovea / PIVOT per BUILD_PLAN Stage 1 thresholds. Aarav runs it himself; the smoke test only checks the screen runs and produces a report.

## P2 — make the effect visible (this is the demo)
- [x] Real video source: play the clips from `/clips/clips.json` full-screen (picker + keys 1–3), live webcam as an extra source; the synthetic pattern only remains for tests.
- [x] `video/foveate.ts` (WebGL2): full quality in the fovea, smooth Gaussian falloff, heavy blur + downscale outside. Default radius 5° (≈250–300 px at 60 cm on a laptop), growing with sigma. Output `new VideoFrame(canvas, {timestamp})`. (WebCodecs QP is per frame, not per region — see BUILD_PLAN §4 — so the "lower quantizer in the fovea" part is not possible in-browser; note that in project_status.md.)
- [ ] `video/encoders.ts` + `metrics/stats.ts`: two VP9 encoders (normal vs Glance), identical config, realtime, quantizer mode same QP, keyframe every 2 s; per-second kbps and % saved. Smoke test asserts Glance is smaller over ~5 s on a real clip.
- [ ] Split-screen demo mode: left = what a normal stream sends, right = what Glance sends (decoded), live kbps and "% bandwidth saved" for each.
- [ ] "Reveal" toggle (key `R`, off by default): overlay the quality map so judges see where the bits go.
- [ ] `project_status.md`: the 5-step "how to test it when I'm back" checklist at the top (open app → calibrate → validate → look around a clip → split screen/reveal), plus status of P1/P2. Then a full audit (AGENT_TEAM §5).

## P3 — old Stage 3+
- [ ] Decoding + foveal PSNR/SSIM (inside the gaze circle and full frame, every Nth frame) on the dashboard.
- [ ] Bad-network mode: both encoders `bitrateMode: 'constant'` at the same cap (500 kbps); compare foveal PSNR normal vs Glance.
- [ ] `recorder.ts`: export gaze trace `{t, x, y, sigma}` + clip id as JSON.
- [ ] Results table in `docs/results.md`: clip × bytes saved × foveal PSNR, each number reproducible by a script (fact-checked).
- [ ] License auditor pass (AGENT_TEAM §4): fill the license table in `docs/BUILD_PLAN.md` §5 from the actual repos.

## Blocked
