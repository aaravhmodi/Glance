# Glance — Build Plan (staged)

Companion to `PRD.md`. Solo build, Mon 9 → Sun 15 Nov 2026.
**Rule:** each stage ends with something demo-able. Commit at the end of every stage.

---

## 0. Timeline at a glance

| Stage | When | Output | Gate |
|------|------|--------|------|
| 0 Setup | Mon night / Tue | Repo, tooling, demo clips, offline deps | — |
| 1 Gaze + accuracy test | **Wed morning** | Gaze dot on screen + 20-dot error report | **GO if ≤ 2.5°, else pivot** |
| 2 Foveated dual-encode | Wed afternoon/evening | Mouse-gaze → blur → 2 encoders → live byte graph | Bytes saved > 0 on all clips |
| 3 Metrics + modes + views | **Thu (flight, offline)** | PSNR/SSIM in fovea, Save + Bad-network modes, "what was sent" screen | Numbers reproducible |
| 4 Differentiator | Fri (before 18:00 opening) | Uncertainty-aware fovea + saliency fusion | Visible accuracy/size improvement |
| 5 Validate + polish | Sat 09:00–16:00 | FovVideoVDP run, backup video, slides, submission | **Stop at 16:00** |
| 6 Demo | Sun | Peer review + judging | — |

---

## 1. Architecture

```
┌──────────────── browser (one Chrome tab, two windows) ────────────────┐
│                                                                        │
│  Webcam ─▶ gaze/   ─▶ calib.ts ─▶ filter.ts ─▶ fusion.ts ─▶ GazeState  │
│            tracker.ts  (ridge)    (One-Euro,   (saliency)   {x,y,σ,t}  │
│                                    saccade)                     │       │
│                                                                 ▼       │
│  <video> clip / ─▶ VideoFrame ─▶ foveate.ts (WebGL2) ─▶ enc A (fov) ─┐ │
│  synthetic call                └──────────────────────▶ enc B (base)─┤ │
│                                                                      ▼ │
│                       stats.ts (bytes, kbps) ◀── EncodedVideoChunk ──┤ │
│                       metrics.ts (PSNR/SSIM in gaze circle) ◀─ decode┘ │
│                       ui/ viewer · "what was sent" · dashboard          │
└────────────────────────────────────────────────────────────────────────┘
   offline (Python): saliency maps (UNISAL), FovVideoVDP validation, plots
```

**Stack**
- Vite + TypeScript, plain WebGL2 (no framework), uPlot for live graphs.
- `@mediapipe/tasks-vision`: Face Landmarker (478 landmarks incl. iris) + Face Detector.
- `onnxruntime-web` (only for optional R14 model).
- WebCodecs `VideoEncoder` / `VideoDecoder`. Chrome only.
- Python side: `pyfvvdp`, `torch`, UNISAL repo, `ffmpeg`.

**Repo layout**
```
glance/
  web/src/gaze/      tracker.ts calib.ts filter.ts fusion.ts validate.ts
  web/src/video/     source.ts foveate.ts shaders/ encoders.ts decoders.ts
  web/src/metrics/   psnr.ts ssim.ts stats.ts
  web/src/ui/        viewer.ts sent.ts dashboard.ts
  offline/           saliency_unisal.py fvvdp_eval.py plots.py
  assets/clips/      3–4 detail-heavy 720p clips (+ precomputed saliency)
  docs/              PRD.md BUILD_PLAN.md results.md
```

---

## 2. Stages in detail

### Stage 0 — Setup (Mon night / Tue, ~1–2 h)
- [x] `npm create vite@latest web -- --template vanilla-ts`, git init, first commit.
- [x] Install `@mediapipe/tasks-vision`, `uplot`. **Download the `.task` model files and WASM locally** so everything runs offline on the plane.
- [ ] Pick 3–4 clips: a talking head (video-call proxy), a busy city/nature scene, a game capture. Trim to 720p, 20–30 s, CC-licensed (e.g. Pexels).
- [x] Python venv with `pyfvvdp`. Clone UNISAL and run it once on one clip to confirm it works.
- [x] Verify `VideoEncoder.isConfigSupported({codec:'vp09.00.10.08', bitrateMode:'quantizer', ...})` in your Chrome. Also try AV1 `av01.0.04M.08` and AVC `avc1.42001E` (→ use `avc1.42001F`, see results.md).

### Stage 1 — Gaze + go/no-go accuracy test (Wed morning, ~3–4 h)

**Build**
1. `tracker.ts`
   - Face Landmarker in VIDEO mode at 30 fps.
   - Features per frame: iris centres relative to the eye corners (normalized by eye width) for both eyes, plus head pose (from the facial transformation matrix) and face scale.
2. `calib.ts`
   - 9-point grid. At each dot, collect ~1 s of samples (drop the first 300 ms).
   - Fit a ridge regression (2nd-order polynomial features) from features to screen (x, y).
   - Store the residual σ.
3. `filter.ts`
   - One-Euro filter (minCutoff ≈ 1.0, β ≈ 0.007, tune).
   - Saccade detector: velocity > ~100°/s for 2 frames → bypass the filter and snap.
4. `validate.ts`
   - 20 random dots, 1.5 s each.
   - Log mean/median/95th-percentile error **in degrees**: `deg = atan(err_px / px_per_cm / distance_cm)`.
   - Distance comes from face width (≈ 14 cm average) or a slider.

**Gate (write results in `docs/results.md`)**

| Mean error | Decision |
|-----------|----------|
| ≤ 2.5° | **GO.** Continue to Stage 2 |
| 2.5–4° | GO with big fovea (r ≈ 9–10°). Prioritize Stage 4 fusion |
| > 4° or bad drift | Try the WebGazer drop-in (30 min). Still bad → **pivot to the telemetry project** |

Also test: lights on/off, glasses on/off, 45 cm vs 70 cm.

### Stage 2 — Foveation + dual encode (Wed afternoon/evening, ~4–5 h)
Drive gaze with the **mouse first** (R9), then swap in real gaze.

1. `foveate.ts` (WebGL2)
   - Input: the video texture.
   - Precompute a mip chain or 2–3 blur levels.
   - Per pixel: eccentricity `e` (degrees from the gaze point), then blend between levels: sharp for `e < r`, then a smooth ramp.
   - A clean option is the Gaussian quality profile used in EyeNexus.
   - Output to a canvas, then `new VideoFrame(canvas, {timestamp})`.
2. `encoders.ts`
   - Two `VideoEncoder`s, identical config (`latencyMode: 'realtime'`).
   - **Save mode:** `bitrateMode: 'quantizer'`, same per-frame QP on both (e.g. VP9 `{vp9: {quantizer: 30}}`).
   - Sum `chunk.byteLength` per second for each.
   - Force a keyframe every 2 s on both so the comparison stays fair.
3. `stats.ts` + dashboard: live kbps for both and % saved (uPlot).

**Done when:** for every clip, the foveated stream uses fewer bytes and the viewer looks right at the cursor.

### Stage 3 — Metrics, modes, views (Thu, on the plane — offline)
1. Decode both streams (`VideoDecoder`).
2. Copy the decoded frames and the source frame to an offscreen canvas.
3. `psnr.ts` / `ssim.ts`: compute **only inside the gaze circle** (plus the full frame for reference), every Nth frame to save CPU.
4. **Bad-network mode:** reconfigure both encoders to `bitrateMode: 'constant'` with the same cap (e.g. 500 kbps). Show foveal PSNR baseline vs Glance.
5. Views:
   - Viewer window (Glance decode only).
   - "What was sent" window: decoded foveated frame plus an overlay of the gaze spot and the radius ring.
   - Dashboard window.
   - Use `window.open` + `BroadcastChannel` so two monitors can show different views.
6. `recorder.ts`: export gaze traces (`{t, x, y, σ}`) + clip id as JSON for offline validation.

### Stage 4 — The differentiator (Fri, ~4 h before the opening)
1. **Uncertainty-aware radius (R10)**
   - `r = r0 + k·σ_total`, where σ_total combines:
     - calibration residual,
     - rolling gaze variance over the last 500 ms,
     - a head-movement penalty.
   - Clamp to 4°–12°. Show σ on the dashboard.
2. **Saliency fusion (R11)**
   - Prior S(x, y):
     - *Call mode:* Gaussian blobs on faces from MediaPipe Face Detector, run on the *video* (not the webcam).
     - *Clip mode:* precomputed UNISAL maps (PNG per frame, downsampled to 64×36).
   - Posterior ∝ N(gaze, σ²) · (ε + S). Take the posterior mean/mode as the fixation, with a smaller σ.
   - Gate it: only pull toward saliency within ~2σ of the raw gaze, so it never "steals" the gaze from where the user really looks.
3. **Show it:** toggle fusion on/off live and watch r shrink while bytes saved goes up. Rerun the Stage 1 validation on a video with faces and compare error with and without fusion.

### Stage 5 — Validate & polish (Sat 09:00–16:00, hard stop)
- 09–11: offline `fvvdp_eval.py`. Use recorded gaze traces and the saved streams, with the display spec set to the venue monitor and viewing distance. Report JOD for the foveated stream vs the reference.
- 11–13: fix bugs, tune defaults, clean UI. Write `docs/results.md` (table: clip × bytes saved × foveal PSNR × JOD).
- 13–14: **feature freeze.**
- 14–16:
  - Record a 2-min backup demo video.
  - 5 slides: problem → demo → how it works → numbers & failure modes → who it's for.
  - Draft the submission text. Push.
- **16:00 leave.**

### Stage 6 — Demo day (Sun)
- Arrive early. Set up the external monitor and a small front light.
- Demo script: calibrate (20 s) → watch → flip to "what was sent" → Bad-network mode → dart eyes, explain the failure mode → numbers slide.

**Cut order if behind:** R13 network path → R14 ML gaze → FovVideoVDP (use PSNR/SSIM only) → UNISAL clip saliency (keep face-prior fusion). **Never cut:** mouse fallback, Bad-network mode, validation numbers.

---

## 3. Research to borrow from (what to take from each)

### Foveated streaming / encoding
| Paper | What to take |
|-------|--------------|
| Ryoo et al., *Design and Evaluation of a Foveated Video Streaming Service for Commodity Client Devices*, ACM MMSys 2016 (Stony Brook) | The closest prior work: commodity webcam gaze, ~2x bandwidth reduction at equal satisfaction. Cite as the baseline you improve on. Their multi-resolution pre-coding idea. |
| Illahi, Siekkinen, Masala, *Foveated Video Streaming for Cloud Gaming*, IEEE MMSP 2017 — arXiv:1706.04804 (**Aalto, Espoo**) | QP-offset-by-distance-from-gaze scheme (x264 CRF + per-macroblock offsets, GamingAnywhere). >50% savings. Use their foveation parameters as starting values. |
| Illahi et al., *Cloud Gaming With Foveated Video Encoding*, ACM TOMM 2020 | User study: a "sweet spot" exists where users barely notice and most savings are kept. Use for choosing r and falloff. |
| Illahi et al., *Foveated Streaming of Real-time Graphics*, MMSys 2021 | Shows foveated *warping* (pre-encode spatial compression), the same family as your pre-filter approach. |
| *EyeNexus: Adaptive Gaze-Driven Quality and Bitrate Streaming for VR Cloud Gaming*, arXiv:2509.11807 (2025) | Gaussian foveation profile and adapting the foveal region to gaze and bandwidth. Directly informs R10. |
| Stanford CS244C project, *Adaptive Foveation* (2026) | Extends EyeNexus with gaze **variance**: low confidence → wider high-quality region. Same idea as your σ-driven radius. |
| *Low-latency foveated video compression* (SIGCOMM CCR 2022, NSF PAR 10346863) + repo `github.com/lukehsiao/fvideo` | Latency budget and user-study insights on latency vs required bitrate. Encoder-in-the-loop design. |
| Wiedemann et al., *Foveated Video Coding for Real-Time Streaming Applications*, QoMEX 2020 + `github.com/owdmn/FFoveated` | Workbench for foveated codecs. Reference QP-map shapes. |
| Apple WWDC26 "Foveated Streaming" + open-source endpoint sample | Industry protocol reference: how gaze is sent upstream and applied. Good for the pitch slide. |

### Gaze estimation
| Source | Use |
|--------|-----|
| MediaPipe Face Landmarker (Google, Apache-2.0) | **Primary tracker.** Iris + 478 landmarks in the browser, fast, offline-capable. |
| WebGazer.js — Papoutsaki et al., IJCAI 2016 (`webgazer.cs.brown.edu`) | Drop-in fallback. Self-calibrates from clicks (steal this idea for R2). ~4.17° avg error is the number to beat. **Check license (GPL) before shipping.** |
| L2CS-Net — Abdelrahman et al., ICIP 2022, `github.com/Ahmednull/L2CS-Net` | Appearance-based CNN, 3.92° on MPIIGaze. A browser ONNX Runtime Web port runs ~15–20 fps on WebGPU (Harvard MMLA tool). Optional R14. |
| MobileGaze — `github.com/yakhyo/gaze-estimation` | Ready **ONNX** weights (MobileOne-S0 4.8 MB, MobileNetV2 9.6 MB). Easiest ML path into onnxruntime-web. Numbers are on the harder Gaze360 set (~12.6° MAE), so test it against MediaPipe on your validation, don't assume. |
| FAZE — Park et al., ICCV 2019, `github.com/NVlabs/few_shot_gaze` | Few-shot personalization: ~3.14° with 9 calibration samples. Take the *idea* (per-user adaptation from 9 points) and justify the 9-dot calibration. **Check NVIDIA license (likely non-commercial).** |

### Saliency (for fusion)
| Source | Use |
|--------|-----|
| UNISAL — Droste, Jiao, Noble, ECCV 2020, `github.com/rdroste/unisal` | Lightweight image+video saliency (5–20x smaller than competitors). Precompute maps offline for demo clips. Apache-2.0 (verified). |
| MediaPipe Face Detector | Cheap real-time "people look at faces" prior for video-call mode. |

### Perceptual validation
| Source | Use |
|--------|-----|
| FovVideoVDP — Mantiuk et al., SIGGRAPH 2021, `github.com/gfxdisp/FovVideoVDP`, `pip install pyfvvdp` | The right metric for foveated video: models peripheral vision, takes display size/resolution and viewing distance, reports JOD (10 = no visible difference). Gives you a defensible "viewers can't tell" claim. Check license. |
| PSNR / SSIM (in-browser, inside gaze circle) | Live dashboard numbers. |

### Webcam gaze accuracy references (for the pitch & risk slide)
- WebGazer: 175–210 px / ~4.17° average error.
- Careful calibration and QC: ~2° typical (WebGazer-based, 50–70 cm, well-lit).
- Best webcam systems: ~1.4° in one validation study. Dedicated IR trackers: 0.5–1°.

---

## 4. Key implementation notes

- **WebCodecs QP is per frame, not per region.** Per-frame QP works for VP9/AV1 (0–63) and AVC (0–51) in `bitrateMode: 'quantizer'`. Foveation must be a **pre-filter** (blur/downsample periphery) before `encode()`. The per-macroblock approach from Illahi et al. needs native x264 (Stage R15 only).
- **Fair comparison:** identical codec, resolution, QP or bitrate cap, keyframe cadence, and the same source frames for A and B.
- **Degrees ↔ pixels:** `px_per_deg ≈ distance_cm · tan(1°) · px_per_cm`. At 55 cm on a 14" 1080p laptop (~62 px/cm) that's ~60 px/°. Use it everywhere (radius, error, metrics).
- **Viewing distance matters:** savings shrink as the screen fills less of the field of view. Demo on a 24"+ monitor at 50–60 cm.
- **Latency:** local demo keeps gaze→encode delay tiny. Measure and display it anyway.
- **Offline flight:** vendor MediaPipe WASM + `.task` files into `web/public/`. Don't rely on CDNs.

## 5. License checklist

| Component | License (verify) | OK to ship in demo? |
|-----------|------------------|---------------------|
| MediaPipe tasks-vision | Apache-2.0 | |
| ONNX Runtime Web | MIT | |
| WebGazer | GPL-3.0 (verify) | |
| L2CS-Net | MIT (per Luxonis listing — verify repo) | |
| MobileGaze (yakhyo) | verify | |
| FAZE (NVlabs) | NVIDIA license (verify) | |
| UNISAL | Apache-2.0 (verified) | yes |
| FovVideoVDP | verify (may be non-commercial) | |

## 6. Pre-flight checklist (Thu morning)
- [ ] `npm run build && npm run preview` works **with Wi-Fi off**
- [ ] Clips + saliency maps in `assets/`
- [ ] Laptop charger, USB-C → HDMI/DP adapter, small clip-on light
- [ ] `docs/results.md` has Stage 1 accuracy numbers
- [ ] Written confirmation from Junction that pre-work is allowed (screenshot)
- [ ] Autopilot started on the home server (see `autopilot/README.md`)
