# Glance — plan log (overnight run, Fri 13 Nov → Sat 14 Nov 13:00 Helsinki)

One entry per task: outcome, files, verification. Newest at the bottom.
Background: `docs/BUILD_PLAN.md`, `docs/COURSE_CORRECTION.md`. Queue: `autopilot/TASKS.md`.

## Overall approach
- Demo (P2) runs in the browser: WebGL2 pre-filter → two WebCodecs VP9 encoders → split screen.
- Evidence (P3) comes from an offline harness in `offline/experiments/` (Python + ffmpeg):
  deterministic, one command, VMAF + FovVideoVDP available. Encoder is `libvpx-vp9` realtime CBR
  (the library Chrome uses). Baseline and Glance differ only in the input frames.
- Gaze traces for experiments are seeded and synthetic (nobody can record one tonight); labelled as such.
- Cut order if short on time: AV1/H.264 → 1080p → sigma-adaptive fovea → P4 polish.
  Never cut: baseline-fairness checks, tracker-error run, final report.

## T0. Session setup
- Outcome: `plan.md`, `project_status.md` in the brief's §7 format, `autopilot/stopped_containers.md`,
  `autopilot/TASKS.md` rewritten to the new queue, `QUESTIONS_FOR_AARAV.md`.
- Verify: `npm run smoke` green on the starting commit; `git push server autopilot` works.
- Result (13 Nov ~01:00 Helsinki): smoke green on `b3c6f8b`; push to the server remote works; Docker not running on the laptop, nothing stopped.
- Change of venue: Aarav chose to continue on the home server (`autopilot/run.sh`). The image now has Python
  (numpy, opencv, matplotlib; pyfvvdp and a libvmaf ffmpeg if their installs worked) and the allowlist has `python3`.

## Experiment design (T6–T9)
Location `offline/experiments/`; entry point `python3 offline/experiments/run.py` (`--quick` = one condition
in < 2 min, `--all` = full matrix + charts + tables). Raw output `results/raw/`, charts `results/charts/`.

- **Pipeline per condition:** ffmpeg decodes the clip to raw frames at the target resolution/30 fps →
  baseline = frames as they are; Glance = frames through the foveation filter centred on the trace →
  both encoded by the same ffmpeg command → decoded → metrics against the UNTOUCHED source frames.
- **Encoder (fair baseline):** `libvpx-vp9`, realtime, CBR, no lag, keyframe every 2 s; exact flags from
  `docs/research.md`. Unconstrained profile = the service-typical bitrate for that resolution (research.md).
- **Foveation filter:** identical formula to `web/src/video/fovea.ts`: weight w(e) = 1 for e ≤ r, then
  Gaussian falloff; output = mix(sharp, blurred-downscaled, 1 − w). r from degrees via px/deg
  (60 cm, 31 cm-wide view by default, same as `geometryFromUrl`). Sigma-adaptive: r = r0 + k·sigma, clamped.
- **Metrics:** PSNR and SSIM inside the gaze circle (mask radius = the nominal fovea radius, fixed across the
  two streams) and in the periphery; VMAF on a square gaze-following crop; FovVideoVDP JOD on a subset;
  achieved kbps (bytes actually produced, not the target); encoded fps, frozen/dropped frames; latency in the
  transport model.
- **Experiment A:** bisection on the Glance target bitrate until foveal PSNR is within 0.5 dB of baseline
  (or SSIM within 0.01); report kbps each and % saved. **Experiment B:** same cap for both.
- **Matrix:** content {talking head, busy scene, screen/text, game/motion} × resolution {360p, 720p, 1080p
  only where the source is ≥1080p} × network {300, 500, 1000, 2500 kbps, unconstrained; 2 % loss and 100 ms
  jitter variants on 500 and 1000} × fovea {3°, 5°, 8°, sigma-adaptive}. VP9 first; AV1/H.264 if time allows.
- **Transport model (loss/jitter):** seeded; frames split into 1200-byte packets; a lost packet makes the frame
  and everything up to the next keyframe undisplayable (freeze on the last good frame); jitter beyond the
  jitter buffer counts as a late (dropped) frame. Same seed and rule for both streams. It is a model, not a
  real network, and results.md must say so.
- **Gaze traces:** seeded fixations (200–600 ms) + saccades, biased towards faces/centre; JSON
  `{t, x, y, sigma}` in normalised coordinates, same format the app exports (T10). Labelled synthetic.
- **Tracker-error run:** fovea centred on trace + 2°, 4° and 6° Gaussian noise (webcam error per docs/research.md §4) + 100 ms lag; metrics at the true gaze.
- **Sanity gates (fail the run, not just warn):** baseline vs itself = 0 % saved; radius ≥ frame diagonal =
  baseline bitrate and quality within noise; frame counts equal before any metric; achieved kbps within
  ±15 % of the cap or the condition is flagged.

## Task: recorder.ts (autopilot run, 13 Nov)
- Outcome: key G starts/stops recording the gaze trace; stopping downloads JSON `{format, clip, source, synthetic:false, width, height, samples:[{t,x,y,sigma}]}` (x,y normalised 0..1, same shape as the T6 generator).
- Files: web/src/gaze/recorder.ts, web/tests/recorder.test.ts, web/src/app.ts (key G, status text), web/scripts/smoke.mjs (bad-network floor 50 -> 10 kbps; headless 12-pair runs measured 44-78 kbps).
- Verification: unit tests (normalisation, clamp, NaN skip, cap, round trip) and `npm run smoke` green.

## Task: status checklist + audit (autopilot run, 13 Nov)
- Outcome: `project_status.md` converted to PROMPT.md section format with the 5-minute "test this first" checklist at the top; audit of the P1/P2 work.
- Files: project_status.md, MEMORY.md, autopilot/TASKS.md.
- Verification: clean `git worktree` + `npm ci && npm run smoke`, grep built bundle for external URLs, smoke network log line (0 external requests), status checked against `git log`.
- Docs-only; numbers come from smoke output, so fact-check = compare to smoke output.
