"""Print a table from results/raw/exp_a.json and exp_b.json (no new measurements)."""
import json
import os

raw = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "results", "raw")
a = json.load(open(os.path.join(raw, "exp_a.json")))["rows"]
b = json.load(open(os.path.join(raw, "exp_b.json")))["rows"]
print("A: clip res deg seed | base kbps/foveal dB | reached | glance kbps | saved %")
for r in a:
    g = r["glance"]
    print(r["clip"], r["res"], r["fovea_deg"], r["seed"], "|", round(r["baseline"]["kbps"]), round(r["baseline"]["foveal_psnr"]["mean"], 2), "|",
          r["reached"], "|", round(g["kbps"]) if g else "-", "|", round(r["percent_saved"], 1) if g else "-")
print("B: clip res deg seed cap | foveal dB base/glance (gain) | worst base/glance | kbps base/glance | foveal SSIM base/glance")
for r in b:
    x, y = r["baseline"], r["glance"]
    print(r["clip"], r["res"], r["fovea_deg"], r["seed"], r["cap_kbps"], "|", round(x["foveal_psnr"]["mean"], 2), round(y["foveal_psnr"]["mean"], 2),
          "(%+.2f)" % r["foveal_psnr_gain_db"], "|", round(x["foveal_psnr"]["worst"], 1), round(y["foveal_psnr"]["worst"], 1), "|",
          round(x["kbps"]), round(y["kbps"]), "|", round(x["foveal_ssim"]["mean"], 3), round(y["foveal_ssim"]["mean"], 3))
