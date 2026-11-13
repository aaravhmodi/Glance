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
- [x] `video/encoders.ts` + `metrics/stats.ts`: two VP9 encoders (normal vs Glance), identical config, realtime, quantizer mode same QP, keyframe every 2 s; per-second kbps and % saved. Smoke test asserts Glance is smaller over ~5 s on a real clip.
- [x] Split-screen demo mode: left = what a normal stream sends, right = what Glance sends (decoded), live kbps and "% bandwidth saved" for each.
- [x] "Reveal" toggle (key `R`, off by default): overlay the quality map so judges see where the bits go.
- [x] `project_status.md`: the 5-step "how to test it when I'm back" checklist at the top (open app → calibrate → validate → look around a clip → split screen/reveal), plus status of P1/P2. Then a full audit (AGENT_TEAM §5).

## P3 — old Stage 3+
- [x] Decoding + foveal PSNR/SSIM (inside the gaze circle and full frame, every Nth frame) on the dashboard.
- [x] Bad-network mode: both encoders `bitrateMode: 'constant'` at the same cap (500 kbps); compare foveal PSNR normal vs Glance.
- [ ] `recorder.ts`: export gaze trace `{t, x, y, sigma}` + clip id as JSON.
- [ ] T6 Harness core in `offline/experiments/` (Python + ffmpeg; design in `plan.md`, sources in `docs/research.md`): port the foveation formula from `web/src/video/fovea.ts` exactly, libvpx-vp9 realtime CBR encode for baseline and Glance with identical flags, foveal/peripheral PSNR + SSIM vs the untouched source, VMAF on a gaze-following crop (skip with a logged note if ffmpeg lacks `libvmaf`), seeded gaze-trace generator, `run.py --quick`. Unit tests with numeric thresholds (identical input → infinite PSNR; mask area ≈ πr²; baseline vs itself → 0 % saved; radius ≥ diagonal → same bitrate as baseline).
- [ ] T7 Content + matrix: fetch busy-scene, screen/text and game/motion clips (URLs in `docs/research.md` §7; record licence in `web/public/clips/CREDITS.md`; if a download fails use the synthetic pattern, labelled). Run experiment A (equal foveal quality → kbps saved, by bisection) and B (equal kbps → quality gained) over the matrix in `plan.md`. Raw CSV/JSON to `results/raw/`.
- [ ] T8 Loss/jitter transport model (2 % loss, 100 ms jitter on 500 kbps and 1 Mbps) and the tracker-error run (fovea centred on a gaze estimate with 2°, 4° and 6° noise + 100 ms lag, quality measured at the true gaze). FovVideoVDP JOD on a subset if `pyfvvdp` imports.
- [ ] T9 Charts (PNG + data) and `docs/results.md`: headline table, the 3 strongest numbers each with its command, limitations, conditions where Glance loses; every number regenerated by `python3 offline/experiments/run.py --all`. Skeptic re-runs one condition independently; Fact-checker re-derives every number.
- [ ] License auditor pass (AGENT_TEAM §4): fill the license table in `docs/BUILD_PLAN.md` §5 from the actual repos.
- [ ] T11 Final report at the top of `project_status.md` (see `autopilot/PROMPT.md` "Final report"), in the section format PROMPT.md lists. Then add the line `ALL DONE` below.

## Blocked
