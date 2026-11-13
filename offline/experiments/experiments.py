"""Experiments A and B (plan.md). Real clips only; gaze traces are SYNTHETIC (seeded) and every record says so.

A: "same quality, fewer kbps". Baseline = normal VP9 CBR at the service-typical bitrate for that resolution
   (docs/research.md section 1). Bisection on the Glance target bitrate for the LOWEST bitrate whose foveal PSNR
   (mean over frames, inside the nominal fovea disc around the true gaze) is within TOL_DB of the baseline's.
   If even the baseline bitrate does not reach it, the result is reported as "not reached" (a loss), never hidden.
B: "same kbps, better quality". Both streams capped at the same CBR rate; report foveal PSNR/SSIM for each.
"""
import os
import shutil

import fovea
import pipeline
import traces

TOL_DB = 0.5
BISECT_STEPS = 6
MIN_KBPS = 40
UNCONSTRAINED = {360: 500, 720: 2500, 1080: 4000}  # libwebrtc simulcast targets, research.md section 1
SIZES = {360: (640, 360), 720: (1280, 720)}


def _probe(src, ref, w, h, n, kbps, true_gaze, r_meas, tmp, tag):
    enc = pipeline.encode(src, kbps, os.path.join(tmp, tag + ".webm"))
    s = pipeline.stream_stats(enc, n)
    s.update(pipeline.measure(ref, enc, w, h, n, true_gaze, r_meas, tmp))
    s["kbps_target"] = kbps
    os.remove(enc)
    return s


def _setup(clip, res, n, seed, tmp, deg):
    w, h = SIZES[res]
    os.makedirs(tmp, exist_ok=True)
    trace = traces.generate(seed, n / pipeline.FPS, width=w, height=h, clip=os.path.basename(clip))
    ref = pipeline.make_reference(clip, w, h, n, os.path.join(tmp, "ref.mkv"))
    gin = pipeline.glance_frames(ref, w, h, n, trace, os.path.join(tmp, "glance_in.mkv"), deg=deg)
    true_gaze = [pipeline.gaze_px(trace, k, w, h)[:2] for k in range(n)]
    return w, h, trace, ref, gin, true_gaze


def experiment_a(clip, res, n=90, seed=1, deg=fovea.FOVEA_DEG, base_kbps=None, tmp="results/tmp/a"):
    shutil.rmtree(tmp, ignore_errors=True)
    w, h, trace, ref, gin, true_gaze = _setup(clip, res, n, seed, tmp, deg)
    r_meas = fovea.deg_to_px(deg, w)
    base_kbps = base_kbps or UNCONSTRAINED[res]
    try:
        base = _probe(ref, ref, w, h, n, base_kbps, true_gaze, r_meas, tmp, "base")
        goal = base["foveal_psnr"]["mean"] - TOL_DB
        lo, hi = MIN_KBPS, base_kbps
        probes = []
        top = _probe(gin, ref, w, h, n, hi, true_gaze, r_meas, tmp, "g_hi")
        probes.append(top)
        best = None
        if top["foveal_psnr"]["mean"] >= goal:
            best = top
            for i in range(BISECT_STEPS):
                mid = (lo + hi) / 2.0
                p = _probe(gin, ref, w, h, n, mid, true_gaze, r_meas, tmp, f"g{i}")
                probes.append(p)
                if p["foveal_psnr"]["mean"] >= goal:
                    best, hi = p, mid
                else:
                    lo = mid
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    res_row = {"experiment": "A", "clip": os.path.basename(clip), "res": res, "frames": n, "fovea_deg": deg,
               "seed": seed, "synthetic_gaze": True, "baseline_target_kbps": base_kbps, "baseline": base,
               "goal_foveal_psnr": goal, "tol_db": TOL_DB, "probes": probes, "glance": best, "reached": best is not None}
    # percent saved compares ACHIEVED bytes. If a stream used fewer bytes than the cap (easy content), that is real.
    res_row["percent_saved"] = (100.0 * (1 - best["kbps"] / base["kbps"])) if best else None
    return res_row


def experiment_b(clip, res, caps, n=90, seed=1, deg=fovea.FOVEA_DEG, tmp="results/tmp/b"):
    shutil.rmtree(tmp, ignore_errors=True)
    w, h, trace, ref, gin, true_gaze = _setup(clip, res, n, seed, tmp, deg)
    r_meas = fovea.deg_to_px(deg, w)
    rows = []
    try:
        for cap in caps:
            b = _probe(ref, ref, w, h, n, cap, true_gaze, r_meas, tmp, "b")
            g = _probe(gin, ref, w, h, n, cap, true_gaze, r_meas, tmp, "g")
            rows.append({"experiment": "B", "clip": os.path.basename(clip), "res": res, "frames": n, "fovea_deg": deg,
                         "seed": seed, "synthetic_gaze": True, "cap_kbps": cap, "baseline": b, "glance": g,
                         "foveal_psnr_gain_db": g["foveal_psnr"]["mean"] - b["foveal_psnr"]["mean"],
                         "foveal_ssim_gain": g["foveal_ssim"]["mean"] - b["foveal_ssim"]["mean"],
                         "kbps_ratio": g["kbps"] / b["kbps"]})
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return rows
