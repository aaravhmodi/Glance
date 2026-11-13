"""Seeded SYNTHETIC gaze traces (fixations + saccades). Same JSON shape the app's recorder exports (web/src/gaze/recorder.ts):
x, y normalised 0..1, t in seconds, sigma in px of the recorded view (width x height). Always flagged "synthetic": true."""
import json
import random

FORMAT = "glance-gaze-trace-v1"
HZ = 30


def generate(seed, duration_s, width=1280, height=720, sigma_px=20.0, hz=HZ, anchors=None, centre_bias=0.5, clip="synthetic"):
    """Fixations of 200-600 ms joined by 40 ms linear saccades. Targets: with probability centre_bias a point drawn
    around the middle of the view (sd 0.12 of the frame), otherwise a random one of `anchors` (normalised x,y) if given,
    else uniform on the frame. Deterministic for a given seed."""
    rng = random.Random(seed)

    def target():
        if rng.random() < centre_bias:
            return (min(1, max(0, rng.gauss(0.5, 0.12))), min(1, max(0, rng.gauss(0.5, 0.12))))
        if anchors:
            return rng.choice(anchors)
        return (rng.uniform(0.05, 0.95), rng.uniform(0.05, 0.95))

    segs = []  # (t_start, t_end_fix, saccade_end, from_xy, to_xy)
    t = 0.0
    cur = target()
    while t < duration_s + 1.0:
        fix = rng.uniform(0.2, 0.6)
        nxt = target()
        segs.append((t, t + fix, t + fix + 0.04, cur, nxt))
        t += fix + 0.04
        cur = nxt

    samples = []
    n = int(round(duration_s * hz))
    si = 0
    for k in range(n):
        tk = k / hz
        while segs[si][2] <= tk:
            si += 1
        t0, t1, t2, a, b = segs[si]
        u = 0.0 if tk <= t1 else (tk - t1) / (t2 - t1)
        samples.append({"t": round(tk, 4), "x": a[0] + (b[0] - a[0]) * u, "y": a[1] + (b[1] - a[1]) * u, "sigma": sigma_px})
    return {"format": FORMAT, "clip": clip, "source": "synthetic", "synthetic": True, "seed": seed,
            "width": width, "height": height, "samples": samples}


def at(trace, t):
    """Linear interpolation of (x, y, sigma) (normalised x, y) at time t; clamps outside the recording."""
    s = trace["samples"]
    if t <= s[0]["t"]:
        p = s[0]
        return p["x"], p["y"], p["sigma"]
    if t >= s[-1]["t"]:
        p = s[-1]
        return p["x"], p["y"], p["sigma"]
    lo, hi = 0, len(s) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if s[mid]["t"] <= t:
            lo = mid
        else:
            hi = mid
    a, b = s[lo], s[hi]
    u = (t - a["t"]) / (b["t"] - a["t"])
    return tuple(a[k] + (b[k] - a[k]) * u for k in ("x", "y", "sigma"))


def save(trace, path):
    with open(path, "w") as f:
        json.dump(trace, f)


def load(path):
    with open(path) as f:
        tr = json.load(f)
    if tr.get("format") != FORMAT or not tr.get("samples"):
        raise ValueError("not a glance gaze trace: " + str(path))
    return tr
