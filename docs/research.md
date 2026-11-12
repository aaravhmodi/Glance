# Glance — research notes (13 Nov 2026)

Gathered by three researcher subagents on 12–13 Nov; pages fetched then. **P** = primary source opened,
**S** = secondary, **UNCONFIRMED** = not verified, do not quote as fact. No page tried to inject instructions.
"Verified locally" = checked by the lead on the laptop (ffmpeg 8.1.2).

## 1. Video-call bitrates (all P)

| Service | Resolution | kbps up/down | Source |
|---|---|---|---|
| Zoom 1:1 | "high quality" / 720p / 1080p | 600/600, 1200/1200, 3800/3000 | [Zoom] |
| Zoom group | "high quality" / 720p / 1080p | 1000/600, 2600/1800, 3800/3000 | [Zoom] |
| Google Meet | 720p / 1080p | up to 1700, up to 3600 | [Meet] |
| Teams 1:1 | min (≤240p) / recommended / best (≤1080p30) | 150, 1500, 4000 | [Teams] |
| libwebrtc single stream, default max | ≤320×240 / ≤640×480 / ≤960×540 / larger | 600 / 1700 / 2000 / 2500 | [wve] |
| libwebrtc simulcast max/target/min | 1080p, 720p, 540p, 360p | 5000/4000/800, 2500/2500/600, 1200/1200/350, 700/500/150 | [sim] |

- libwebrtc start bitrate 300 kbps (`api/transport/bitrate_settings.h`). Zoom does not say "high quality" = 360p (UNCONFIRMED).
- libwebrtc values were read from the GitHub mirror `webrtc-sdk/webrtc`, which may lag upstream.
- **Used for:** the "unconstrained" profile = libwebrtc simulcast target for that resolution: 360p 500, 720p 2500, 1080p 4000 kbps.
  The 300/500/1000/2500 kbps profiles sit inside the range real services use.

[Zoom]: https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060748
[Meet]: https://knowledge.workspace.google.com/admin/meet/prepare-your-network-for-meet-meetings-and-live-streams
[Teams]: https://learn.microsoft.com/en-us/microsoftteams/prepare-network
[wve]: https://raw.githubusercontent.com/webrtc-sdk/webrtc/main/media/engine/webrtc_video_engine.cc
[sim]: https://raw.githubusercontent.com/webrtc-sdk/webrtc/main/media/engine/simulcast.cc

## 2. Fair baseline encoder

libwebrtc VP9 (`modules/video_coding/codecs/vp9/libvpx_vp9_encoder.cc`, P): realtime deadline, CBR, one pass, lag 0,
error-resilient 0, quantizer 2–52, under/overshoot 50 %, buffers 500/600/1000 ms, drop threshold 30, AQ mode 3, row-mt,
speed 7 at ≥352×288 (5 below), keyframes only on request (`kf_max_dist=3000`).
Chrome WebCodecs (`media/video/vpx_video_encoder.cc`, P): `constant` → CBR, lag 0, VP9 cpu-used 7, realtime deadline.

ffmpeg equivalent, **verified locally** (all option names exist; on `call-desk` 720p it produced 505 kbps for a
500 target with 446 frames and 996 kbps for 1000 with 452 frames, so it drops a few frames at 500):

```
ffmpeg -i IN -an -r 30 -c:v libvpx-vp9 -deadline realtime -cpu-used 7 -b:v Bk -minrate Bk -maxrate Bk \
  -bufsize Bk -rc_init_occupancy (B/2)k -qmin 2 -qmax 52 -undershoot-pct 50 -overshoot-pct 50 \
  -lag-in-frames 0 -error-resilient 0 -row-mt 1 -tile-columns 1 -threads 4 -aq-mode 3 \
  -static-thresh 1 -drop-threshold 30 -g 60 -keyint_min 60 OUT.webm
```

- `-g 60` (keyframe every 2 s) is our choice so the loss model can recover without a feedback channel; libwebrtc
  itself sends keyframes only on request. Same value for both streams. Say this in results.md.
- ffmpeg forces `buf-optimal-sz` to 5/6 of `bufsize`, so libwebrtc's 600 ms cannot be matched exactly.
- Frame drops are real behaviour (drop threshold 30): count frames in both streams and report them.
- Not run, UNCONFIRMED: H.264 `-c:v libx264 -profile:v baseline -level 3.1 -preset veryfast -tune zerolatency
  -b:v Bk -maxrate Bk -bufsize Bk -g 60 -sc_threshold 0` (libwebrtc uses OpenH264, so this is an analogue);
  AV1 `-c:v libsvtav1 -preset 10 -b:v Bk -g 60 -svtav1-params "rc=2:pred-struct=1:rtc=1:lookahead=0"`
  ([SVT-AV1 parameters](https://gitlab.com/AOMediaCodec/SVT-AV1/-/raw/master/Docs/Parameters.md)).

## 3. Network emulation without root

- `RTCRtpSender.setParameters` `encodings[].maxBitrate`: bits per second, a ceiling not a target
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpSender/setParameters), P). Not used: the app has no RTC connection.
- WebCodecs `bitrate` is an average; "the precise degree of bitrate fluctuation in either mode is implementation
  defined"; `realtime` MAY drop frames ([spec](https://www.w3.org/TR/webcodecs/), P). So measure achieved kbps, never report the target.
- Loss in real WebRTC: NACK + RTX repair ([RFC 4585](https://www.rfc-editor.org/rfc/rfc4585.txt),
  [RFC 4588](https://www.rfc-editor.org/rfc/rfc4588.txt), P); if not repaired the receiver sends PLI and the video
  freezes until a keyframe (libwebrtc `video/rtp_video_stream_receiver2.cc`, `video_receive_stream2.cc`, P). `kVideoMtu = 1200`.
- **Used for:** the transport model in `plan.md` (1200-byte packets, freeze until next keyframe). It has no
  retransmission, so it is pessimistic for both streams equally. Jitter-buffer defaults are UNCONFIRMED; the model's
  buffer size is our own parameter and must be stated.

## 4. Prior work: reported savings and how quality was measured

| Work | Saving | Quality measure |
|---|---|---|
| Ryoo et al., MMSys 2016 ([pdf](https://www3.cs.stonybrook.edu/~cvl/content/papers/2016/foveated_player_mmsys2016.pdf), P) | 2× bandwidth "for the same user satisfaction" | subjective, 16 people; webcam gaze, 8°-wide sharp region; webcam error 90th pct 6.3–8° |
| Illahi et al., MMSP 2017 ([arXiv](https://arxiv.org/abs/1706.04804), P) | "even more than 50%" | authors' impression only |
| Illahi et al., TOMM 2020 ([arXiv](https://arxiv.org/abs/1809.05823), P) | "several tens of percent" (exact % only in figures) | 12-person MOS + PSNR + EWPSNR |
| Hsiao et al., SIGCOMM CCR 2022 ([arXiv](https://arxiv.org/abs/2108.12720), P) | ~80 % (5×) vs a 28 Mbit/s 4K baseline, 14 ms eye tracker | subjective matching, 11 people |
| EyeNexus 2025 ([arXiv](https://arxiv.org/abs/2509.11807), P) | no bitrate figure; quality up to +24.6 % | EWPSNR, EWSSIM, 14-person study |
| Meddeb et al. 2014, face-ROI HEVC ([paper](https://www.cambridge.org/core/product/A969A31DDA4FE604B92C0449A4213392/core-reader), P) | none; ROI PSNR +0.5–0.7 dB, up to 2 dB at 128–256 kbps | ROI PSNR |

- **Plausibility bound:** at call bitrates with a webcam-sized fovea expect tens of percent, about 2× at best.
  Numbers near 80 % come from 4K, lab eye trackers and high baselines; a result like that here needs a Skeptic pass before it is written down.
- Webcam gaze error: WebGazer 4.17° ([paper](https://jeffhuang.com/papers/WebGazer_IJCAI16.pdf), P); Ryoo 6.3–8° at the 90th percentile.
  **So the tracker-error run should cover 2°, 4° and 6°, and the 8° fovea is the realistic setting, not 3°.**
- Latency: 50–70 ms total tolerated, 80–150 ms hurts ([Albert et al. 2017](https://research.nvidia.com/publication/2017-09_latency-requirements-foveated-rendering-virtual-reality), P, abstract).
- Acuity model (Geisler & Perry 1998, e2 = 2.3°, α = 0.106, CT0 = 1/64): constants confirmed via
  [Wang et al. 2001](https://ece.uwaterloo.ca/~z70wang/publications/spie01.pdf) (S); the formula itself and "fovea 2°, parafovea 5°" are UNCONFIRMED.

## 5. Metrics

- **Foveal PSNR / SSIM** (disc around the true gaze) — comparable with EWPSNR used by Illahi and EyeNexus.
  The exact EWPSNR formula (Li et al. 2011) was not confirmed, so call ours "PSNR in the foveal disc", not EWPSNR.
- **VMAF** ([FAQ](https://github.com/Netflix/vmaf/blob/master/resource/doc/faq.md), [ffmpeg doc](https://github.com/Netflix/vmaf/blob/master/resource/doc/ffmpeg.md), P):
  `vmaf_v0.6.1` assumes 1080p at 3 picture heights; no gaze input; small crops are outside its training conditions.
  Report foveal-crop VMAF as indicative only, plus whole-frame VMAF (where Glance must lose, by design).
  Syntax (distorted first, reference second), option list verified locally:
  `ffmpeg -i dist -i ref -lavfi "[0:v]setpts=PTS-STARTPTS[d];[1:v]setpts=PTS-STARTPTS[r];[d][r]libvmaf=model=version=vmaf_v0.6.1:log_fmt=json:log_path=vmaf.json:n_threads=4:shortest=1" -f null -`
  Same resolution, pix_fmt and frame rate on both inputs; relative `log_path` on Windows.
- **FovVideoVDP** ([repo](https://github.com/gfxdisp/FovVideoVDP), P; use ≥ 1.2.1): the CLI has no gaze argument
  (`--foveated` fixes gaze at the centre). Per-frame gaze needs Python:
  ```python
  fv = pyfvvdp.fvvdp(display_geometry=pyfvvdp.fvvdp_display_geometry(resolution=(W, H), distance_m=0.6, diagonal_size_inches=D),
                     display_photometry=pyfvvdp.fvvdp_display_photo_eotf(200, contrast=1000, EOTF='sRGB'), foveated=True, heatmap=None)
  jod, stats = fv.predict(test, ref, dim_order="HWCF", frames_per_second=30, fixation_point=gaze)  # gaze: (N, 2) pixels, (x, y), top-left origin
  ```
  JOD 10 = no visible difference; 1 JOD ≈ 75 % preference. **Licence CC BY-NC 4.0** (non-commercial): fine for a
  hackathon evaluation, not for a shipped product. Not checked by the lead against the installed package: confirm the
  signature with `help(pyfvvdp.fvvdp.predict)` before relying on it.
- **What a skeptic will say (put in limitations):** foveal PSNR ignores peripheral flicker; scoring with the same
  trace that drove the encoder hides tracker error and lag; webcam error (4–8°) exceeds a 3–5° fovea; every prior
  headline claim rests on a user study and we have none; savings depend on content and baseline rate.

## 6. Browser APIs (for T2–T5, T10)

- `VideoEncoderConfig`: `bitrateMode: 'constant' | 'variable' | 'quantizer'`, `latencyMode: 'realtime'`;
  per frame `encode(frame, { keyFrame, vp9: { quantizer } })` ([spec](https://w3c.github.io/webcodecs/), P).
- **Quantizer range conflict:** the spec registration says VP9 0–255, MDN says 0–63, Chromium main converts a
  0–255 q-index. Stable Chrome's behaviour is UNCONFIRMED: calibrate at runtime (compare chunk sizes at two values)
  or use `constant` bitrate mode and compare kbps directly.
- Reconfigure: `configure()` again is legal; Chromium flushes then changes options
  ([video_encoder.cc](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/modules/webcodecs/video_encoder.cc), P).
  Send `keyFrame: true` on the first frame afterwards.
- Backpressure: skip the frame for BOTH encoders when either `encodeQueueSize > 2`
  ([Chrome article](https://developer.chrome.com/docs/web-platform/best-practices/webcodecs), P).
- `new VideoFrame(canvas, { timestamp })`: microseconds, required for canvas sources; `close()` after `encode()`.
  Create it in the same task as the WebGL draw (then `preserveDrawingBuffer` should not be needed: inference, UNCONFIRMED).
  Use a monotonic counter for timestamps; `mediaTime` wraps on a looping clip.
- VP9 decode needs no `description`: `decoder.configure({ codec: 'vp09.00.10.08', optimizeForLatency: true })`; `ctx.drawImage(frame, 0, 0)`.
- WebCodecs needs a secure context; `http://localhost` counts ([MDN](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts), P).
- WebGL2 ([spec](https://registry.khronos.org/webgl/specs/latest/2.0/), P): `texImage2D` from a video; `generateMipmap`
  works on non-power-of-two textures; `textureLod` with `LINEAR_MIPMAP_LINEAR` gives a cheap variable blur
  (box-filtered mips look blocky at high lod: take 4–5 taps around the sample). Set `UNPACK_FLIP_Y_WEBGL`.
  Send BOTH streams through the same canvas → VideoFrame route so any colour shift is identical.

## 7. Test clips (URLs returned HTTP 200 on 12 Nov; raw y4m, transcode before use)

| Content | URL | Format | Size | Licence |
|---|---|---|---|---|
| Busy scene | https://media.xiph.org/video/derf/y4m/riverbed_1080p25.y4m | 1080p25, 250 frames | 778 MB | derf: "believed to be freely redistributable" |
| Busy scene (alt) | https://media.xiph.org/video/derf/y4m/pedestrian_area_1080p25.y4m | 1080p25, 375 frames | 1.17 GB | same |
| Screen/text | https://media.xiph.org/video/aomctc/candidates/SCC/Netflix-SCCsequences/Spreadsheet_1920x1080_30fps_8bit_420.y4m | 1080p30, 300 frames | 933 MB | CC BY 4.0 (Netflix) |
| Screen (alt) | https://media.xiph.org/video/aomctc/candidates/SCC/FB-SCCSequences/SceneComposition_1.y4m | 1080p15, ~130 frames | 404 MB | CC BY-SA 4.0 (Yu-Chen Sun) |
| Game/motion | https://media.xiph.org/video/derf/twitch/y4m/CSGO.y4m (also GTAV, MINECRAFT, …) | 1080p60, 11.2 GB each | first 10 s ≈ 1.87 GB | public domain per [copyright.txt](https://media.xiph.org/video/derf/twitch/copyright.txt); game content under fair use |

- Twitch files accept range requests: `curl -fsSL https://media.xiph.org/video/derf/twitch/y4m/CSGO.y4m -r 0-1866243700 -o FILE`,
  then let ffmpeg drop the partial last frame.
- Keep raw files in `offline/experiments/media/` (git-ignored). Commit only short transcodes (< 10 MB) with credits.
- 25 fps and 60 fps sources: convert to 30 fps for the matrix and say so; do not upscale 720p talking heads to 1080p.
