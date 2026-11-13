"""ffmpeg plumbing: reference frames, Glance pre-filtering, fair VP9 encode, measurement. Stdlib + ffmpeg/ffprobe only."""
import math
import os
import re
import subprocess

import fovea
import traces

FPS = 30
PSNR_CAP = 100.0

# Encoder flags: docs/research.md section 2 (libwebrtc VP9 realtime CBR equivalent). Same for baseline and Glance.
def vp9_flags(kbps):
    b = int(kbps)
    return ["-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "7",
            "-b:v", f"{b}k", "-minrate", f"{b}k", "-maxrate", f"{b}k", "-bufsize", f"{b}k",
            "-rc_init_occupancy", f"{max(1, b // 2)}k", "-qmin", "2", "-qmax", "52",
            "-undershoot-pct", "50", "-overshoot-pct", "50", "-lag-in-frames", "0", "-error-resilient", "0",
            "-row-mt", "1", "-tile-columns", "1", "-threads", "4", "-aq-mode", "3", "-static-thresh", "1",
            "-drop-threshold", "30", "-g", "60", "-keyint_min", "60"]


def run(cmd, **kw):
    p = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if p.returncode != 0:
        raise RuntimeError("command failed (%d): %s\n%s" % (p.returncode, " ".join(cmd), p.stderr[-2000:]))
    return p


def ffmpeg(*args, **kw):
    return run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], **kw)


def have_filter(name):
    out = run(["ffmpeg", "-hide_banner", "-filters"]).stdout
    return re.search(r"\s" + re.escape(name) + r"\s", out) is not None


def make_reference(clip, w, h, n, out, start_s=0.0):
    """Untouched source frames: n frames at 30 fps, w x h, yuv420p, lossless (ffv1)."""
    ffmpeg("-ss", str(start_s), "-i", clip, "-an", "-vf", f"fps={FPS},scale={w}:{h}:flags=bicubic,format=yuv420p",
           "-frames:v", str(n), "-c:v", "ffv1", out)
    return out


def gaze_px(trace, k, w, h, extra_lag_s=0.0, offset_px=(0.0, 0.0)):
    """Gaze (x, y, sigma) in frame pixels for frame k (optionally lagged and offset, for the tracker-error runs)."""
    x, y, s = traces.at(trace, max(0.0, k / FPS - extra_lag_s))
    sc = w / trace.get("width", w)
    return x * w + offset_px[0], y * h + offset_px[1], s * sc


def glance_frames(ref, w, h, n, trace, out, deg=fovea.FOVEA_DEG, radius_override=None, centres=None, tmpdir=None):
    """Pre-filter `ref` with the foveation weights centred on the trace (or on `centres`, a per-frame list of (x, y) px
    for the tracker-error runs). `radius_override` (px) replaces the radius, used by the sanity gate."""
    tmpdir = tmpdir or os.path.dirname(out)
    wpath = os.path.join(tmpdir, os.path.basename(out) + ".weights.yuv")
    mw = mh = None
    with open(wpath, "wb") as f:
        for k in range(n):
            gx, gy, sig = gaze_px(trace, k, w, h)
            if centres is not None:
                gx, gy = centres[k]
            r = radius_override if radius_override is not None else fovea.fovea_radius_px(w, sig, deg)
            frame, mw, mh = fovea.weight_frame_yuv420(w, h, gx, gy, r)
            f.write(frame)
    pw, ph = fovea.periphery_size(w, h)
    grid = f"fps={FPS},trim=end_frame={n},setpts=N/{FPS}/TB"  # both inputs on one 30 fps grid: frame k pairs with weights k
    # Same colour tags on the picture and the weight mask: otherwise ffmpeg 8 converts the untagged raw mask to the
    # picture's matrix through RGB before maskedmerge, which corrupts the weights (found by the Skeptic, 13 Nov).
    tag = "setparams=range=tv:colorspace=bt709"
    graph = (f"[0:v]{grid},format=yuv420p,{tag},split[a][b];[b]scale={pw}:{ph}:flags=area,scale={w}:{h}:flags=bilinear[p];"
             f"[1:v]{grid},{tag},scale={w}:{h}:flags=bilinear[m];[p][a][m]maskedmerge,format=yuv420p")
    try:
        ffmpeg("-i", ref, "-f", "rawvideo", "-pix_fmt", "yuv420p", "-s", f"{mw}x{mh}", "-framerate", str(FPS), "-i", wpath,
               "-filter_complex", graph, "-frames:v", str(n), "-c:v", "ffv1", out)
    finally:
        os.remove(wpath)
    return out


def encode(inp, kbps, out):
    ffmpeg("-i", inp, "-an", "-r", str(FPS), *vp9_flags(kbps), out)
    return out


def stream_stats(path, n_source):
    """Achieved bitrate from the bytes of the video packets (container overhead excluded), over the n_source/30 s the clip spans."""
    p = run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=size,flags", "-of", "csv=p=0", path])
    sizes, keys = [], 0
    for line in p.stdout.split():
        size, flags = line.split(",")
        sizes.append(int(size))
        keys += "K" in flags
    dur = n_source / FPS
    return {"bytes": sum(sizes), "kbps": sum(sizes) * 8 / dur / 1000.0, "frames_encoded": len(sizes),
            "frames_dropped": n_source - len(sizes), "keyframes": keys, "max_frame_bytes": max(sizes) if sizes else 0}


def _psnr_from_mse(mse):
    return PSNR_CAP if mse <= 0 else min(PSNR_CAP, 10 * math.log10(255.0 * 255.0 / mse))


def _lines(path):
    with open(path) as f:
        return f.read().splitlines()


def _parse_psnr(path):
    out = []
    for line in _lines(path):
        m = re.search(r"mse_avg:([0-9.eE+-]+|inf)", line)
        if m:
            out.append(0.0 if m.group(1) == "inf" else float(m.group(1)))
    return out


def _parse_ssim(path):
    out = []
    for line in _lines(path):
        m = re.search(r"All:([0-9.eE+-]+)", line)
        if m:
            out.append(float(m.group(1)))
    return out


def write_disc_masks(path, w, h, n, centres, radius_px):
    """Raw gray disc masks, one per frame (255 inside radius_px of the centre). Returns the exact disc area (px) per frame."""
    areas = []
    with open(path, "wb") as f:
        for k in range(n):
            frame, area = fovea.disc_frame_gray(w, h, centres[k][0], centres[k][1], radius_px)
            f.write(frame)
            areas.append(area)
    return areas


def _metric_run(kind, ref, test, mask, stats_path, n):
    """One ffmpeg run. kind = psnr|ssim; mask None = full frame, else gray disc masks (test is merged into ref outside the disc)."""
    # every input is forced onto the same 30 fps grid and cut to exactly n frames, so frames pair up one-to-one
    stats_path = stats_path.replace(os.sep, "/").replace(":", "\\\\:")  # Windows: backslash and the drive colon are special inside a filter graph
    grid = f"fps={FPS},trim=end_frame={n},setpts=N/{FPS}/TB"
    prep = "format=yuv420p,extractplanes=y"
    g = f"[0:v]{grid},{prep}[t];[1:v]{grid},{prep},split=2[r1][r2];"
    inputs = ["-i", test, "-i", ref]
    if mask:
        inputs += ["-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{mask[1]}x{mask[2]}", "-framerate", str(FPS), "-i", mask[0]]
        g += f"[2:v]{grid},format=gray[m];[r1][t][m]maskedmerge[x];[x][r2]{kind}=stats_file={stats_path}"
    else:
        g += f"[r1]nullsink;[t][r2]{kind}=stats_file={stats_path}"
    ffmpeg(*inputs, "-filter_complex", g, "-f", "null", "-")


def measure(ref, test_path, w, h, n, centres, radius_px, tmpdir):
    """Quality of `test_path` (an encoded stream) against the untouched `ref`, luma only, inside a disc of radius_px around
    `centres` (the TRUE gaze per frame), over the full frame, and in the periphery (derived from the other two).
    Frames the encoder dropped appear as a repeat of the previous frame (fps filter), as a viewer would see them.
    PSNR in the disc is exact: everything outside it is replaced by the reference, so MSE_disc = MSE_all / area_fraction.
    SSIM in the disc: same replacement (those windows score 1), rescaled by the area fraction; windows straddling the disc
    edge make it slightly optimistic. Periphery values are derived by the same area-weighted algebra."""
    mpath = os.path.join(tmpdir, "disc.gray")
    areas = write_disc_masks(mpath, w, h, n, centres, radius_px)
    st = {k: os.path.join(tmpdir, k + ".log") for k in ("psnr_in", "psnr_full", "ssim_in", "ssim_full")}
    mask = (mpath, w, h)
    try:
        _metric_run("psnr", ref, test_path, mask, st["psnr_in"], n)
        _metric_run("psnr", ref, test_path, None, st["psnr_full"], n)
        _metric_run("ssim", ref, test_path, mask, st["ssim_in"], n)
        _metric_run("ssim", ref, test_path, None, st["ssim_full"], n)
        mse_in, mse_full = _parse_psnr(st["psnr_in"]), _parse_psnr(st["psnr_full"])
        ss_in, ss_full = _parse_ssim(st["ssim_in"]), _parse_ssim(st["ssim_full"])
    finally:
        for p in [mpath, *st.values()]:
            if os.path.exists(p):
                os.remove(p)
    for name, v in (("psnr_in", mse_in), ("psnr_full", mse_full), ("ssim_in", ss_in), ("ssim_full", ss_full)):
        if len(v) != n:
            raise RuntimeError(f"frame count mismatch in {name}: {len(v)} measured vs {n} source frames")
    total = w * h
    p_in, p_full, p_out, s_in, s_full, s_out = [], [], [], [], [], []
    for k in range(n):
        a = areas[k] / total
        if a <= 0:
            raise RuntimeError("empty measurement disc at frame %d" % k)
        m_in = mse_in[k] / a
        m_out = (mse_full[k] - mse_in[k]) / (1 - a) if a < 1 else None
        p_in.append(_psnr_from_mse(m_in))
        p_full.append(_psnr_from_mse(mse_full[k]))
        si = 1 - (1 - ss_in[k]) / a
        s_in.append(si)
        s_full.append(ss_full[k])
        if a < 1:
            p_out.append(_psnr_from_mse(max(0.0, m_out)))
            s_out.append(1 - ((1 - ss_full[k]) - (1 - ss_in[k])) / (1 - a))
    def agg(v):
        return {"mean": sum(v) / len(v), "worst": min(v)} if v else None
    return {"foveal_psnr": agg(p_in), "full_psnr": agg(p_full), "periph_psnr": agg(p_out),
            "foveal_ssim": agg(s_in), "full_ssim": agg(s_full), "periph_ssim": agg(s_out),
            "foveal_psnr_of_mean_mse": _psnr_from_mse(sum(m / (areas[k] / total) for k, m in enumerate(mse_in)) / n),
            "disc_area_frac_mean": sum(areas) / len(areas) / total}


def condition(clip, w, h, n, kbps, trace, tmpdir, deg=fovea.FOVEA_DEG, measure_deg=fovea.FOVEA_DEG, ref=None, glance_radius_override=None):
    """One baseline-vs-Glance comparison at one bitrate. Baseline = the reference frames; Glance = the same frames
    foveated on the trace; both through the identical encoder command and scored against the untouched reference
    inside a disc of `measure_deg` around the true gaze."""
    os.makedirs(tmpdir, exist_ok=True)
    ref = ref or make_reference(clip, w, h, n, os.path.join(tmpdir, "ref.mkv"))
    gin = glance_frames(ref, w, h, n, trace, os.path.join(tmpdir, "glance_in.mkv"), deg=deg, radius_override=glance_radius_override)
    res = {"clip": os.path.basename(clip), "width": w, "height": h, "frames": n, "kbps_target": kbps,
           "fovea_deg": deg, "measure_deg": measure_deg, "synthetic_gaze": bool(trace.get("synthetic"))}
    true_gaze = [gaze_px(trace, k, w, h)[:2] for k in range(n)]
    r_meas = fovea.deg_to_px(measure_deg, w)
    for name, src in (("baseline", ref), ("glance", gin)):
        enc = encode(src, kbps, os.path.join(tmpdir, name + ".webm"))
        s = stream_stats(enc, n)
        s.update(measure(ref, enc, w, h, n, true_gaze, r_meas, tmpdir))
        s["flags"] = [] if abs(s["kbps"] - kbps) <= 0.15 * kbps else ["achieved kbps off target by more than 15%"]
        res[name] = s
    res["percent_saved"] = 100.0 * (1 - res["glance"]["kbps"] / res["baseline"]["kbps"])
    return res
