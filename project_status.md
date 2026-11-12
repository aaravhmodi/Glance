# Glance — project status

## How to test it when I'm back
(Checklist is written at the end of the P2 queue; not ready yet. P1 so far: gaze plumbing only, no eye tracker yet.)

## Status
- P1: gaze plumbing done (mouse source, M toggle, 0.5 s no-face fallback). Tracker done (webcam → Face Landmarker → features; verified with a fake webcam file cut from talking-heads). Calibration done (key C, 9 dots, ridge poly regression; ~12 s happy path). Next: filter, validation.
- Note: head-pose sign conventions (yaw/pitch) are not verified against real head turns; calibration's regression absorbs signs, but check if the pose features look odd.

## Research & review log
- Tracker — researcher: 478-pt indices (iris 468/473, corners 33/133, 263/362) from MediaPipe face_landmarks_connections.ts; transform matrix is column-major 4x4 (matrix_data.proto); y4m fake-webcam details were from memory and confirmed empirically by the smoke test — reviewer: PASS (round 1; fixed weak sanity check + loop error handling) — fact-check: ok (no numbers in docs)
- Calibration — researcher: ridge on z-scored features, intercept unpenalised, λ by leave-one-out CV (WebGazer uses fixed 1e-5 on raw pixels, util_regression.mjs); dot dwell/margin numbers were NOT from a primary source (researcher's own knowledge) — reviewer: PASS (round 3; r1: uncommitted work, unbounded time, tracker-failure hang; r2: <7-dot fits, flaky smoke; r3 could not run smoke, I ran it twice green) — fact-check: ok (no numbers in docs). Known gaps: overlay positioned once (resize mid-calibration unhandled); smoke face is static so its sigma (~500 px) is meaningless.
- Gaze plumbing — researcher: use `e.key.toLowerCase()`, skip `e.repeat` and ctrl/meta/alt (MDN KeyboardEvent docs); event timeStamp and rAF time share performance.now() origin (MDN) — reviewer: PASS (round 1; notes: sigma NaN not checked yet, add when tracker lands) — fact-check: ok (no numbers/docs claims)
