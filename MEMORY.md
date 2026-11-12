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
- **Clips:** 3 real clips from Tears of Steel (CC BY 3.0) in `web/public/clips/` (`talking-heads`, `canal-street`, `bridge`; 1280×720 letterboxed H.264, ~25 MB), manifest `clips.json`, credits `CREDITS.md`.
- **Autopilot:** allowlist now adds WebSearch/WebFetch/subagents; queue rewritten P1→P3 (16 tasks), MAX_RUNS 20.

## P1 — real eye tracking
- **Gaze plumbing ✅:** `web/src/gaze/{types,mouse,switch}.ts`. `GazeSwitch.read(now)` returns `{source, fallback, sample}`; key `M` toggles mouse/eyes; in eyes mode it holds the last good sample 500 ms, then falls back to the mouse (status line shows `gaze[mouse (fallback: no face)]`). The tracker just implements `GazeSource` (`name:'eyes'`, `read()`) and calls `gazeSwitch.setEyes(...)`.
- **Tracker ✅:** `gaze/features.ts` (pure: iris offsets in eye widths per eye, head pose from the matrix, scale; `featureVector()` = mean iris u,v + yaw, pitch) and `gaze/tracker.ts` (`EyeTracker`: getUserMedia → FaceLandmarker GPU→CPU fallback; `latest` features, `mapper` set by calibration makes `read()` return a sample). Started lazily on first `M` in `app.ts`; exposed as `window.glanceTracker`.
- **Smoke:** cuts a y4m from talking-heads with ffmpeg and runs Chrome with `--use-file-for-fake-video-capture`; a real face is detected (~11 faces in a few s).
- **Calibration ✅:** `gaze/regression.ts` (pure: z-scored 4 features → 15-term poly, ridge with unpenalised intercept, λ by leave-one-dot-out CV, σ = that CV RMS, Cholesky) and `gaze/calib.ts` (9 dots corners-first, drop 300 ms + sample 1 s, per-dot median, ≥7 dots needed, 30 s cap; installs `tracker.mapper`, clamps to the 1280×720 view). Key C calibrates (starts tracker, switches to eyes), Esc cancels, M ignored meanwhile. `?slowcam` URL flag = test-only hook (min 1 sample/dot, 120 s cap) for the slow headless tracker.
- **Tests:** `npm test` = `node --test tests/*.test.ts` (Node 24 strips types; import with `.ts` extensions); `npm run smoke` now runs build + tests + Chrome.
