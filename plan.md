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

## Task: T9 charts + results doc (autopilot run, 14 Nov)
- T7b still blocked (curl to Xiph not allowed); T9 taken. matplotlib is not installed, so charts are hand-written SVG.
- Outcome: `offline/experiments/report.py` (`run.py --report`) regenerates `docs/results_experiments.md` + `results/charts/*.svg` from `results/raw/*.json`: Exp A/B, tracker-error and transport tables, headline table, limitations, losing conditions.
- Verify: `test_report.py` (SVG validity, bar sign/length, doc numbers equal values recomputed from raw JSON); 26 Python tests; smoke. No new measurements.

## Task: T6 offline harness core (autopilot run, 13 Nov)
- Finding: this image has NO numpy/cv2/pyfvvdp and ffmpeg has NO libvmaf. Harness is therefore pure Python 3 (stdlib) + ffmpeg filters
  (gblur/scale/maskedmerge/psnr/ssim); VMAF and FovVideoVDP are skipped with a logged note (never faked).
- Outcome: `offline/experiments/` with fovea.py (port of web/src/video/fovea.ts weights; blend = mix(sharp, ~11x-downscaled periphery, 1-w), a
  2-level approximation of the shader's continuous LOD), traces.py (seeded synthetic gaze JSON), pipeline.py (libvpx-vp9 realtime CBR with flags from research.md §2; foveal/peripheral PSNR+SSIM via masked ffmpeg psnr/ssim,
  SSIM-in-disc approximated, see docstring), run.py --quick, test_harness.py (13 tests).
- Result: reviewer PASS round 1. Quick run (call-desk 720p, 500 kbps CBR, 90 frames, synthetic gaze): baseline 519 kbps vs Glance 507 (CBR fills the cap, so equal-bitrate case),
  foveal PSNR 43.5 vs 40.5 dB: at this easy content/bitrate Glance does NOT win; the bisection in T7 decides. Not a headline number.
- Verify: `python3 -m unittest discover -s offline/experiments -p "test_*.py"`: identical -> PSNR cap, mask area within 1 % of pi r^2, baseline vs itself 0 % saved,
  radius >= diagonal -> Glance bytes == baseline bytes, trace determinism; `run.py --quick` writes results/raw/quick.json. Smoke stays green.

## Task: T7 content + experiments A/B (autopilot run, 13 Nov)
- Blocker: every `curl` to media.xiph.org needed approval and was refused in this run, so the busy / screen-text / game clips were NOT fetched (not retried, not worked around). T7 is split: T7a (this run) = experiments A and B on the three real call clips in `web/public/clips/`; T7b = fetch the Xiph clips and rerun (Blocked until curl is allowed).
- Outcome: `offline/experiments/experiments.py` (A: bisection for the lowest Glance kbps whose foveal PSNR is within 0.5 dB of baseline, else "not reached"; B: equal CBR caps), `run.py --ab` writes `results/raw/exp_a.json`, `exp_b.json`. Matrix: 3 clips x {360p, 720p} x caps {300,500,1000,2500} (360p <= 1000), fovea 3/5/8 deg, 3 seeded synthetic traces on one clip.
- Verify: unit tests (15, incl. A/B self-consistency), `python3 offline/experiments/run.py --ab`, smoke. Skeptic re-runs one condition.
- Finding: Glance frames are bit-exact inside the fovea before encoding (100 dB, `probe_pre.py`), yet after VP9 CBR foveal PSNR is 0.8-3 dB BELOW baseline at equal bitrate on call-desk (2500: 48.0 vs 48.8; 1000: 44.2 vs 46.0; 500: 40.5 vs 43.5).

## Task: T8 transport model + tracker-error run (autopilot run, 14 Nov)
- T7b still blocked (curl to media.xiph.org refused again, not worked around); T8 taken instead.
- Researcher: not spawned; research.md §3 (1200-byte packets, freeze until keyframe, kVideoMtu) and §4 (WebGazer 4.17°, webcam 90th pct 6.3-8°) already hold the sources. Jitter-buffer size is our own parameter, stated in results.
- Outcome: `transport.py` (seeded loss + jitter model, pure, unit-tested), `t8.py` (transport_experiment, tracker_error_experiment), `test_transport.py`, `run.py --t8` -> `results/raw/exp_transport.json`, `exp_tracker.json`.
- Transport: 1200 B packets per frame, each lost with p = 2 % (rng seeded by (seed, frame, packet): both streams see the same draws); frame delay half-normal sd 50 ms, jitter buffer 100 ms, later = dropped; a missing frame breaks decoding until the next keyframe, viewer sees the last good frame (grey before the first keyframe). Same cap for both; several seeds, mean + worst.
- Tracker error: fovea centred on trace + AR(1) Gaussian noise (mean radial error 0/2/4/6 deg) + 100 ms lag; fixed 5 deg radius vs sigma-adaptive radius (sigma = error); scored at the TRUE gaze (5 deg disc); baseline = same cap.
- FovVideoVDP / VMAF skipped (not installed), noted in the JSON.
- Verify: unit tests (loss 0 -> identity; loss 1 -> nothing shown; freeze until keyframe; frame-loss rate near 1-(1-p)^k; determinism; noise mean radial error within 10 % of target); `run.py --t8`; smoke. Skeptic re-runs one condition.

## T12. Per-block quality ("grid") foveation: research, build, heavy test (13 Nov, laptop, ~1 h, 4 agents)
Why: T7a/T8 showed the blur pre-filter loses at equal bitrate on static call clips. Hypothesis: a blur that moves with
the gaze changes the whole picture, so the encoder re-sends background it could skip; a per-block quality map does not.
First probes (call-plants 720p, 300 kbps, static 400x400 region): x264 + ffmpeg `addroi` gives +2.3 dB in the region
(stream 10 % larger, so not yet a fair number); libvpx-vp9 ROI (needs aq-mode 0, realtime) makes the encoder drop
frames (15-79 of 90 kept) and is worse everywhere. `addroi` has no timeline/commands, so a moving region needs plumbing.
- Agent 1 Researcher: published evidence for per-block QP vs pre-filter foveation; exact `addroi`/x264/libvpx ROI semantics;
  browser-feasible equivalents. → report, lead adds to `docs/research.md`.
- Agent 2 ROI builder: `offline/experiments/roi.py` + `test_roi.py`: moving per-block region for libx264 (identical flags to
  an H.264 baseline), scored with the existing `pipeline.measure`.
- Agent 3 Layers builder: `offline/experiments/layers.py` + `test_layers.py`: the browser-feasible version (low-res full
  frame + sharp grid-snapped crop around the gaze, two VP9 streams, same total kbps as the baseline).
- Agent 4 Skeptic: `offline/experiments/skeptic.py`: tries to break the existing numbers (fairness, masks, alignment,
  drops) and tests the hypothesis directly (blur with a fixed gaze vs a moving one; calmer call-like traces).
- Lead: finishes the 6-clip A/B matrix, integrates, runs the three methods on the same conditions, report + docs, commit, push.
Verify: Python unit tests green, smoke green, every number regenerated by a command in `docs/results_experiments.md`.
Rule: agents write only their own files and their own `results/tmp/<name>` dir; only the lead commits.
