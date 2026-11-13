"""Seeded loss/jitter transport MODEL (not a real network). See plan.md T8 and docs/research.md section 3.

Each encoded frame is split into 1200-byte packets (libwebrtc kVideoMtu). Every packet is lost with probability `loss`;
the random numbers depend only on (seed, frame index, packet index), so two streams with the same seed see the same
draws and the stream with fewer packets simply has fewer chances to lose one. A frame also has a network delay
(half-normal, sd = buffer/2); a frame later than the jitter buffer is dropped like a lost one. There is no
retransmission (pessimistic for both streams equally). A frame that is lost, or depends on one (everything up to the
next keyframe), is not decodable: the viewer keeps seeing the last good frame, grey before the first good keyframe.
"""
import math
import random

MTU = 1200


def packets(nbytes):
    return max(1, -(-nbytes // MTU))


def _draw(seed, frame, j):
    return random.Random((seed * 1000003 + frame) * 7919 + j).random()


def _delay_ms(seed, frame, buffer_ms):
    r = random.Random((seed * 1000003 + frame) * 104729 + 17)
    return abs(r.gauss(0.0, buffer_ms / 2.0))


def simulate(frames, n, loss, buffer_ms, seed):
    """frames: list of (source_index, bytes, is_key) for the encoded frames in display order; n = number of source frames.
    Returns (shown, stats): shown[k] = source index of the encoded frame the viewer sees at time k, or None (grey).
    buffer_ms = 0 disables jitter (no frame is ever late)."""
    good = {}  # source index -> decodable (arrived and its reference chain is intact)
    ok = False  # reference chain intact since the last good keyframe
    pk_total = pk_lost = f_lost = f_late = 0
    for idx, nbytes, key in frames:
        np_ = packets(nbytes)
        lost = sum(1 for j in range(np_) if _draw(seed, idx, j) < loss)
        pk_total += np_
        pk_lost += lost
        late = buffer_ms > 0 and _delay_ms(seed, idx, buffer_ms) > buffer_ms
        arrived = lost == 0 and not late
        f_lost += lost > 0
        f_late += late and lost == 0
        if key:
            ok = arrived
        elif not arrived:
            ok = False
        good[idx] = ok
    by_idx = sorted(good)
    shown, last, p = [], None, 0
    for k in range(n):
        while p < len(by_idx) and by_idx[p] <= k:
            if good[by_idx[p]]:
                last = by_idx[p]
            p += 1
        shown.append(last)
    frozen = [shown[k] is None or shown[k] != _latest(by_idx, k) for k in range(n)]
    longest = cur = 0
    for f in frozen:
        cur = cur + 1 if f else 0
        longest = max(longest, cur)
    return shown, {"packets": pk_total, "packets_lost": pk_lost, "frames_with_loss": f_lost, "frames_late": f_late,
                   "frozen_frames": sum(frozen), "frozen_fraction": sum(frozen) / n, "longest_freeze_frames": longest,
                   "never_shown_frames": sum(s is None for s in shown)}


def _latest(by_idx, k):
    lo, hi, best = 0, len(by_idx) - 1, None
    while lo <= hi:
        mid = (lo + hi) // 2
        if by_idx[mid] <= k:
            best, lo = by_idx[mid], mid + 1
        else:
            hi = mid - 1
    return best


def tracker_noise(seed, n, mean_err_px, rho=0.8):
    """Per-frame (dx, dy) tracker error in px: AR(1) Gaussian noise per axis (frame-to-frame correlation rho, which keeps the
    error partly slow like a real tracker's), scaled so the MEAN RADIAL error equals mean_err_px (Rayleigh: mean = sd*sqrt(pi/2))."""
    if mean_err_px <= 0:
        return [(0.0, 0.0)] * n
    rng = random.Random(seed)
    sd = mean_err_px / math.sqrt(math.pi / 2)
    innov = sd * math.sqrt(1 - rho * rho)
    x, y = rng.gauss(0, sd), rng.gauss(0, sd)
    out = []
    for _ in range(n):
        out.append((x, y))
        x = rho * x + rng.gauss(0, innov)
        y = rho * y + rng.gauss(0, innov)
    return out
