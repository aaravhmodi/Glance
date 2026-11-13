import json
import os
import tempfile
import unittest
import xml.etree.ElementTree as ET

import report


class ReportTests(unittest.TestCase):
    def test_charts_are_valid_svg_and_bars_have_right_sign(self):
        p = os.path.join(tempfile.mkdtemp(), "c.svg")
        report.svg_bars(p, "t", ["a", "b"], [1.5, -2.0], "dB")
        root = ET.parse(p).getroot()
        rects = [e for e in root.iter() if e.tag.endswith("rect") and e.get("fill") != "white"]
        self.assertEqual([r.get("fill") for r in rects], ["#2a7", "#c43"])
        w = [float(r.get("width")) for r in rects]
        self.assertAlmostEqual(w[0] / w[1], 0.75, delta=0.0075)

    def test_doc_numbers_match_raw(self):
        report.main()
        doc = open(report.DOC).read()
        rows = json.load(open(os.path.join(report.RAW, "exp_b.json")))["rows"]
        gains = [r["foveal_psnr_gain_db"] for r in rows]
        self.assertIn("%d conditions: mean foveal-PSNR gain of Glance over baseline %+.2f dB" % (len(rows), sum(gains) / len(gains)), doc)
        self.assertIn("Glance is better in %d of %d conditions" % (sum(g > 0 for g in gains), len(gains)), doc)
        for f in ("exp_b_gain.svg", "exp_a_saved.svg", "tracker_error.svg"):
            ET.parse(os.path.join(report.CHARTS, f))


if __name__ == "__main__":
    unittest.main()
