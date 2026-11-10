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
