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
- **Smoke test:** `cd web && npm run smoke` = build + headless real Chrome (Playwright, fake webcam) on `?smoke`; fails on any `FAIL` line. Extend it per feature.
