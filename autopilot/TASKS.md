# Autopilot task queue

The server agent does the first unchecked item each run, top to bottom.
Rules: `autopilot/PROMPT.md`. Approach and experiment design: `plan.md`. Process: `docs/AGENT_TEAM.md`.
Feature freeze: **Sat 14 Nov 13:00 Helsinki**. After that, bug fixes and the final report only.

## Done
- [x] App shell, gaze plumbing, tracker, calibration, filter, validation (P1 complete; accuracy number is Aarav's to measure).
- [x] T0 session setup: `plan.md`, status format, container log, baseline smoke green, push works (done on the laptop, 13 Nov).
- [x] T1 research → `docs/research.md` (done on the laptop, 13 Nov).

## P2 — visible foveation demo
- [ ] T2 Real video source: `video/source.ts` reads `/clips/clips.json`, keys 1–9 switch clips, key `W` = live webcam as the source; the synthetic pattern only under `?smoke`/`?synthetic` for tests. Smoke asserts `source: clip` by default.
- [ ] T3 `video/foveate.ts` (WebGL2 pre-filter): full quality inside the fovea, smooth Gaussian falloff, heavy blur + downscale outside. Default radius 5° via `geometryFromUrl` px/deg, grows with `sigma`. Pure radius/falloff maths in its own file (`video/fovea.ts`) with unit tests; the Python harness (T6) must use the same formula. Output `new VideoFrame(canvas, {timestamp})`.
- [ ] T4 `video/encoders.ts` + `metrics/stats.ts`: two VP9 `VideoEncoder`s (normal vs Glance), identical config, realtime, same keyframe cadence (2 s); per-second kbps and % saved. Smoke asserts Glance < normal over ~5 s on a real clip.
- [ ] T5 Split screen + Reveal: left = decoded normal stream, right = decoded Glance stream, live kbps and "% bandwidth saved"; key `R` overlays the quality map (off by default). Then run the **full audit** (AGENT_TEAM §5).

## P3 — experiments (the evidence)
- [ ] T6 Harness core in `offline/experiments/` (Python + ffmpeg, see `plan.md`): foveation filter, libvpx-vp9 realtime CBR encode for baseline and Glance with identical flags, foveal/peripheral PSNR + SSIM vs the untouched source, VMAF on a gaze-following crop (skip with a logged note if ffmpeg lacks `libvmaf`), seeded gaze-trace generator, `run.py --quick`. Unit tests with numeric thresholds (identical input → infinite PSNR; mask area ≈ πr²; baseline vs itself → 0 % saved; radius ≥ diagonal → same bitrate as baseline).
- [ ] T7 Content + matrix: fetch busy-scene, screen/text and game/motion clips (URLs in `docs/research.md`; record licence in `web/public/clips/CREDITS.md`; if a download fails use the synthetic pattern, labelled). Run experiment A (equal foveal quality → kbps saved, by bisection) and B (equal kbps → quality gained) over the matrix in `plan.md`. Raw CSV/JSON to `results/raw/`.
- [ ] T8 Loss/jitter transport model (2 % loss, 100 ms jitter on 500 kbps and 1 Mbps) and the tracker-error run (fovea centred on a gaze estimate with 2°, 4° and 6° noise + 100 ms lag, quality measured at the true gaze). FovVideoVDP JOD on a subset if `pyfvvdp` imports.
- [ ] T9 Charts (PNG + data) and `docs/results.md`: headline table, the 3 strongest numbers each with its command, limitations, conditions where Glance loses. Skeptic re-runs one condition independently; Fact-checker re-derives every number.

## P4 — remaining
- [ ] T10 Bad-network mode in the app (key `B`: both encoders `bitrateMode: 'constant'` at 500 kbps; live foveal PSNR normal vs Glance), gaze-trace export (key `E`: JSON `{t, x, y, sigma}` + clip id, readable by the harness). Second full audit.
- [ ] T11 Final report at the top of `project_status.md` (PROMPT.md "Final report"), licence table in `docs/BUILD_PLAN.md` §5, then add the line `ALL DONE` below.

## Blocked
