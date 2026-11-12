# Glance — project status

## How to test it when I'm back
(Checklist is written at the end of the P2 queue; not ready yet. P1 so far: gaze plumbing only, no eye tracker yet.)

## Status
- P1: gaze plumbing done (mouse source, M toggle, 0.5 s no-face fallback). Next: tracker, calibration, filter, validation.

## Research & review log
- Gaze plumbing — researcher: use `e.key.toLowerCase()`, skip `e.repeat` and ctrl/meta/alt (MDN KeyboardEvent docs); event timeStamp and rAF time share performance.now() origin (MDN) — reviewer: PASS (round 1; notes: sigma NaN not checked yet, add when tracker lands) — fact-check: ok (no numbers/docs claims)
