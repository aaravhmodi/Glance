#!/usr/bin/env python3
"""Offline experiment harness entry point.  `python3 offline/experiments/run.py --quick` runs one condition (< 2 min)
and writes results/raw/quick.json.  (`--all` arrives with T7-T9.)

Everything here uses the SYNTHETIC gaze trace from traces.py (seeded), and the result files say so.
VMAF (needs ffmpeg libvmaf) and FovVideoVDP (needs pyfvvdp) are skipped when unavailable, with a note in the output."""
import argparse
import json
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pipeline  # noqa: E402
import traces  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
QUICK_CLIP = os.path.join(ROOT, "web", "public", "clips", "call-desk.mp4")


def metric_availability():
    notes = []
    if not pipeline.have_filter("libvmaf"):
        notes.append("VMAF skipped: this ffmpeg has no libvmaf filter")
    try:
        import pyfvvdp  # noqa: F401
    except ImportError:
        notes.append("FovVideoVDP skipped: pyfvvdp is not installed")
    return notes


def quick(out_dir, seed=1, frames=90, kbps=500, w=1280, h=720):
    tmp = os.path.join(ROOT, "results", "tmp", "quick")
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    trace = traces.generate(seed, frames / pipeline.FPS, width=w, height=h, clip=os.path.basename(QUICK_CLIP))
    try:
        res = pipeline.condition(QUICK_CLIP, w, h, frames, kbps, trace, tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    res["gaze_trace"] = {"synthetic": True, "seed": seed}
    res["notes"] = metric_availability()
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, "quick.json")
    with open(path, "w") as f:
        json.dump(res, f, indent=1)
    return res, path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true", help="one condition: call-desk 720p, 500 kbps, 5 deg fovea, synthetic gaze")
    ap.add_argument("--out", default=os.path.join(ROOT, "results", "raw"))
    args = ap.parse_args()
    if not args.quick:
        ap.error("only --quick exists so far (--all comes with T7-T9)")
    res, path = quick(args.out)
    b, g = res["baseline"], res["glance"]
    print(f"baseline {b['kbps']:.0f} kbps, Glance {g['kbps']:.0f} kbps, saved {res['percent_saved']:.1f} %  (500 kbps cap, synthetic gaze)")
    print(f"foveal PSNR baseline {b['foveal_psnr']['mean']:.2f} dB, Glance {g['foveal_psnr']['mean']:.2f} dB (worst frame {b['foveal_psnr']['worst']:.2f} / {g['foveal_psnr']['worst']:.2f})")
    print(f"full-frame PSNR baseline {b['full_psnr']['mean']:.2f} dB, Glance {g['full_psnr']['mean']:.2f} dB")
    for n in res["notes"]:
        print("note:", n)
    print("wrote", path)


if __name__ == "__main__":
    main()
