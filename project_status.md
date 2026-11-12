# Glance: Project Status
_Last updated: Fri 13 Nov 2026 01:30 Helsinki by autopilot (laptop session, handing over to the server run)_

## FINAL REPORT (fill in when stopping)
Not written yet.

## Now
T2 real video source (first unchecked item in `autopilot/TASKS.md`).

## Done (newest first): task, commit, verification + key numbers
- T1 research → `docs/research.md` (laptop, 13 Nov). Sources linked there.
- T0 session setup (laptop, 13 Nov): `plan.md`, this format, new task queue, `autopilot/stopped_containers.md`, `QUESTIONS_FOR_AARAV.md`. `npm run smoke` green on `b3c6f8b`; push to the server remote works.
- P1 stability, `e1c0117`: linear calibration model (1 + 5 features), `SD_FLOOR` 0.03, One-Euro `minCutoff` 0.35. Unit tests + smoke. Not yet confirmed by Aarav on his face.
- P1 validation, `8a91529`: key T, 20 dots, degree error, GO / GO-with-big-fovea / PIVOT. Smoke checks that it runs and reports; the accuracy number is Aarav's.
- P1 filter, `cde0581`: One-Euro + confirmed saccade snap. Unit tests.
- P1 calibration, `b8cefb0`: key C, 9 dots, ridge regression, about 12 s happy path. Unit tests + smoke on a real face (fake webcam).
- P1 tracker, `155d87b`: webcam → Face Landmarker → features. Smoke detects a real face from a clip.
- P1 gaze plumbing, `4f8fe82`: `GazeSource`, mouse source, key M, 0.5 s no-face fallback.

## Next
T2 → T11 in `autopilot/TASKS.md`. Experiment design in `plan.md`.

## Blocked: task, why, what was tried, what Aarav must do
- Gaze accuracy number: needs Aarav's own eyes. Open the app, press C, then T; write the result in `docs/results.md`.

## Known bugs
- Head-pose sign conventions (yaw/pitch) are not verified against real head turns; the calibration regression absorbs signs.
- Calibration overlay is positioned once; resizing the window mid-calibration is not handled.
- Filter parameters are untuned guesses until tried on real gaze data.

## Decisions log
- 13 Nov: run moved from the laptop to the home-server autopilot at Aarav's request. One task per run, pushes to `autopilot`.
- 13 Nov: experiments run in an offline Python + ffmpeg harness (`libvpx-vp9` realtime CBR), not in the browser: deterministic and one-command reproducible. The app keeps its own live numbers for the demo.
- 13 Nov: experiment gaze traces are seeded and synthetic (nobody can record one overnight); always labelled.
- 13 Nov: no containers stopped (`autopilot/stopped_containers.md`); the `KEEP_RUNNING` list in the brief was empty.
- 13 Nov: autopilot image gained Python packages and, if the download worked, an ffmpeg with `libvmaf`. Both are optional layers: a missing metric is skipped and said so in the results.
- WebCodecs QP is per frame, not per region, so foveation is a pre-filter before encoding (BUILD_PLAN §4).

## Research & validation log: task, researcher finding + source, reviewer PASS/FAIL (round), skeptic verdict, fact-check
- T1 research — three researchers (call bitrates + network emulation; foveated coding + metrics; WebCodecs/WebGL2 + test clips); findings and links in `docs/research.md`; items not confirmed from a primary source are marked there.
- Validation — researcher: deg = atan(size/distance) (SR Research visual-angle page); browsers expose no physical screen size, so screen width is a URL param — reviewer: PASS (round 1) — fact-check: ok.
- Tracker — researcher: 478-pt indices (iris 468/473, corners 33/133, 263/362) from MediaPipe face_landmarks_connections.ts; transform matrix column-major 4x4 — reviewer: PASS (round 1) — fact-check: ok.
- Calibration — researcher: ridge on z-scored features, intercept unpenalised, λ by leave-one-out CV; dot dwell/margin numbers NOT from a primary source — reviewer: PASS (round 3) — fact-check: ok.
- Filter — researcher: One-Euro formulas match Casiez CHI 2012; defaults are untuned guesses — reviewer: PASS (round 1) — fact-check: ok.
- Gaze plumbing — researcher: `e.key.toLowerCase()`, skip `e.repeat` and modifiers (MDN) — reviewer: PASS (round 1) — fact-check: ok.

## Headline numbers
| Content | Res | Network | Codec | Fovea | Baseline kbps | Glance kbps | % saved | Foveal PSNR base/Glance | Foveal VMAF base/Glance |
|---|---|---|---|---|---|---|---|---|---|
| (none yet: experiments start at T6) | | | | | | | | | |
