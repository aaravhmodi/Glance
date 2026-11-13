#!/usr/bin/env python3
"""Skeptic: independent re-measurement and stress tests of the Glance offline numbers. Stdlib + ffmpeg only.

  ./.venv/Scripts/python.exe offline/experiments/skeptic.py --all [--out]     (or --t1 --t2 --t3 --t4 --t5)

Scoring here does NOT use pipeline.measure: streams are decoded to raw yuv420p over a pipe, the Y plane is taken as is,
encoder-dropped frames are filled by repeating the previous decoded frame (placed by packet pts), and the squared error is
summed in pure Python over the pixels whose centre lies within the radius of the gaze. Scratch files: results/tmp/skeptic/.
"""
import argparse
import hashlib
import json
import math
import operator
import os
import random
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
os.chdir(ROOT)  # relative paths only: no drive colon inside ffmpeg filter graphs
import fovea  # noqa: E402
import pipeline  # noqa: E402
import traces  # noqa: E402

TMP = "results/tmp/skeptic"
W, H, FPS = 1280, 720, 30
WORK = f"{TMP}/w{os.getpid()}"  # per-process scratch, so tasks can run side by side
R = fovea.deg_to_px(5.0, W)
CLIPS = {"call-desk": ("web/public/clips/call-desk.mp4", (0.50, 0.30)), "call-plants": ("web/public/clips/call-plants.mp4", (0.47, 0.33)),
         "riverbed": ("offline/experiments/media/riverbed_1080p25.y4m", (0.5, 0.5)),
         "spreadsheet": ("offline/experiments/media/spreadsheet_1080p30.y4m", (0.5, 0.5))}
SQ = [d * d for d in range(256)] + [d * d for d in range(-255, 0)]  # SQ[d] == d*d for d in -255..255 (negative indexing)


def y_frames(path, pre=()):
    """Y plane of every decoded frame, in decode order, no frame-rate conversion."""
    p = subprocess.Popen(["ffmpeg", "-hide_banner", "-loglevel", "error", *pre, "-i", path, "-an", "-fps_mode", "passthrough",
                          "-pix_fmt", "yuv420p", "-f", "rawvideo", "-"], stdout=subprocess.PIPE)
    fs = W * H * 3 // 2
    try:
        while True:
            buf = p.stdout.read(fs)
            if len(buf) < fs:
                break
            yield buf[:W * H]
    finally:
        p.stdout.close()
        p.wait()


def packet_index(path):
    out = pipeline.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time,flags", "-of", "csv=p=0", path]).stdout
    rows = [line.split(",") for line in out.split()]
    return [int(round(float(r[0]) * FPS)) for r in rows], [i for i, r in enumerate(rows) if "K" in r[1]]


def shown(path, n):
    """What a viewer sees at display slot k = 0..n-1: the newest decoded frame with index <= k. Yields (Y, fresh)."""
    idx, _ = packet_index(path)
    if not idx or idx[0] != 0 or idx != sorted(set(idx)):
        raise RuntimeError("unexpected packet timestamps in %s: %s" % (path, idx[:5]))
    frames = y_frames(path)
    cur, j = None, 0
    for k in range(n):
        fresh = j < len(idx) and idx[j] == k
        if fresh:
            cur = next(frames)
            j += 1
        yield cur, fresh
    if next(frames, None) is not None and j < len(idx):
        raise RuntimeError("decoded frames left over in " + path)


def spans(cx, cy, r):
    """Rows of the disc: (row offset in bytes, first px, last px + 1), pixel centres within r of (cx, cy)."""
    out = []
    for j in range(max(0, int(cy - r) - 1), min(H, int(cy + r) + 2)):
        rem = r * r - (j + 0.5 - cy) ** 2
        if rem <= 0:
            continue
        half = math.sqrt(rem)
        a, b = max(0, math.ceil(cx - half - 0.5)), min(W - 1, math.floor(cx + half - 0.5))
        if b >= a:
            out.append((j * W, a, b + 1))
    return out


def disc_mse(t, r, cx, cy, rad):
    sse = area = 0
    for off, a, b in spans(cx, cy, rad):
        sse += sum(map(SQ.__getitem__, map(operator.sub, t[off + a:off + b], r[off + a:off + b])))
        area += b - a
    return sse / area


def score(test, ref, specs):
    """specs: name -> (centres, radius). test yields (Y, fresh), ref yields Y. Returns ({name: [mse per frame]}, [fresh])."""
    out, fresh = {k: [] for k in specs}, []
    for k, ((t, f), r) in enumerate(zip(test, ref)):
        fresh.append(f)
        for name, (cs, rad) in specs.items():
            out[name].append(disc_mse(t, r, cs[k][0], cs[k][1], rad))
    return out, fresh


def psnr(m):
    return 100.0 if m <= 0 else min(100.0, 10 * math.log10(255.0 * 255.0 / m))


def mean_psnr(ms, keep=None):
    v = [psnr(m) for i, m in enumerate(ms) if keep is None or keep[i]]
    return sum(v) / len(v) if v else None


def pooled_psnr(ms):
    return psnr(sum(ms) / len(ms))


# ---- gaze traces ----
def std_trace(seed, n):
    return traces.generate(seed, n / FPS, width=W, height=H)


def moving(seed, n):
    tr = std_trace(seed, n)
    return [pipeline.gaze_px(tr, k, W, H)[:2] for k in range(n)]


def fixed(n, at=(0.5, 0.5)):
    return [(at[0] * W, at[1] * H)] * n


def calm(seed, n, face):
    """'Call-like' gaze: fixations 0.5-2.0 s joined by 40 ms linear saccades. 80 % of targets are N(face, sd 0.03 of the
    frame) (about 0.9 deg at 1280 px: eyes/mouth), 20 % are N(face, sd 0.15) glances away, clipped to 0.05..0.95. Seeded."""
    rng = random.Random(seed)

    def target():
        sd = 0.03 if rng.random() < 0.8 else 0.15
        return tuple(min(0.95, max(0.05, rng.gauss(c, sd))) for c in face)

    segs, t, cur = [], 0.0, target()
    while t < n / FPS + 1:
        fix, nxt = rng.uniform(0.5, 2.0), target()
        segs.append((t + fix, t + fix + 0.04, cur, nxt))
        t, cur = t + fix + 0.04, nxt
    out, si = [], 0
    for k in range(n):
        tk = k / FPS
        while segs[si][1] <= tk:
            si += 1
        t1, t2, a, b = segs[si]
        u = 0.0 if tk <= t1 else (tk - t1) / (t2 - t1)
        out.append(((a[0] + (b[0] - a[0]) * u) * W, (a[1] + (b[1] - a[1]) * u) * H))
    return out


# ---- encode / compare ----
def reference(clip, n):
    out = f"{TMP}/ref_{clip}_{n}.mkv"
    if not os.path.exists(out):
        pipeline.make_reference(CLIPS[clip][0], W, H, n, out)
    return out


def encode(inp, kbps, out, gop=60):
    if gop == 60:
        return pipeline.encode(inp, kbps, out)  # the harness's own command, untouched
    fl = pipeline.vp9_flags(kbps)
    fl[fl.index("-g") + 1] = fl[fl.index("-keyint_min") + 1] = str(gop)
    pipeline.ffmpeg("-i", inp, "-an", "-r", str(FPS), *fl, out)
    return out


TAG = "setparams=range=tv:colorspace=bt709"  # metadata only, pixel values untouched


def glance_fixed(ref, n, tr, out, centres):
    """pipeline.glance_frames with ONE change: the reference and the weight mask carry the same colour tags. On ffmpeg 8.1
    the untagged raw mask is otherwise auto-converted ("YUV color matrix differs ... using intermediate RGB") to the
    reference's bt709/tv before maskedmerge, which corrupts the weights, so no part of the frame stays sharp."""
    wpath = out + ".weights.yuv"
    with open(wpath, "wb") as f:
        for k in range(n):
            frame, mw, mh = fovea.weight_frame_yuv420(W, H, centres[k][0], centres[k][1], fovea.fovea_radius_px(W, pipeline.gaze_px(tr, k, W, H)[2]))
            f.write(frame)
    pw, ph = fovea.periphery_size(W, H)
    grid = f"fps={FPS},trim=end_frame={n},setpts=N/{FPS}/TB"
    graph = (f"[0:v]{grid},format=yuv420p,{TAG},split[a][b];[b]scale={pw}:{ph}:flags=area,scale={W}:{H}:flags=bilinear[p];"
             f"[1:v]{grid},{TAG},scale={W}:{H}:flags=bilinear[m];[p][a][m]maskedmerge,format=yuv420p")
    try:
        pipeline.ffmpeg("-i", ref, "-f", "rawvideo", "-pix_fmt", "yuv420p", "-s", f"{mw}x{mh}", "-framerate", str(FPS), "-i", wpath,
                        "-filter_complex", graph, "-frames:v", str(n), "-c:v", "ffv1", out)
    finally:
        os.remove(wpath)
    return out


def make_glance(filt, ref, n, tr, out, centres):
    if filt == "harness":
        return pipeline.glance_frames(ref, W, H, n, tr, out, centres=centres)
    return glance_fixed(ref, n, tr, out, centres)


def compare(clip, n, kbps, gazes, gop=60, radii=(1.0,), keep_per_frame=False, filt="fixed"):
    """Baseline vs Glance for each named gaze path (per-frame px centres); both scored against the reference at those centres."""
    ref = reference(clip, n)
    tr = std_trace(1, n)  # only supplies sigma (20 px) so the Glance radius is the harness's
    specs = {f"{g}@{m}": (cs, R * m) for g, cs in gazes.items() for m in radii}
    base = encode(ref, kbps, f"{WORK}/base.webm", gop)
    bst = pipeline.stream_stats(base, n)
    bm, bfresh = score(shown(base, n), y_frames(ref), specs)
    rows = []
    for g, cs in gazes.items():
        gin = make_glance(filt, ref, n, tr, f"{WORK}/gin.mkv", cs)
        enc = encode(gin, kbps, f"{WORK}/glance.webm", gop)
        gst = pipeline.stream_stats(enc, n)
        gm, gfresh = score(shown(enc, n), y_frames(ref), {k: v for k, v in specs.items() if k.startswith(g + "@")})
        both = [a and b for a, b in zip(bfresh, gfresh)]
        for m in radii:
            b, x = bm[f"{g}@{m}"], gm[f"{g}@{m}"]
            row = {"clip": clip, "frames": n, "kbps_target": kbps, "gop": gop, "prefilter": filt, "gaze": g, "disc_x_radius": m,
                   "kbps_base": round(bst["kbps"], 1), "kbps_glance": round(gst["kbps"], 1),
                   "frozen_base": n - sum(bfresh), "frozen_glance": n - sum(gfresh), "frames_fresh_in_both": sum(both),
                   "psnr_base": round(mean_psnr(b), 3), "psnr_glance": round(mean_psnr(x), 3),
                   "gain_db": round(mean_psnr(x) - mean_psnr(b), 3),
                   "gain_db_pooled_mse": round(pooled_psnr(x) - pooled_psnr(b), 3),
                   "gain_db_fresh_in_both": round(mean_psnr(x, both) - mean_psnr(b, both), 3) if any(both) else None,
                   "gain_db_after_1s": round(mean_psnr(x[30:]) - mean_psnr(b[30:]), 3),
                   "worst_base": round(min(map(psnr, b)), 2), "worst_glance": round(min(map(psnr, x)), 2)}
            if keep_per_frame:
                row["_mse_base"], row["_mse_glance"] = b, x
            rows.append(row)
            print("  " + " ".join(f"{k}={v}" for k, v in row.items() if not k.startswith("_")), flush=True)
    return rows


# ---- tasks ----
def t1():
    """Independent re-measurement of call-desk 720p 500 kbps seed 1 against pipeline.measure, plus alignment check."""
    n, cs = 90, moving(1, 90)
    ref = reference("call-desk", n)
    assert all(a == b for a, b in zip(spans(400.3, 200.7, 50.0), [(j * W, min(i for i in range(W) if math.hypot(i + .5 - 400.3, j + .5 - 200.7) <= 50),
               1 + max(i for i in range(W) if math.hypot(i + .5 - 400.3, j + .5 - 200.7) <= 50)) for j in range(H)
               if any(math.hypot(i + .5 - 400.3, j + .5 - 200.7) <= 50 for i in range(W))])), "span maths disagrees with brute force"
    gin = pipeline.glance_frames(ref, W, H, n, std_trace(1, n), f"{WORK}/gin.mkv")  # exactly as experiments._setup
    refs = list(y_frames(ref))
    out = {"radius_px": R}
    for name, src in (("baseline", ref), ("glance", gin)):
        enc = pipeline.encode(src, 500, f"{WORK}/t1_{name}.webm")
        idx, keys = packet_index(enc)
        fr = list(shown(enc, n))
        mine, _ = score(iter(fr), iter(refs), {"d": (cs, R)})
        os.makedirs(f"{WORK}/m", exist_ok=True)
        theirs = pipeline.measure(ref, enc, W, H, n, cs, R, f"{WORK}/m")
        # alignment: stream slot k against reference k-1, k, k+1 (slots 1..n-2); the true pairing must give the smallest error
        sh = {s: pooled_psnr([disc_mse(fr[k][0], refs[k + s], cs[k][0], cs[k][1], R) for k in range(1, n - 1)]) for s in (-1, 0, 1)}
        out[name] = {"mine_mean_psnr": mean_psnr(mine["d"]), "harness_mean_psnr": theirs["foveal_psnr"]["mean"],
                     "diff_db": mean_psnr(mine["d"]) - theirs["foveal_psnr"]["mean"],
                     "mine_worst": min(map(psnr, mine["d"])), "harness_worst": theirs["foveal_psnr"]["worst"],
                     "mine_pooled": pooled_psnr(mine["d"]), "harness_pooled": theirs["foveal_psnr_of_mean_mse"],
                     "dropped_slots": [k for k in range(n) if k not in idx], "keyframe_packets": keys,
                     "psnr_vs_ref_shift": sh, "kbps": pipeline.stream_stats(enc, n)["kbps"]}
        print(name, json.dumps(out[name]), flush=True)
    out["gain_mine"] = out["glance"]["mine_mean_psnr"] - out["baseline"]["mine_mean_psnr"]
    out["gain_harness"] = out["glance"]["harness_mean_psnr"] - out["baseline"]["harness_mean_psnr"]
    print("gain mine %.3f dB, harness %.3f dB" % (out["gain_mine"], out["gain_harness"]))
    return out


def _unused_sharp_centroid(g, r, block=40):
    """Centre of mass of the blocks where the pre-filtered frame equals the reference (|diff| <= 1 everywhere)."""
    xs = ys = cnt = 0
    for by in range(0, H, block):
        for bx in range(0, W, block):
            if all(max(map(abs, map(operator.sub, g[j * W + bx:j * W + bx + block], r[j * W + bx:j * W + bx + block]))) <= 1 for j in range(by, by + block, 8)):
                xs, ys, cnt = xs + bx + block / 2, ys + by + block / 2, cnt + 1
    return (round(xs / cnt, 1), round(ys / cnt, 1), cnt) if cnt else None


def t2():
    """Fairness audit: source properties, reference fidelity, where glance_in differs from the reference, stream parameters."""
    n, cs = 90, moving(1, 90)
    out = {"encoder_flags": "one function pipeline.encode()/vp9_flags() is called for both streams; only the input file differs",
           "sources": {}}
    for c, (path, _) in CLIPS.items():
        out["sources"][c] = pipeline.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                                          "stream=codec_name,width,height,r_frame_rate,pix_fmt", "-of", "csv=p=0", path]).stdout.strip()
    ref = reference("call-desk", n)
    md5 = lambda it: hashlib.md5(b"".join(it)).hexdigest()  # noqa: E731
    out["ref_decodes_identically_twice"] = md5(y_frames(ref)) == md5(y_frames(ref))
    src = hashlib.md5()
    p = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", CLIPS["call-desk"][0], "-an", "-vf",
                        f"fps={FPS},scale={W}:{H}:flags=bicubic,format=yuv420p", "-frames:v", str(n), "-f", "rawvideo", "-"], capture_output=True)
    fs = W * H * 3 // 2
    for k in range(n):
        src.update(p.stdout[k * fs:k * fs + W * H])
    out["ref_equals_refiltered_source_luma"] = src.hexdigest() == md5(y_frames(ref))
    refs = list(y_frames(ref))
    out["ref_duplicate_frames"] = sum(refs[k] == refs[k - 1] for k in range(1, n))
    for clip in ("call-desk", "riverbed"):
        cref = reference(clip, n)
        crefs = refs if clip == "call-desk" else list(y_frames(cref))
        for filt in ("harness", "fixed"):
            gin = make_glance(filt, cref, n, std_trace(1, n), f"{WORK}/gin.mkv", cs)
            v6, v10 = [], []
            for k, g in enumerate(y_frames(gin)):
                v6.append(psnr(disc_mse(g, crefs[k], cs[k][0], cs[k][1], R * 0.6)))
                v10.append(psnr(disc_mse(g, crefs[k], cs[k][0], cs[k][1], R)))
            out[f"glance_in_vs_ref_in_disc/{clip}/{filt}_prefilter"] = {
                "x0.6_mean_psnr": sum(v6) / n, "x0.6_frames_bit_exact": sum(x >= 100 for x in v6),
                "x1.0_mean_psnr": sum(v10) / n, "x1.0_worst_psnr": min(v10), "x1.0_frames_bit_exact": sum(x >= 100 for x in v10)}
    gin = make_glance("harness", ref, n, std_trace(1, n), f"{WORK}/gin.mkv", cs)
    for name, src_path in (("baseline", ref), ("glance", gin)):
        enc = pipeline.encode(src_path, 500, f"{WORK}/t2_{name}.webm")
        idx, keys = packet_index(enc)
        out[name + "_stream"] = {"props": pipeline.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                                 "stream=codec_name,width,height,r_frame_rate,pix_fmt", "-of", "csv=p=0", enc]).stdout.strip(),
                                 "keyframe_slots": [idx[i] for i in keys], "first_frame_bytes": None, **pipeline.stream_stats(enc, n)}
    print(json.dumps(out, indent=1), flush=True)
    return out


def t3(quick=False):
    """Hypothesis test: fixed gaze vs the standard moving trace vs a calm call-like trace. Equal CBR cap, 720p, corrected pre-filter."""
    rows = []
    for clip in ("call-desk", "call-plants"):
        face = CLIPS[clip][1]
        for kbps in (500,) if quick else (300, 500, 1000):
            print(clip, kbps, flush=True)
            rows += compare(clip, 90, kbps, {"fixed_centre": fixed(90), "moving_seed1": moving(1, 90), "calm_seed1": calm(1, 90, face)})
    if not quick:
        print("call-desk 500 kbps, 300 frames", flush=True)
        rows += compare("call-desk", 300, 500, {"fixed_centre": fixed(300), "moving_seed1": moving(1, 300), "calm_seed1": calm(1, 300, CLIPS["call-desk"][1])})
        print("call-desk 500 kbps, 90 frames, pre-filter exactly as the harness runs it on this machine", flush=True)
        rows += compare("call-desk", 90, 500, {"fixed_centre": fixed(90), "moving_seed1": moving(1, 90)}, filt="harness")
    return rows


def t4():
    """Busy content: how much of the gain is frame drops? Gain on all slots vs slots fresh in both streams; higher cap; harness filter as is."""
    rows = []
    for clip in ("riverbed", "spreadsheet"):
        for kbps, gop, filt in ((1000, 60, "fixed"), (1000, 60, "harness"), (4000, 60, "fixed"), (1000, 3000, "fixed")):
            print(clip, kbps, "gop", gop, filt, flush=True)
            rows += compare(clip, 90, kbps, {"moving_seed1": moving(1, 90)}, gop=gop, filt=filt)
    return rows


def t5():
    """Metric sanity on call-desk 720p 500 kbps seed 1: disc of 0.6x / 1.0x / 1.5x the fovea radius; mean-of-PSNR vs PSNR of mean MSE."""
    return compare("call-desk", 90, 500, {"moving_seed1": moving(1, 90), "fixed_centre": fixed(90)}, radii=(0.6, 1.0, 1.5))


def main():
    ap = argparse.ArgumentParser()
    for t in ("t1", "t2", "t3", "t4", "t5", "all", "quick"):
        ap.add_argument("--" + t, action="store_true")
    ap.add_argument("--out", action="store_true", help="write results/raw/skeptic.json (merged with what is already there)")
    a = ap.parse_args()
    os.makedirs(WORK, exist_ok=True)
    res = {}
    for name, fn in (("t1", t1), ("t2", t2), ("t3", lambda: t3(a.quick)), ("t4", t4), ("t5", t5)):
        if a.all or getattr(a, name):
            print("==== " + name, flush=True)
            res[name] = fn()
    if a.out and res:
        path = "results/raw/skeptic.json"
        old = json.load(open(path)) if os.path.exists(path) else {}
        old.update(res)
        old["note"] = "SYNTHETIC gaze; generated by offline/experiments/skeptic.py; scoring independent of pipeline.measure"
        with open(path, "w") as f:
            json.dump(old, f, indent=1)
        print("wrote", path)


if __name__ == "__main__":
    main()
