"""Foveation maths: a line-by-line port of web/src/video/fovea.ts and web/src/gaze/accuracy.ts (pure stdlib).

The app's shader samples a mip pyramid at a continuous level blurLevel = MAX_LOD * (1 - quality). The offline harness
cannot sample mips with ffmpeg filters, so it mixes the sharp frame with a MAX_LOD-downscaled (~11x) copy using the
same quality weight: out = w * sharp + (1 - w) * periphery. Same weights, a 2-level approximation of the blur ramp.
"""
import math

FOVEA_DEG = 5.0
SIGMA_GAIN = 2.0
FALLOFF = 0.6
MAX_LOD = 3.5
DEFAULT_SCREEN_CM = 31.0
DEFAULT_DISTANCE_CM = 60.0
WEIGHT_BLOCK = 8  # the weight mask is computed on a grid 1/8 of the frame size and upscaled by ffmpeg (it is smooth)


def px_per_cm(view_w_px, screen_cm=DEFAULT_SCREEN_CM):
    return view_w_px / screen_cm


def deg_to_px(deg, view_w_px, screen_cm=DEFAULT_SCREEN_CM, distance_cm=DEFAULT_DISTANCE_CM):
    return math.tan(math.radians(deg)) * distance_cm * px_per_cm(view_w_px, screen_cm)


def px_to_deg(px, view_w_px, screen_cm=DEFAULT_SCREEN_CM, distance_cm=DEFAULT_DISTANCE_CM):
    return math.degrees(math.atan(px / px_per_cm(view_w_px, screen_cm) / distance_cm))


def fovea_radius_px(view_w_px, sigma_px=0.0, deg=FOVEA_DEG, screen_cm=DEFAULT_SCREEN_CM, distance_cm=DEFAULT_DISTANCE_CM):
    """5 deg (configurable) radius, widened by gaze uncertainty: hypot(r0, SIGMA_GAIN * sigma)."""
    r0 = deg_to_px(deg, view_w_px, screen_cm, distance_cm)
    s = sigma_px * SIGMA_GAIN if (math.isfinite(sigma_px) and sigma_px > 0) else 0.0
    return math.hypot(r0, s)


def quality(dist, radius):
    """1 inside the radius, Gaussian falloff outside (0 = peripheral quality)."""
    if dist <= radius:
        return 1.0
    k = (dist - radius) / (radius * FALLOFF)
    return math.exp(-k * k)


def blur_level(dist, radius):
    return MAX_LOD * (1.0 - quality(dist, radius))


def periphery_size(w, h):
    """Size of the downscaled copy that stands in for the periphery (2**MAX_LOD ~ 11.3x smaller), even and >= 2."""
    f = 2.0 ** MAX_LOD
    return max(2, int(round(w / f / 2)) * 2), max(2, int(round(h / f / 2)) * 2)


def weight_frame_yuv420(w, h, gx, gy, radius):
    """One raw yuv420p frame of the quality weight on a (w/8 x h/8) grid; Y, U and V all carry the weight (0..255) so that
    ffmpeg's maskedmerge blends luma and chroma alike. Returns (bytes, mw, mh)."""
    mw, mh = max(2, (w // WEIGHT_BLOCK) // 2 * 2), max(2, (h // WEIGHT_BLOCK) // 2 * 2)
    r = max(1.0, radius)
    rows = []
    for j in range(mh):
        y = (j + 0.5) / mh * h
        dy = y - gy
        rows.append(bytes(round(255 * quality(math.hypot((i + 0.5) / mw * w - gx, dy), r)) for i in range(mw)))
    y_plane = b"".join(rows)
    c_plane = b"".join(rows[j][::2] for j in range(0, mh, 2))
    return y_plane + c_plane + c_plane, mw, mh


def disc_frame_gray(w, h, gx, gy, radius):
    """One raw gray frame: 255 inside the disc of `radius` around (gx, gy) (pixel centres), 0 outside. Returns (bytes, area_px)."""
    rows = []
    area = 0
    r2 = radius * radius
    for j in range(h):
        dy = j + 0.5 - gy
        rem = r2 - dy * dy
        if rem <= 0:
            rows.append(bytes(w))
            continue
        half = math.sqrt(rem)
        a = max(0, int(math.ceil(gx - half - 0.5)))   # first pixel i with |i+0.5-gx| <= half
        b = min(w - 1, int(math.floor(gx + half - 0.5)))
        if b < a:
            rows.append(bytes(w))
            continue
        area += b - a + 1
        rows.append(bytes(a) + b"\xff" * (b - a + 1) + bytes(w - 1 - b))
    return b"".join(rows), area
