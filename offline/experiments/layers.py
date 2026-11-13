"""Grid / two-layer method (browser-feasible: two ordinary VP9 encoders, no per-region quality inside one encoder).

BASE layer : the whole frame downscaled by `base_factor` per axis (bicubic), VP9; the receiver upscales it (bicubic).
FOVEA layer: a constant-size full-resolution crop that covers the fovea disc, snapped to a grid of `cell` px so it
             stays put while the gaze stays in the same cell; its own VP9 stream. When the crop moves ("jump") the
             content of that stream jumps; `force_kf` forces a keyframe on each jump frame.
RECEIVER   : upscaled base with the decoded crop pasted at its rect, HARD edge (no feathering). A crop frame the
             encoder dropped shows as the last decoded crop at ITS OWN rect (what a receiver would have).
Crop cutting and pasting are done in Python on raw yuv420p frames (frame k of the file = frame k of the source, by
construction), so there is no ffmpeg per-frame crop expression to trust.
Gaze is SYNTHETIC (traces.generate, seeded) and followed with zero lag; every row says synthetic_gaze=True.
Same encoder flags (pipeline.vp9_flags) for baseline and both layers. Stdlib + ffmpeg only.
"""
import argparse
import json
import math
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fovea  # noqa: E402
import pipeline  # noqa: E402
import traces  # noqa: E402
from experiments import BISECT_STEPS, MIN_KBPS, SIZES, TOL_DB, UNCONSTRAINED, _probe  # noqa: E402

FPS = pipeline.FPS
CELL = 160
# One rule for every clip, chosen by sweep() on call-desk 720p @ 500 kbps (seed 1): share 0.7 had the best foveal PSNR
# at both factors; factor 4 bought +0.05 dB in the fovea for -2.2 dB in the periphery; forced keyframes changed foveal
# PSNR by < 0.05 dB but made the fovea encoder drop 15 frames instead of 1.
BASE_FACTOR = 2
FOVEA_SHARE = 0.7
FORCE_KF = False
MATCH_TOL = 0.03    # total achieved kbps must be within 3 % of the baseline's achieved kbps
MIN_LAYER_KBPS = 10


# ---------- pure helpers ----------

def crop_size(w, h, radius_px, cell=CELL):
    """Constant crop size: enough whole cells to cover a disc of radius_px wherever it sits in a cell, capped to the frame."""
    side = (math.ceil(2 * radius_px / cell) + 1) * cell
    return min(side, w) // 2 * 2, min(side, h) // 2 * 2


def crop_rect(gx, gy, w, h, radius_px, cell=CELL):
    """(x, y, cw, ch): grid-snapped crop containing the disc of radius_px around the gaze (the part of it inside the
    frame). Origin = the cell line at or before gaze - radius, clamped to the frame (so the far edge may sit off-grid)."""
    if cell % 2 or w % 2 or h % 2:
        raise ValueError("cell, w and h must be even (yuv420p chroma alignment)")
    cw, ch = crop_size(w, h, radius_px, cell)

    def origin(g, size, full):
        g = min(max(g, 0.0), full - 1.0)
        return int(min(max(math.floor((g - radius_px) / cell) * cell, 0), full - size))

    return origin(gx, cw, w), origin(gy, ch, h), cw, ch


def crop_schedule(trace, w, h, n, deg=fovea.FOVEA_DEG, cell=CELL):
    """Per-frame crop rects following the trace, and the frames where the rect differs from the previous frame's."""
    r = fovea.deg_to_px(deg, w)
    rects = [crop_rect(*pipeline.gaze_px(trace, k, w, h)[:2], w, h, r, cell) for k in range(n)]
    return rects, [k for k in range(1, n) if rects[k] != rects[k - 1]]


def _planes(w, h):  # (offset, stride, subsampling) of Y, U, V in one raw yuv420p frame
    return (0, w, 1), (w * h, w // 2, 2), (w * h + w * h // 4, w // 2, 2)


def cut(frame, w, h, rect):
    x, y, cw, ch = rect
    return b"".join(frame[off + (y // d + j) * st + x // d: off + (y // d + j) * st + (x + cw) // d]
                    for off, st, d in _planes(w, h) for j in range(ch // d))


def paste(frame, w, h, crop, rect):
    """Overwrite rect of `frame` (bytearray) with `crop` (raw yuv420p of the rect's size)."""
    x, y, cw, ch = rect
    pos = 0
    for off, st, d in _planes(w, h):
        for j in range(ch // d):
            a = off + (y // d + j) * st + x // d
            frame[a:a + cw // d] = crop[pos:pos + cw // d]
            pos += cw // d


# ---------- ffmpeg plumbing ----------

def _raw_in(path, w, h):
    return ["-f", "rawvideo", "-pix_fmt", "yuv420p", "-s", f"{w}x{h}", "-framerate", str(FPS), "-i", path]


def _to_raw(video, out, n, scale=None, passthrough=False):
    """Decode to raw yuv420p. Default: on the 30 fps grid (dropped frames repeat), optionally upscaled bicubic."""
    if passthrough:
        pipeline.ffmpeg("-i", video, "-fps_mode", "passthrough", "-pix_fmt", "yuv420p", "-f", "rawvideo", out)
    else:
        vf = f"fps={FPS},trim=end_frame={n}" + (f",scale={scale[0]}:{scale[1]}:flags=bicubic" if scale else "") + ",format=yuv420p"
        pipeline.ffmpeg("-i", video, "-vf", vf, "-frames:v", str(n), "-f", "rawvideo", out)
    return out


def write_crop(ref, w, h, n, rects, out, tmp):
    """Lossless (ffv1) video whose frame k is rects[k] cut from frame k of ref."""
    raw, craw = os.path.join(tmp, "ref.yuv"), os.path.join(tmp, "crop.yuv")
    _to_raw(ref, raw, n)
    size = w * h * 3 // 2
    try:
        with open(raw, "rb") as f, open(craw, "wb") as g:
            for k in range(n):
                frame = f.read(size)
                if len(frame) != size:
                    raise RuntimeError(f"reference has fewer than {n} frames")
                g.write(cut(frame, w, h, rects[k]))
        pipeline.ffmpeg(*_raw_in(craw, rects[0][2], rects[0][3]), "-c:v", "ffv1", out)
    finally:
        for p in (raw, craw):
            if os.path.exists(p):
                os.remove(p)
    return out


def _encode(inp, kbps, out, extra=()):
    """pipeline.encode plus optional extra output flags (forced keyframes). Identical encoder settings."""
    pipeline.ffmpeg("-i", inp, "-an", "-r", str(FPS), *pipeline.vp9_flags(kbps), *extra, out)
    return out


def _kf_args(jumps):
    # half a frame early: ffmpeg forces the first frame with pts >= t, so rounding can never push it to frame k+1
    return ["-force_key_frames", ",".join(f"{(k - 0.5) / FPS:.5f}" for k in jumps)] if jumps else []


def packet_frames(path):
    """Source-frame index and keyframe flag of every encoded packet (which frames survived the encoder's frame dropping)."""
    p = pipeline.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time,flags", "-of", "csv=p=0", path])
    out = []
    for line in p.stdout.split():
        t, flags = line.split(",")[:2]
        out.append((int(round(float(t) * FPS)), "K" in flags))
    return out


def composite(base_video, crop_video, w, h, n, rects, out, tmp):
    """Receiver: base_video upscaled (bicubic) to w x h, decoded crop pasted at its rect (hard edge). Lossless ffv1 out."""
    braw, craw, oraw = (os.path.join(tmp, x) for x in ("base_up.yuv", "crop_dec.yuv", "comp.yuv"))
    try:
        _to_raw(base_video, braw, n, scale=(w, h))
        _to_raw(crop_video, craw, n, passthrough=True)
        idx = [k for k, _ in packet_frames(crop_video)]
        cw, ch = rects[0][2], rects[0][3]
        size, csize = w * h * 3 // 2, cw * ch * 3 // 2
        if os.path.getsize(craw) != csize * len(idx):
            raise RuntimeError("decoded crop frame count differs from its packet count")
        with open(braw, "rb") as fb, open(craw, "rb") as fc, open(oraw, "wb") as fo:
            frame = crop = None
            src = -1  # source frame index of the crop currently shown
            j = 0
            for k in range(n):
                b = fb.read(size)
                if len(b) == size:
                    frame = b  # else: base stream ended early (trailing drops), keep showing its last frame
                while j < len(idx) and idx[j] <= k:
                    crop, src = fc.read(csize), idx[j]
                    j += 1
                o = bytearray(frame)
                if crop is not None:
                    paste(o, w, h, crop, rects[min(src, n - 1)])
                fo.write(o)
        pipeline.ffmpeg(*_raw_in(oraw, w, h), "-c:v", "ffv1", out)
    finally:
        for p in (braw, craw, oraw):
            if os.path.exists(p):
                os.remove(p)
    return out


# ---------- the two-layer condition ----------

def setup(clip, res, n, seed, deg, start_s, base_factor, tmp, cell=CELL):
    w, h = SIZES[res]
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    trace = traces.generate(seed, n / FPS, width=w, height=h, clip=os.path.basename(clip))
    ref = pipeline.make_reference(clip, w, h, n, os.path.join(tmp, "ref.mkv"), start_s=start_s)
    return context(ref, w, h, n, trace, deg, base_factor, tmp, cell)


def context(ref, w, h, n, trace, deg, base_factor, tmp, cell=CELL):
    rects, jumps = crop_schedule(trace, w, h, n, deg, cell)
    bw, bh = w // base_factor // 2 * 2, h // base_factor // 2 * 2
    base_in = os.path.join(tmp, f"base_in{base_factor}.mkv")
    pipeline.ffmpeg("-i", ref, "-vf", f"scale={bw}:{bh}:flags=bicubic", "-c:v", "ffv1", base_in)
    return {"w": w, "h": h, "n": n, "ref": ref, "tmp": tmp, "rects": rects, "jumps": jumps, "base_factor": base_factor,
            "base_in": base_in, "crop_in": write_crop(ref, w, h, n, rects, os.path.join(tmp, "crop_in.mkv"), tmp),
            "true_gaze": [pipeline.gaze_px(trace, k, w, h)[:2] for k in range(n)], "r_meas": fovea.deg_to_px(deg, w)}


def two_layer(ctx, total_kbps, share, force_kf=FORCE_KF, match=True):
    """Encode both layers, composite, measure. match=True: `total_kbps` is an ACHIEVED total to hit (the baseline's):
    base aims at (1-share) of it, the fovea layer takes what is left, targets corrected until the total is within
    MATCH_TOL. match=False: plain targets share / (1-share) of total_kbps, one encode each (experiment A probes)."""
    n, tmp = ctx["n"], ctx["tmp"]
    bp, fp = os.path.join(tmp, "base.webm"), os.path.join(tmp, "fov.webm")
    kf = _kf_args(ctx["jumps"]) if force_kf else []

    def enc(inp, target, out, goal, tries, extra=()):
        target = max(MIN_LAYER_KBPS, target)
        for _ in range(tries):
            s = pipeline.stream_stats(_encode(inp, target, out, extra), n)
            if not match or abs(s["kbps"] - goal) <= 0.02 * total_kbps:
                break
            target = max(MIN_LAYER_KBPS, target * min(4.0, max(0.25, goal / s["kbps"])))
        return s, target

    b, bt = enc(ctx["base_in"], (1 - share) * total_kbps, bp, (1 - share) * total_kbps, 3)
    goal_f = total_kbps - b["kbps"] if match else share * total_kbps
    f, ft = enc(ctx["crop_in"], goal_f, fp, goal_f, 5, kf)
    comp = composite(bp, fp, ctx["w"], ctx["h"], n, ctx["rects"], os.path.join(tmp, "comp.mkv"), tmp)
    pk = packet_frames(fp)
    r = pipeline.measure(ctx["ref"], comp, ctx["w"], ctx["h"], n, ctx["true_gaze"], ctx["r_meas"], tmp)
    for p in (bp, fp, comp):
        os.remove(p)
    total = b["kbps"] + f["kbps"]
    r.update({"kbps": total, "bytes": b["bytes"] + f["bytes"], "kbps_target": total_kbps, "base_kbps": b["kbps"],
              "fovea_kbps": f["kbps"], "base_target_kbps": bt, "fovea_target_kbps": ft, "fovea_share": share,
              "base_factor": ctx["base_factor"], "force_keyframes": force_kf, "jumps": len(ctx["jumps"]),
              "jump_frames": ctx["jumps"], "crop_size": list(ctx["rects"][0][2:]),
              "frames_dropped": {"base": b["frames_dropped"], "fovea": f["frames_dropped"]},
              "keyframes": {"base": b["keyframes"], "fovea": f["keyframes"]},
              "fovea_keyframe_frames": [k for k, key in pk if key],
              "budget_matched": (abs(total - total_kbps) <= MATCH_TOL * total_kbps) if match else None})
    return r


def _row(kind, clip, res, n, deg, seed, start_s, **kw):
    return {"experiment": kind, "clip": os.path.basename(clip), "res": res, "frames": n, "fovea_deg": deg, "seed": seed,
            "start_s": start_s, "synthetic_gaze": True, "codec": "vp9", "cell_px": CELL, **kw}


def experiment_b_layers(clip, res, caps, n=90, seed=1, deg=fovea.FOVEA_DEG, start_s=0.0, base_factor=BASE_FACTOR,
                        fovea_share=FOVEA_SHARE, force_kf=FORCE_KF, tmp="results/tmp/layers/b"):
    """Same kbps, which looks better in the fovea? Baseline = pipeline.encode of the reference at the cap; the two
    layers together are matched to the baseline's ACHIEVED kbps."""
    ctx = setup(clip, res, n, seed, deg, start_s, base_factor, tmp)
    rows = []
    try:
        for cap in caps:
            b = _probe(ctx["ref"], ctx["ref"], ctx["w"], ctx["h"], n, cap, ctx["true_gaze"], ctx["r_meas"], tmp, "b")
            g = two_layer(ctx, b["kbps"], fovea_share, force_kf)
            rows.append(_row("B-layers", clip, res, n, deg, seed, start_s, cap_kbps=cap, baseline=b, glance=g,
                             foveal_psnr_gain_db=g["foveal_psnr"]["mean"] - b["foveal_psnr"]["mean"],
                             foveal_ssim_gain=g["foveal_ssim"]["mean"] - b["foveal_ssim"]["mean"],
                             periph_psnr_gain_db=g["periph_psnr"]["mean"] - b["periph_psnr"]["mean"],
                             kbps_ratio=g["kbps"] / b["kbps"]))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return rows


def experiment_a_layers(clip, res, n=90, seed=1, deg=fovea.FOVEA_DEG, base_kbps=None, start_s=0.0, base_factor=BASE_FACTOR,
                        fovea_share=FOVEA_SHARE, force_kf=FORCE_KF, tmp="results/tmp/layers/a"):
    """Lowest two-layer total whose foveal PSNR is within TOL_DB of the baseline's at base_kbps (bisection on the total
    target, split by fovea_share). percent_saved compares ACHIEVED kbps. The periphery is NOT held equal: see periph_psnr."""
    ctx = setup(clip, res, n, seed, deg, start_s, base_factor, tmp)
    base_kbps = base_kbps or UNCONSTRAINED[res]
    try:
        base = _probe(ctx["ref"], ctx["ref"], ctx["w"], ctx["h"], n, base_kbps, ctx["true_gaze"], ctx["r_meas"], tmp, "b")
        goal = base["foveal_psnr"]["mean"] - TOL_DB
        lo, hi = MIN_KBPS, base_kbps
        probes = [two_layer(ctx, hi, fovea_share, force_kf, match=False)]
        best = None
        if probes[0]["foveal_psnr"]["mean"] >= goal:
            best = probes[0]
            for _ in range(BISECT_STEPS):
                mid = (lo + hi) / 2.0
                p = two_layer(ctx, mid, fovea_share, force_kf, match=False)
                probes.append(p)
                if p["foveal_psnr"]["mean"] >= goal:
                    best, hi = p, mid
                else:
                    lo = mid
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return _row("A-layers", clip, res, n, deg, seed, start_s, baseline_target_kbps=base_kbps, baseline=base,
                goal_foveal_psnr=goal, tol_db=TOL_DB, probes=probes, glance=best, reached=best is not None,
                percent_saved=(100.0 * (1 - best["kbps"] / base["kbps"])) if best else None)


def sweep(clip, res, cap, n=90, seed=1, deg=fovea.FOVEA_DEG, factors=(2, 4), shares=(0.3, 0.5, 0.7), tmp="results/tmp/layers/s"):
    """One clip, one cap: every base factor x fovea share x forced-keyframes on/off, against one baseline encode."""
    rows = []
    for factor in factors:
        ctx = setup(clip, res, n, seed, deg, 0.0, factor, tmp)
        try:
            b = _probe(ctx["ref"], ctx["ref"], ctx["w"], ctx["h"], n, cap, ctx["true_gaze"], ctx["r_meas"], tmp, "b")
            for share in shares:
                for kf in (True, False):
                    g = two_layer(ctx, b["kbps"], share, kf)
                    rows.append(_row("B-layers-sweep", clip, res, n, deg, seed, 0.0, cap_kbps=cap, baseline=b, glance=g,
                                     foveal_psnr_gain_db=g["foveal_psnr"]["mean"] - b["foveal_psnr"]["mean"],
                                     periph_psnr_gain_db=g["periph_psnr"]["mean"] - b["periph_psnr"]["mean"],
                                     kbps_ratio=g["kbps"] / b["kbps"]))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    return rows


def _line(r):
    b, g = r["baseline"], r["glance"]
    head = f"{r['experiment']:14s} {r['clip']:26s} start={r['start_s']:<4}"
    if r["experiment"] == "A-layers":
        if not g:
            return f"{head} base {b['kbps']:.0f}k fov {b['foveal_psnr']['mean']:.2f} dB: NOT REACHED"
        return (f"{head} base {b['kbps']:.0f}k fov {b['foveal_psnr']['mean']:.2f} per {b['periph_psnr']['mean']:.2f} | "
                f"layers {g['kbps']:.0f}k fov {g['foveal_psnr']['mean']:.2f} per {g['periph_psnr']['mean']:.2f} | saved {r['percent_saved']:.1f}%")
    return (f"{head} cap {r['cap_kbps']:5d} | base {b['kbps']:7.1f}k fov {b['foveal_psnr']['mean']:.2f} per {b['periph_psnr']['mean']:.2f} drop {b['frames_dropped']} | "
            f"layers f{g['base_factor']} s{g['fovea_share']} kf{int(g['force_keyframes'])} {g['kbps']:7.1f}k (base {g['base_kbps']:.0f} + fov {g['fovea_kbps']:.0f}) "
            f"fov {g['foveal_psnr']['mean']:.2f} per {g['periph_psnr']['mean']:.2f} | gain {r['foveal_psnr_gain_db']:+.2f} dB "
            f"periph {r['periph_psnr_gain_db']:+.2f} | jumps {g['jumps']} drop {g['frames_dropped']['base']}/{g['frames_dropped']['fovea']}"
            f"{'' if g['budget_matched'] else ' BUDGET-MISMATCH'}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="two-layer (grid) experiment; SYNTHETIC gaze")
    ap.add_argument("clips", nargs="*", default=["web/public/clips/call-desk.mp4"], help="clip paths, optionally path@start_s")
    ap.add_argument("--res", type=int, default=720)
    ap.add_argument("--caps", type=int, nargs="+", default=[300, 500, 1000])
    ap.add_argument("--n", type=int, default=90)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--factor", type=int, default=BASE_FACTOR)
    ap.add_argument("--share", type=float, default=FOVEA_SHARE)
    ap.add_argument("--force-kf", action=argparse.BooleanOptionalAction, default=FORCE_KF, help="force a keyframe on every crop jump")
    ap.add_argument("--a", action="store_true", help="also run experiment A-layers")
    ap.add_argument("--sweep", action="store_true", help="factor x share x keyframe sweep on the first clip at the first cap")
    ap.add_argument("--out", nargs="?", const="results/raw/exp_layers.json", help="write rows as JSON (default path if no value)")
    a = ap.parse_args()
    rows = []
    kw = dict(n=a.n, seed=a.seed, base_factor=a.factor, fovea_share=a.share, force_kf=a.force_kf)
    if a.sweep:
        rows += sweep(a.clips[0].split("@")[0], a.res, a.caps[0], n=a.n, seed=a.seed)
        for r in rows:
            print(_line(r), flush=True)
    else:
        for spec in a.clips:
            clip, _, start = spec.partition("@")
            new = experiment_b_layers(clip, a.res, a.caps, start_s=float(start or 0), **kw)
            if a.a:
                new.append(experiment_a_layers(clip, a.res, start_s=float(start or 0), **kw))
            for r in new:
                print(_line(r), flush=True)
            rows += new
    if a.out:
        os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
        with open(a.out, "w") as f:
            json.dump(rows, f, indent=1)
        print("wrote", a.out)
