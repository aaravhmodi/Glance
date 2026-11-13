"""T8: loss/jitter transport experiment and tracker-error experiment (plan.md). Real clips, SYNTHETIC seeded gaze (flagged in every row).
Reuses the encoder, foveation and metrics of pipeline.py / experiments.py unchanged; baseline and Glance differ only in the input frames."""
import os
import shutil

import experiments
import fovea
import pipeline
import transport

LOSS = 0.02
JITTER_BUFFER_MS = 100
NET_SEEDS = (1, 2, 3, 4, 5, 6)
TRACKER_ERRORS_DEG = (0.0, 2.0, 4.0, 6.0)
TRACKER_LAG_S = 0.1


def packet_info(path):
    """[(source_frame_index, bytes, is_key)] per video packet; index from the pts at 30 fps (frames the encoder dropped leave gaps)."""
    p = pipeline.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time,size,flags",
                      "-of", "csv=p=0", path])
    out = []
    for line in p.stdout.split():
        pts, size, flags = line.split(",")
        out.append((int(round(float(pts) * pipeline.FPS)), int(size), "K" in flags))
    out.sort()
    return out


def decode_raw(path, w, h, n, out_raw):
    """Decode to raw yuv420p, one frame per 1/30 s (a dropped frame repeats the previous one), exactly n frames. Returns bytes per frame."""
    fps = pipeline.FPS
    pipeline.ffmpeg("-i", path, "-vf", f"fps={fps},trim=end_frame={n},setpts=N/{fps}/TB,format=yuv420p", "-frames:v", str(n),
                    "-f", "rawvideo", out_raw)
    fs = w * h * 3 // 2
    if os.path.getsize(out_raw) != fs * n:
        raise RuntimeError("decoded %d bytes, expected %d" % (os.path.getsize(out_raw), fs * n))
    return fs


def shown_stream(raw, frame_bytes, shown, w, h, out):
    """The video the viewer sees: frame k = decoded frame shown[k], or mid-grey when None. Lossless mkv."""
    grey = bytes([128]) * frame_bytes
    tmp = out + ".raw"
    with open(raw, "rb") as src, open(tmp, "wb") as dst:
        for s in shown:
            if s is None:
                dst.write(grey)
            else:
                src.seek(s * frame_bytes)
                dst.write(src.read(frame_bytes))
    try:
        pipeline.ffmpeg("-f", "rawvideo", "-pix_fmt", "yuv420p", "-s", f"{w}x{h}", "-framerate", str(pipeline.FPS), "-i", tmp,
                        "-c:v", "ffv1", out)
    finally:
        os.remove(tmp)
    return out


def _agg(vals):
    return {"mean": sum(vals) / len(vals), "worst": min(vals)}


def transport_experiment(clip, res, cap, n=150, seed=1, deg=fovea.FOVEA_DEG, loss=LOSS, buffer_ms=JITTER_BUFFER_MS,
                         net_seeds=NET_SEEDS, tmp="results/tmp/t"):
    """Same CBR cap for both streams, then the SAME seeded loss/jitter draws applied to both (transport.py). Quality is what the
    viewer sees (frozen frames included) against the untouched source, in the nominal fovea disc around the true gaze.
    n = 150 frames so keyframes at 0, 60 and 120 exist. A lossless control ("clean") uses the identical code path."""
    shutil.rmtree(tmp, ignore_errors=True)
    w, h, trace, ref, gin, true_gaze = experiments._setup(clip, res, n, seed, tmp, deg)
    r_meas = fovea.deg_to_px(deg, w)
    row = {"experiment": "T", "clip": os.path.basename(clip), "res": res, "frames": n, "cap_kbps": cap, "fovea_deg": deg,
           "gaze_seed": seed, "synthetic_gaze": True, "loss": loss, "jitter_buffer_ms": buffer_ms, "net_seeds": list(net_seeds),
           "model": "transport.py: 1200 B packets, no retransmission, freeze until next keyframe, grey before first keyframe"}
    try:
        for name, src in (("baseline", ref), ("glance", gin)):
            enc = pipeline.encode(src, cap, os.path.join(tmp, name + ".webm"))
            stats = pipeline.stream_stats(enc, n)
            frames = packet_info(enc)
            raw = os.path.join(tmp, name + ".yuv")
            fb = decode_raw(enc, w, h, n, raw)
            per = {}
            for label, (lo, bu, sds) in {"clean": (0.0, 0, (0,)), "lossy": (loss, buffer_ms, net_seeds)}.items():
                runs = []
                for sd in sds:
                    shown, ts = transport.simulate(frames, n, lo, bu, sd)
                    st = shown_stream(raw, fb, shown, w, h, os.path.join(tmp, f"{name}_{label}_{sd}.mkv"))
                    m = pipeline.measure(ref, st, w, h, n, true_gaze, r_meas, tmp)
                    os.remove(st)
                    runs.append({"net_seed": sd, **ts, "foveal_psnr": m["foveal_psnr"]["mean"],
                                 "foveal_ssim": m["foveal_ssim"]["mean"], "full_psnr": m["full_psnr"]["mean"]})
                per[label] = {"runs": runs,
                              "foveal_psnr": _agg([r["foveal_psnr"] for r in runs]),
                              "foveal_ssim": _agg([r["foveal_ssim"] for r in runs]),
                              "frozen_fraction": {"mean": sum(r["frozen_fraction"] for r in runs) / len(runs),
                                                  "worst": max(r["frozen_fraction"] for r in runs)},
                              "packets": runs[0]["packets"]}
            row[name] = {"kbps": stats["kbps"], "frames_dropped_by_encoder": stats["frames_dropped"], **per}
            os.remove(raw)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    for label in ("clean", "lossy"):
        row["foveal_psnr_gain_db_" + label] = (row["glance"][label]["foveal_psnr"]["mean"]
                                               - row["baseline"][label]["foveal_psnr"]["mean"])
    return row


def tracker_error_experiment(clip, res, cap, n=90, seed=1, deg=fovea.FOVEA_DEG, errors=TRACKER_ERRORS_DEG, lag_s=TRACKER_LAG_S,
                             noise_seed=7, tmp="results/tmp/e"):
    """Fovea centred on (true gaze `lag_s` ago) + tracker noise (mean radial error `err` deg); quality scored at the TRUE gaze.
    Two Glance variants per error: fixed radius, and sigma-adaptive (the app's rule; sigma = the error in px). Baseline at the
    same cap, encoded once. The err = 0 row still has the lag."""
    shutil.rmtree(tmp, ignore_errors=True)
    w, h, trace, ref, _, true_gaze = experiments._setup(clip, res, n, seed, tmp, deg)
    r_meas = fovea.deg_to_px(deg, w)
    rows = []
    try:
        enc = pipeline.encode(ref, cap, os.path.join(tmp, "b.webm"))
        base = pipeline.stream_stats(enc, n)
        base.update(pipeline.measure(ref, enc, w, h, n, true_gaze, r_meas, tmp))
        for err in errors:
            e_px = fovea.deg_to_px(err, w)
            noise = transport.tracker_noise(noise_seed, n, e_px)
            centres = []
            for k in range(n):
                x, y, _s = pipeline.gaze_px(trace, k, w, h, extra_lag_s=lag_s)
                centres.append((x + noise[k][0], y + noise[k][1]))
            realised = sum(((c[0] - g[0]) ** 2 + (c[1] - g[1]) ** 2) ** 0.5 for c, g in zip(centres, true_gaze)) / n
            for mode in ("fixed", "adaptive"):
                if mode == "adaptive" and err == 0:
                    continue
                sig = e_px if mode == "adaptive" else 0.0
                tr = dict(trace, samples=[dict(s, sigma=sig) for s in trace["samples"]])
                gin = pipeline.glance_frames(ref, w, h, n, tr, os.path.join(tmp, "g_in.mkv"), deg=deg, centres=centres)
                enc = pipeline.encode(gin, cap, os.path.join(tmp, "g.webm"))
                g = pipeline.stream_stats(enc, n)
                g.update(pipeline.measure(ref, enc, w, h, n, true_gaze, r_meas, tmp))
                rows.append({"experiment": "E", "clip": os.path.basename(clip), "res": res, "frames": n, "cap_kbps": cap,
                             "fovea_deg": deg, "tracker_error_deg": err,
                             "realised_mean_error_deg": fovea.px_to_deg(realised, w), "lag_ms": lag_s * 1000,
                             "radius_mode": mode, "gaze_seed": seed, "noise_seed": noise_seed, "synthetic_gaze": True,
                             "baseline": base, "glance": g,
                             "foveal_psnr_gain_db": g["foveal_psnr"]["mean"] - base["foveal_psnr"]["mean"],
                             "foveal_ssim_gain": g["foveal_ssim"]["mean"] - base["foveal_ssim"]["mean"],
                             "full_psnr_gain_db": g["full_psnr"]["mean"] - base["full_psnr"]["mean"],
                             "kbps_ratio": g["kbps"] / base["kbps"]})
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return rows
