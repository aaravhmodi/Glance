"""Developer helper: foveal PSNR of the Glance pre-filtered frames BEFORE encoding (should be ~lossless inside the disc)."""
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import experiments  # noqa: E402
import fovea  # noqa: E402
import pipeline  # noqa: E402

tmp = "results/tmp/pre"
shutil.rmtree(tmp, ignore_errors=True)
n = 90
w, h, trace, ref, gin, gaze = experiments._setup(sys.argv[1], 720, n, 1, tmp, 5.0)
r = fovea.deg_to_px(5.0, w)
print("pre-encode foveal:", pipeline.measure(ref, gin, w, h, n, gaze, r, tmp)["foveal_psnr"])
print("pre-encode foveal at 0.9r:", pipeline.measure(ref, gin, w, h, n, gaze, 0.9 * r, tmp)["foveal_psnr"])
shutil.rmtree(tmp, ignore_errors=True)
