"""Developer helper: run experiment A once on one clip and print the probes. Usage: probe_a.py CLIP RES"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import experiments  # noqa: E402

r = experiments.experiment_a(sys.argv[1], int(sys.argv[2]), base_kbps=int(sys.argv[3]) if len(sys.argv) > 3 else None)
print("reached", r["reached"], "saved", r["percent_saved"], "baseline kbps", round(r["baseline"]["kbps"]),
      "foveal psnr", round(r["baseline"]["foveal_psnr"]["mean"], 2))
for p in r["probes"]:
    print(" probe target", round(p["kbps_target"]), "achieved", round(p["kbps"]), "foveal psnr", round(p["foveal_psnr"]["mean"], 2))
