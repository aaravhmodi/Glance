# Glance — build memory

Running log of what's built. Newest stage at the bottom. Details/numbers live in `docs/results.md`.

## Stage 0 — Setup ✅ (9–10 Nov)
- **Repo:** this folder is the repo root. `web/` = Vite + TS (vanilla). `offline/` = Python. `.venv/` at root.
- **Offline deps:** MediaPipe models in `web/public/mediapipe/models/` (committed). WASM copied from `node_modules` on `npm install` (postinstall) → `web/public/mediapipe/wasm/` (git-ignored).
- **Smoke page** (`web/src/main.ts`): checks WebCodecs configs + loads Face Landmarker locally. All requests are localhost-only (verified in Chrome).
- **Codecs:** VP9, AV1, AVC all OK at 720p (quantizer + constant). AVC must be `avc1.42001F` (L3.1) — `42001E` fails at 720p.
- **Python:** torch 2.15 CPU, torchvision, pyfvvdp 1.2.2, opencv. UNISAL cloned to `offline/unisal` (git-ignored, Apache-2.0); pretrained run works on CPU.
- **Secrets:** `.env` at root holds `OPENAI_API_KEY` (git-ignored). Never import it into `web/`.
- **Open:** pick demo clips → `assets/clips/`; fill license table; real Wi-Fi-off test.

## Home server deploy ✅ (10 Nov)
- **Where:** `aaravdagoat` (Tailscale `100.76.57.23`), folder `~/projects/glance`, container `glance-web-1` = nginx on `127.0.0.1:8095`.
- **Deploy:** `git push server main`. Remote is a private bare repo on the server (`~/git/glance.git`), not GitHub. Cron `deploy.sh` rebuilds within ~1 min; log in `~/homelab/auto-deploy/deploy.log`.
- **HTTPS (needed for webcam + WebCodecs):** `tailscale serve` on `https://aaravdagoat.tail732914.ts.net:8445`, tailnet-only (one-time sudo by user).
- **Offline:** the server needs the tailnet → no use on the plane. Offline = laptop `npm run build && npm run preview`.

## Autopilot (10 Nov)
- **What:** `autopilot/` runs Claude Code headless on the home server while I'm offline: one `autopilot/TASKS.md` item per run → build + `npm run smoke` → commit → `run.sh` pushes branch `autopilot` + ntfy push. How-to in `autopilot/README.md`.
- **Safety:** container sees only the repo; tool allowlist (edit, npm ci/build/smoke, git add/commit, ffmpeg), no permission bypass; only the host script pushes, never to main.
## Stage 2 — foveation + dual encode (in progress)
- **App shell ✅:** `web/src/main.ts` dispatches: `?smoke` → `smoke.ts` (old codec/MediaPipe checks), else `app.ts` (canvas `#view` + `#status`, mouse = gaze in 1280×720 coords, exported `gaze`). `video/source.ts`: uses `/clips/clip.mp4` if served (put in `web/public/clips/`), else synthetic animated canvas. No clips exist yet.

## Autopilot notes
- **Smoke test:** `cd web && npm run smoke` = build + headless real Chrome (Playwright, fake webcam) on `?smoke`; fails on any `FAIL` line. Extend it per feature.

## Course correction (11 Nov)
- **Product focus:** real webcam eye tracking (P1) → visible foveation on real video with split screen + reveal (P2) → metrics/bad-network (P3). Source of truth: `docs/COURSE_CORRECTION.md`; agent process: `docs/AGENT_TEAM.md` (researcher → reviewer → fact-check subagents).
- **Clips:** 3 single-shot video-call clips from Mixkit (Mixkit free license) in `web/public/clips/` (`call-desk`, `call-plants`, `call-teacher`; 720p H.264, ~6 MB), manifest `clips.json`, credits `CREDITS.md`. (Replaced the Tears of Steel movie scenes: Aarav wants video-call footage.)
- **Autopilot:** allowlist now adds WebSearch/WebFetch/subagents; queue rewritten P1→P3 (16 tasks), MAX_RUNS 20.

## P1 — real eye tracking
- **Gaze plumbing ✅:** `web/src/gaze/{types,mouse,switch}.ts`. `GazeSwitch.read(now)` returns `{source, fallback, sample}`; key `M` toggles mouse/eyes; in eyes mode it holds the last good sample 500 ms, then falls back to the mouse (status line shows `gaze[mouse (fallback: no face)]`). The tracker just implements `GazeSource` (`name:'eyes'`, `read()`) and calls `gazeSwitch.setEyes(...)`.
- **Tracker ✅:** `gaze/features.ts` (pure: iris offsets in eye widths per eye, head pose from the matrix, scale; `featureVector()` = mean iris u,v + yaw, pitch) and `gaze/tracker.ts` (`EyeTracker`: getUserMedia → FaceLandmarker GPU→CPU fallback; `latest` features, `mapper` set by calibration makes `read()` return a sample). Started lazily on first `M` in `app.ts`; exposed as `window.glanceTracker`.
- **Smoke:** cuts a y4m from call-desk with ffmpeg and runs Chrome with `--use-file-for-fake-video-capture`; a real face is detected (~11 faces in a few s).
- **Calibration ✅:** `gaze/regression.ts` (pure: z-scored 4 features → 15-term poly, ridge with unpenalised intercept, λ by leave-one-dot-out CV, σ = that CV RMS, Cholesky) and `gaze/calib.ts` (9 dots corners-first, drop 300 ms + sample 1 s, per-dot median, ≥7 dots needed, 30 s cap; installs `tracker.mapper`, clamps to the 1280×720 view). Key C calibrates (starts tracker, switches to eyes), Esc cancels, M ignored meanwhile. `?slowcam` URL flag = test-only hook (min 1 sample/dot, 120 s cap) for the slow headless tracker.
- **Tests:** `npm test` = `node --test tests/*.test.ts` (Node 24 strips types; import with `.ts` extensions); `npm run smoke` now runs build + tests + Chrome.
- **Validation ✅:** `gaze/accuracy.ts` (pure: px→deg = atan(err/pxPerCm/dist), mean/median/p95/max, verdict ≤2.5 GO / ≤4 GO-with-big-fovea / else PIVOT) and `gaze/validate.ts` (20 clock-seeded dots, 1.5 s, drop 500 ms, median per dot, needs ≥15 dots). Key `T` after calibrating; URL `?dist=<cm>&screencm=<physical width of the view, cm>` (defaults 60 / 31; browsers can't know physical size, so set screencm). Result in `window.glanceValidation`.
- **Filter ✅:** `gaze/filter.ts` `GazeFilter` (One-Euro on x,y with shared speed-based cutoff + saccade snap: jump >250 px at >1200 px/s confirmed by a 2nd nearby sample, an unconfirmed outlier is held). Applied in `EyeTracker` after the mapper, reset on face loss. Parameters are untuned guesses (`DEFAULT_FILTER`); retune on real data.
- **Camera view (11 Nov):** `ui/camview.ts` = picture-in-picture of the webcam with the 478 face landmarks, eye corners and iris circles drawn; key `V` toggles, opens automatically with `M`. `EyeTracker.landmarks` holds the raw points.
- **Startup order:** `#view` is appended only after key/mouse handlers exist (a real clip loads slower than the synthetic source, early key presses were lost). Fake-webcam smoke uses `call-plants` (close-up face; `call-desk`'s face is too small to detect at 640×360).
- **Vertical accuracy (12 Nov):** Aarav saw the ring sit below his real gaze. Added eyelid opening (`lid`, 5th regression feature), blink hold (`lid < 0.12` keeps the last point), and key `X` = recenter (look at the video centre, press X; `C` clears it). Not yet confirmed by him.
- **Stability (12 Nov):** real-webcam gaze was jumpy and misplaced. Regression is now linear (1 + 5 features) instead of full quadratic, features that barely vary in calibration are not scaled up (`SD_FLOOR` 0.03), One-Euro `minCutoff` 0.8 → 0.35, ring radius 40 px and kept on the video. Awaiting Aarav's check.

## P2 — visible effect
- **Video source ✅ (12 Nov):** `video/source.ts` `SourceManager` draws the current source letterboxed into `frame` (1280×720). Options: clips from `/clips/clips.json`, then `webcam`, and synthetic only with `?synthetic` or when no clips are served. Keys 1–9 and `#picker` select; pure helpers are in `video/layout.ts`. `app.ts` draws `src.frame`, not `src.canvas`.
- **Foveation ✅ (12 Nov):** `video/fovea.ts` (pure: radius = hypot(5° in px, 2·sigma), Gaussian quality falloff, LOD 0..3.5) and `video/foveate.ts` (`Foveator`: WebGL2, texture mips + 5 taps, `render(src,gx,gy,r)`, `frame(tsUs)` → VideoFrame, `reveal` flag for the later overlay). Key `F` previews it on the main view; hook `window.glanceFoveate`. 5° = 217 px with the default 31 cm screen at 60 cm (set `?screencm=` for the real laptop; 15.6" ≈ 237 px). Per-region QP is impossible in WebCodecs, so only the pre-filter reduces bits.
- **Encoders ✅ (12 Nov):** `video/encoders.ts` (`DualEncoder`: two VP9 `vp09.00.31.08` realtime quantizer-mode encoders, same QP 32, keyframe every 2 s, frame pairs dropped together if either queue ≥4) + `metrics/stats.ts` (`ByteStats` per-second kbps, `percentSaved`). Key `E` runs them on live frames, status shows kbps + % saved; hook `window.glanceEnc`. Smoke: ~50% fewer bytes for Glance on call-desk (headless only reaches ~2 fps, so keyframe-heavy; real numbers need a real run).
- **Reveal ✅ (12 Nov):** key `R` (off by default) tints the quality map (red sharp, blue coarse) via `revealRGBA` in `video/fovea.ts`, drawn only on the viewer canvas (Glance panel in split mode), never on frames sent to the encoders. The old shader `reveal` uniform was removed for that reason.
- **Split screen ✅ (12 Nov):** key `S` (`ui/split.ts` layout, `video/decoder.ts` `StreamDecoder`): both VP9 streams are decoded and drawn side by side (left normal, right Glance) with per-panel kbps and "% bandwidth saved"; starts the encoders if needed and stops them again if it started them. Hook `window.glanceSplit`. The decoder resyncs at the next keyframe after an error or backlog; pressing S with encoders already on waits up to 2 s for a keyframe.
- The webcam source shares the tracker's `<video>`; it opens its own camera only if the tracker is down, and a failure is latched until the next select.
