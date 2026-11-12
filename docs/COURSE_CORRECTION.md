# COURSE CORRECTION: read this before anything else

> From Aarav, 11 Nov: "It should be using my laptop camera and computer vision to track eye gaze."
> Clips are now in `web/public/clips/` (served at `/clips/`, list in `/clips/clips.json`, credits in `CREDITS.md`).

The current app shows a synthetic test pattern with a mouse-driven circle.
That is NOT the product. Stop polishing it. The product is:

**Glance: the webcam tracks where the user's eyes are looking on screen, and
the video gets high quality exactly where they look and low quality everywhere
else, saving bandwidth without the user noticing.**

## New priority order (replaces Stage order in TASKS.md)

### P1. Real eye tracking (was Stage 1, now YOUR job to build)
- Use the locally served MediaPipe Face Landmarker (already vendored) with
  iris landmarks from the real webcam (getUserMedia). Synthetic/fake webcam is
  for automated tests only.
- Gaze estimation: iris position relative to eye corners plus head pose,
  mapped to screen coordinates with a regression fitted during calibration.
- 9-point calibration screen: the user looks at each dot and you sample about
  1 second of frames per dot. Then fit the mapping (polynomial or ridge
  regression). Store it in memory and allow recalibrating with one key.
- Smoothing: One-Euro filter, with saccade snap (jump immediately on large,
  fast movements instead of lagging).
- 20-dot validation screen that reports mean and max error in degrees
  (assume 60 cm viewing distance; make it configurable). Show GO / GO-with-big-
  fovea / PIVOT using the thresholds in BUILD_PLAN.md. Aarav runs this himself.
- Emit everything through the existing GazeSource interface
  `{x, y, sigma, timestamp, confidence}`. Mouse stays as a fallback
  (toggle with a key, and automatic if face tracking is lost).
- Automated test: feed recorded landmark sequences or a known synthetic face
  and check the pipeline runs end to end. The accuracy number itself comes
  from Aarav's manual run.

### P2. Make the effect visible: this is the demo
- Source video: a real clip from `clips/` (or the live webcam) playing
  full-screen, NOT the test pattern. If no clips exist yet, use the live
  webcam as the source and log that clips are needed.
- Foveation: full quality inside the gaze region, smooth falloff, heavily
  reduced quality outside (blur and downscale before encode, plus a lower
  quantizer in the fovea if the encoder allows).
- Fovea size must be realistic and visible: default radius about 5° of
  visual angle (around 250–300 px on a laptop at 60 cm), growing with sigma
  when tracking is uncertain. The current tiny circle is far too small.
- Split-screen demo mode: left = what a normal stream sends, right = what
  Glance sends, with live kbps and "% bandwidth saved" for each.
- "Reveal" toggle that shows the quality map as an overlay, so judges can see
  where the bits are going. Off by default, so the viewer experiences it the
  way a real user would.

### P3. Then continue with the old Stage 3+ items
Decoding, foveal PSNR/SSIM, Bad-network mode, results table.

## Definition of done for P1 + P2
Aarav opens the app, calibrates in under 30 seconds, looks around a real
video, and the sharp region follows his eyes while the dashboard shows
bandwidth saved. Write a 5-step "how to test it when I'm back" checklist at
the top of project_status.md.
