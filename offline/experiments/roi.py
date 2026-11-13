"""Third method, "per-block quality (ROI)": the picture is NOT modified; libx264 gets a region of interest around the gaze
with a negative quantizer offset (ffmpeg `addroi` side data), so blocks near the gaze get more bits. Stdlib + ffmpeg only.

Moving region: `addroi` has no timeline support, so the input is split into one branch per run of frames that share the
same regions (`select='between(n,a,b)'`), each branch gets its own `addroi` chain, and `interleave` merges them back by
pts into one stream for ONE encoder instance. Measured on this build (ffmpeg 8.1): the quality peak follows the region.
Overlap rule (measured, and in libavutil/frame.h): the FIRST region added wins, so the inner square is added first.
x264 ignores ROI when aq-mode=0 (it warns "Adaptive quantization must be enabled"); both streams keep the default aq-mode=1.
Baseline = the same libx264 command without the filter graph. Gaze traces are SYNTHETIC and every record says so.
"""
import argparse
import json
import math
import os
import shutil
import sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import experiments  # noqa: E402
import fovea  # noqa: E402
import pipeline  # noqa: E402
import traces  # noqa: E402

MB = 16
# inner square (covers the fovea disc), then one ring 1.5x as wide. From the sweep on call-desk only (not tuned per clip):
# (-0.15,-0.075) gains ~2.0 dB foveal at equal bitrate, this ~3.2 dB, (-0.5,-0.25) ~3.6 dB, (-0.5,) ~3.9 dB, but the
# periphery pays 1-3 dB here against 3-6 dB and 5-9 dB for the two stronger ones. Balanced choice, not the foveal maximum.
QOFFSETS = (-0.3, -0.15)
MATCH_TOL = 0.02
MATCH_STEPS = 6


def frame_regions(gx, gy, w, h, radius_px, qoffsets=QOFFSETS):
    """Nested rectangles (x, y, w, h, qoffset) around the gaze, strongest/innermost first. Centre snapped to the 16-px
    macroblock grid; ring i has half-size radius * (1 + i/2) (+8 px for the snap) rounded up to 16; clipped to the frame."""
    cx, cy = round(gx / MB) * MB, round(gy / MB) * MB
    out = []
    for i, q in enumerate(qoffsets):
        half = math.ceil((radius_px * (1 + 0.5 * i) + MB / 2) / MB) * MB
        x0, y0, x1, y1 = max(0, cx - half), max(0, cy - half), min(w, cx + half), min(h, cy + half)
        if x1 > x0 and y1 > y0:
            out.append((x0, y0, x1 - x0, y1 - y0, q))
    return tuple(out)


def roi_filter_graph(trace, w, h, n, deg=fovea.FOVEA_DEG, qoffsets=QOFFSETS):
    """Returns (graph text or None, per-frame regions). Output pad is [out]. None when there is nothing to mark."""
    r = fovea.deg_to_px(deg, w)
    regions = [frame_regions(*pipeline.gaze_px(trace, k, w, h)[:2], w, h, r, qoffsets) for k in range(n)]
    if not any(regions):
        return None, regions
    runs = []  # (first frame, last frame, regions)
    for k, reg in enumerate(regions):
        if runs and runs[-1][2] == reg:
            runs[-1][1] = k
        else:
            runs.append([k, k, reg])
    parts = ["[0:v]split=%d%s" % (len(runs), "".join(f"[s{i}]" for i in range(len(runs))))]
    for i, (a, b, reg) in enumerate(runs):
        chain = "".join(f",addroi=x={x}:y={y}:w={rw}:h={rh}:qoffset={q}" for x, y, rw, rh, q in reg)
        parts.append(f"[s{i}]select='between(n,{a},{b})'{chain}[o{i}]")
    parts.append("".join(f"[o{i}]" for i in range(len(runs))) + f"interleave=nb_inputs={len(runs)}[out]")
    return ";".join(parts), regions


def encode_h264(inp, kbps, out, graph=None, level="3.1"):
    """Realtime video-call-like H.264, identical for baseline (graph=None) and ROI. Use level="4.0" for 1080p."""
    b = f"{int(kbps)}k"
    flags = ["-r", str(pipeline.FPS), "-c:v", "libx264", "-profile:v", "baseline", "-level", level, "-preset", "veryfast",
             "-tune", "zerolatency", "-pix_fmt", "yuv420p", "-b:v", b, "-maxrate", b, "-bufsize", b,
             "-g", "60", "-keyint_min", "60", "-sc_threshold", "0", out]
    if not graph:
        pipeline.ffmpeg("-i", inp, "-an", *flags)
        return out
    gpath = out + ".graph.txt"  # a file, not an argument: long graphs exceed the Windows command-line limit
    with open(gpath, "w") as f:
        f.write(graph)
    try:
        pipeline.ffmpeg("-i", inp, "-an", "-/filter_complex", gpath, "-map", "[out]", *flags)
    finally:
        os.remove(gpath)
    return out


class _Ctx:
    def __init__(self, clip, res, n, seed, deg, start_s, tmp, qoffsets):
        self.w, self.h = experiments.SIZES[res]
        self.n, self.tmp, self.level = n, tmp, "4.0" if res > 720 else "3.1"
        shutil.rmtree(tmp, ignore_errors=True)
        os.makedirs(tmp)
        trace = traces.generate(seed, n / pipeline.FPS, width=self.w, height=self.h, clip=os.path.basename(clip))
        self.ref = pipeline.make_reference(clip, self.w, self.h, n, os.path.join(tmp, "ref.mkv"), start_s=start_s)
        self.gaze = [pipeline.gaze_px(trace, k, self.w, self.h)[:2] for k in range(n)]
        self.r_meas = fovea.deg_to_px(deg, self.w)
        self.graph, _ = roi_filter_graph(trace, self.w, self.h, n, deg, qoffsets)
        self.row = {"clip": os.path.basename(clip), "res": res, "frames": n, "fovea_deg": deg, "seed": seed,
                    "start_s": start_s, "synthetic_gaze": True, "codec": "h264", "qoffsets": list(qoffsets)}

    def encode(self, kbps, roi):
        enc = encode_h264(self.ref, kbps, os.path.join(self.tmp, "e.mp4"), self.graph if roi else None, self.level)
        s = pipeline.stream_stats(enc, self.n)
        s["kbps_target"] = kbps
        return enc, s

    def probe(self, kbps, roi):
        enc, s = self.encode(kbps, roi)
        s.update(pipeline.measure(self.ref, enc, self.w, self.h, self.n, self.gaze, self.r_meas, self.tmp))
        os.remove(enc)
        return s

    def probe_matched(self, start_kbps, want_kbps):
        """ROI stream whose ACHIEVED kbps is within MATCH_TOL of want_kbps: the target is rescaled by want/achieved
        (the rate curve is close to linear, so this converges faster than a blind bisection). Closest try is kept."""
        t, best = start_kbps, None
        for i in range(MATCH_STEPS):
            _, s = self.encode(t, True)
            err = abs(s["kbps"] - want_kbps) / want_kbps
            if best is None or err < best[0]:
                best = (err, t)
            if err <= MATCH_TOL:
                break
            t = max(experiments.MIN_KBPS / 2, t * want_kbps / s["kbps"])
        s = self.probe(best[1], True)
        s["matched"], s["match_tries"] = best[0] <= MATCH_TOL, i + 1
        return s


def _gains(b, g):
    return {"foveal_psnr_gain_db": g["foveal_psnr"]["mean"] - b["foveal_psnr"]["mean"],
            "foveal_ssim_gain": g["foveal_ssim"]["mean"] - b["foveal_ssim"]["mean"], "kbps_ratio": g["kbps"] / b["kbps"]}


def experiment_b_roi(clip, res, caps, n=90, seed=1, deg=fovea.FOVEA_DEG, start_s=0.0, tmp="results/tmp/roi/b", qoffsets=QOFFSETS):
    """Same target kbps for both streams, plus the fair number: the ROI stream re-targeted to the baseline's ACHIEVED kbps."""
    c = _Ctx(clip, res, n, seed, deg, start_s, tmp, qoffsets)
    rows = []
    try:
        for cap in caps:
            b, g = c.probe(cap, False), c.probe(cap, True)
            if abs(g["kbps"] - b["kbps"]) <= MATCH_TOL * b["kbps"]:
                eq = dict(g, matched=True, match_tries=0)
            else:
                eq = c.probe_matched(cap * b["kbps"] / g["kbps"], b["kbps"])
            rows.append({"experiment": "B-roi", **c.row, "cap_kbps": cap, "baseline": b, "glance": g, **_gains(b, g),
                         "equal_bitrate": {"glance": eq, "matched": eq["matched"], **_gains(b, eq)}})
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return rows


def experiment_a_roi(clip, res, n=90, seed=1, deg=fovea.FOVEA_DEG, base_kbps=None, start_s=0.0, tmp="results/tmp/roi/a", qoffsets=QOFFSETS):
    """Lowest ROI target whose foveal PSNR is within TOL_DB of the baseline's at the baseline bitrate; saving from ACHIEVED kbps."""
    c = _Ctx(clip, res, n, seed, deg, start_s, tmp, qoffsets)
    base_kbps = base_kbps or experiments.UNCONSTRAINED[res]
    try:
        base = c.probe(base_kbps, False)
        goal = base["foveal_psnr"]["mean"] - experiments.TOL_DB
        lo, hi = experiments.MIN_KBPS, base_kbps
        probes = [c.probe(hi, True)]
        best = None
        if probes[0]["foveal_psnr"]["mean"] >= goal:
            best = probes[0]
            for _ in range(experiments.BISECT_STEPS):
                mid = (lo + hi) / 2.0
                p = c.probe(mid, True)
                probes.append(p)
                if p["foveal_psnr"]["mean"] >= goal:
                    best, hi = p, mid
                else:
                    lo = mid
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return {"experiment": "A-roi", **c.row, "baseline_target_kbps": base_kbps, "baseline": base, "goal_foveal_psnr": goal,
            "tol_db": experiments.TOL_DB, "probes": probes, "glance": best, "reached": best is not None,
            "percent_saved": (100.0 * (1 - best["kbps"] / base["kbps"])) if best else None}


def _line(r):
    b = r["baseline"]
    if r["experiment"] == "A-roi":
        g = r["glance"]
        tail = (f"roi {g['kbps']:.0f} kbps fov {g['foveal_psnr']['mean']:.2f} dB periph {g['periph_psnr']['mean']:.2f} dB "
                f"saved {r['percent_saved']:.1f}%") if g else "NOT REACHED"
        return (f"A-roi {r['clip']} {r['res']}p q={r['qoffsets']} base {b['kbps']:.0f} kbps fov {b['foveal_psnr']['mean']:.2f} dB "
                f"periph {b['periph_psnr']['mean']:.2f} dB | {tail} (synthetic gaze)")
    g, e = r["glance"], r["equal_bitrate"]
    eg = e["glance"]
    return (f"B-roi {r['clip']} {r['res']}p cap {r['cap_kbps']} q={r['qoffsets']} base {b['kbps']:.0f} kbps fov {b['foveal_psnr']['mean']:.2f} dB "
            f"periph {b['periph_psnr']['mean']:.2f} | same-target roi {g['kbps']:.0f} kbps fov {g['foveal_psnr']['mean']:.2f} ({r['foveal_psnr_gain_db']:+.2f}) | "
            f"equal-bitrate roi {eg['kbps']:.0f} kbps fov {eg['foveal_psnr']['mean']:.2f} periph {eg['periph_psnr']['mean']:.2f} "
            f"gain {e['foveal_psnr_gain_db']:+.2f} dB ssim {e['foveal_ssim_gain']:+.4f} matched={e['matched']} "
            f"dropped {b['frames_dropped']}/{eg['frames_dropped']} (synthetic gaze)")


def _job(spec, a):
    clip, _, start = spec.partition("@")
    tag = os.path.splitext(os.path.basename(clip))[0]
    kw = dict(n=a.frames, seed=a.seed, deg=a.deg, start_s=float(start or 0), qoffsets=tuple(a.qoffsets))
    rows = experiment_b_roi(clip, a.res, a.caps, tmp=f"results/tmp/roi/b_{tag}", **kw)
    if a.a:
        rows.append(experiment_a_roi(clip, a.res, tmp=f"results/tmp/roi/a_{tag}", **kw))
    return rows


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="ROI (per-block quality) vs plain H.264. Run from the repo root.")
    ap.add_argument("--clips", nargs="+", default=["web/public/clips/call-desk.mp4"], help="path or path@start_seconds")
    ap.add_argument("--res", type=int, default=720)
    ap.add_argument("--caps", type=int, nargs="+", default=[500])
    ap.add_argument("--frames", type=int, default=90)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--deg", type=float, default=fovea.FOVEA_DEG)
    ap.add_argument("--qoffsets", type=float, nargs="+", default=list(QOFFSETS), help="inner first")
    ap.add_argument("--a", action="store_true", help="also run experiment A-roi")
    ap.add_argument("--jobs", type=int, default=1, help="clips in parallel")
    ap.add_argument("--out", nargs="?", const="results/raw/exp_roi.json", help="write JSON (default results/raw/exp_roi.json)")
    args = ap.parse_args()
    allrows = []
    with ThreadPoolExecutor(args.jobs) as ex:
        for rows in ex.map(lambda s: _job(s, args), args.clips):
            for r in rows:
                print(_line(r), flush=True)
            allrows += rows
    if args.out:
        with open(args.out, "w") as f:
            json.dump(allrows, f, indent=1)
        print("wrote", args.out)
