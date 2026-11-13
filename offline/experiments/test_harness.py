"""Harness tests. Content here is ffmpeg's synthetic testsrc2 and the gaze is synthetic: for tests only, never reported as a result."""
import math
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fovea  # noqa: E402
import pipeline  # noqa: E402
import traces  # noqa: E402

W, H, N = 320, 180, 30


class FoveaMaths(unittest.TestCase):
    def test_radius_matches_app_default(self):
        # web/src/video/fovea.ts: 5 deg at 1280 px / 31 cm / 60 cm is ~217 px (documented in project_status.md)
        self.assertAlmostEqual(fovea.fovea_radius_px(1280), 216.7, delta=0.5)
        self.assertAlmostEqual(fovea.px_to_deg(fovea.deg_to_px(7.0, 1920), 1920), 7.0, places=9)

    def test_sigma_widens_radius(self):
        r0, r1 = fovea.fovea_radius_px(1280), fovea.fovea_radius_px(1280, sigma_px=100)
        self.assertAlmostEqual(r1, math.hypot(r0, 200), places=9)

    def test_quality_ramp(self):
        self.assertEqual(fovea.quality(50, 100), 1.0)
        self.assertEqual(fovea.quality(100, 100), 1.0)
        self.assertAlmostEqual(fovea.quality(160, 100), math.exp(-1), places=9)  # (60 / (100 * 0.6))^2 = 1
        self.assertLess(fovea.quality(400, 100), 1e-6)
        self.assertAlmostEqual(fovea.blur_level(1e9, 100), fovea.MAX_LOD, places=6)

    def test_disc_area_is_pi_r_squared(self):
        for (gx, gy, r) in [(640, 360, 217), (400.3, 200.7, 60), (900, 500, 120.5)]:
            data, area = fovea.disc_frame_gray(1280, 720, gx, gy, r)
            self.assertLess(abs(area - math.pi * r * r) / (math.pi * r * r), 0.01)
            self.assertEqual(data.count(b"\xff"), area)
            self.assertEqual(len(data), 1280 * 720)

    def test_weight_frame_peak_and_size(self):
        data, mw, mh = fovea.weight_frame_yuv420(320, 180, 160, 90, 40)
        self.assertEqual(len(data), mw * mh * 3 // 2)
        self.assertEqual(data[(mh // 2) * mw + mw // 2], 255)  # centre of the fovea
        self.assertLess(data[0], 5)  # far corner is peripheral


class Traces(unittest.TestCase):
    def test_seeded_and_labelled(self):
        a, b, c = traces.generate(7, 4), traces.generate(7, 4), traces.generate(8, 4)
        self.assertEqual(a, b)
        self.assertNotEqual(a["samples"], c["samples"])
        self.assertTrue(a["synthetic"])
        self.assertEqual(len(a["samples"]), 120)
        self.assertTrue(all(0 <= p["x"] <= 1 and 0 <= p["y"] <= 1 for p in a["samples"]))
        self.assertEqual(set(a["samples"][0]), {"t", "x", "y", "sigma"})

    def test_fixation_lengths(self):
        tr = traces.generate(3, 30)
        xs = [(p["x"], p["y"]) for p in tr["samples"]]
        runs, cur = [], 1
        for i in range(1, len(xs)):
            if math.dist(xs[i], xs[i - 1]) < 1e-9:
                cur += 1
            else:
                runs.append(cur)
                cur = 1
        long_runs = [r for r in runs if r >= 3]
        self.assertGreater(len(long_runs), 20)
        self.assertGreaterEqual(min(long_runs) / 30, 0.1)  # fixations are 200-600 ms (minus saccade frames)
        self.assertLessEqual(max(long_runs) / 30, 0.62)

    def test_interpolation(self):
        tr = {"samples": [{"t": 0, "x": 0, "y": 0, "sigma": 1}, {"t": 1, "x": 1, "y": 0.5, "sigma": 3}]}
        self.assertEqual(traces.at(tr, 0.5), (0.5, 0.25, 2.0))
        self.assertEqual(traces.at(tr, 9)[0], 1)


class PipelineGates(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.dir = cls.tmp.name
        cls.clip = os.path.join(cls.dir, "src.mkv")
        pipeline.ffmpeg("-f", "lavfi", "-i", f"testsrc2=size={W}x{H}:rate=30:duration=2", "-c:v", "ffv1", cls.clip)
        cls.trace = traces.generate(5, N / 30, width=W, height=H, sigma_px=4)
        cls.ref = pipeline.make_reference(cls.clip, W, H, N, os.path.join(cls.dir, "ref.mkv"))

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def centres(self):
        return [pipeline.gaze_px(self.trace, k, W, H)[:2] for k in range(N)]

    def test_identical_input_gives_capped_psnr_and_unit_ssim(self):
        m = pipeline.measure(self.ref, self.ref, W, H, N, self.centres(), fovea.deg_to_px(5, W), self.dir)
        self.assertEqual(m["foveal_psnr"]["mean"], pipeline.PSNR_CAP)
        self.assertEqual(m["full_psnr"]["worst"], pipeline.PSNR_CAP)
        self.assertGreater(m["foveal_ssim"]["worst"], 0.9999)
        self.assertGreater(m["full_ssim"]["worst"], 0.9999)

    def test_disc_fraction_reported(self):
        m = pipeline.measure(self.ref, self.ref, W, H, N, [(160, 90)] * N, 50, self.dir)
        self.assertAlmostEqual(m["disc_area_frac_mean"], math.pi * 50 * 50 / (W * H), delta=0.01 * math.pi * 50 * 50 / (W * H))

    def test_glance_filter_keeps_fovea_exact_and_degrades_periphery(self):
        g = pipeline.glance_frames(self.ref, W, H, N, self.trace, os.path.join(self.dir, "g.mkv"))
        r = fovea.fovea_radius_px(W, 4.0)  # what the filter used (sigma 4 px)
        m = pipeline.measure(self.ref, g, W, H, N, self.centres(), r - 2, self.dir)
        self.assertEqual(m["foveal_psnr"]["worst"], pipeline.PSNR_CAP)  # untouched inside the radius
        self.assertLess(m["periph_psnr"]["mean"], 30.0)  # blurred outside (testsrc2 is detailed)
        self.assertGreater(m["periph_psnr"]["mean"], 10.0)

    def test_sanity_gate_radius_covering_frame_equals_baseline(self):
        diag = math.hypot(W, H)
        res = pipeline.condition(self.clip, W, H, N, 400, self.trace, os.path.join(self.dir, "c1"), ref=self.ref,
                                 glance_radius_override=3 * diag)
        self.assertEqual(res["baseline"]["frames_encoded"] + res["baseline"]["frames_dropped"], N)
        self.assertLess(abs(res["percent_saved"]), 0.5)  # baseline vs itself: 0 % saved (encoder is deterministic)
        self.assertAlmostEqual(res["baseline"]["full_psnr"]["mean"], res["glance"]["full_psnr"]["mean"], delta=0.01)
        self.assertTrue(res["synthetic_gaze"])

    def test_condition_reports_both_streams_and_target_flag(self):
        res = pipeline.condition(self.clip, W, H, N, 150, self.trace, os.path.join(self.dir, "c2"), ref=self.ref)
        for k in ("baseline", "glance"):
            s = res[k]
            self.assertGreater(s["kbps"], 0)
            self.assertEqual(s["frames_encoded"] + s["frames_dropped"], N)
            self.assertEqual(s["keyframes"] >= 1, True)
            self.assertLess(s["foveal_psnr"]["mean"], pipeline.PSNR_CAP)
        # the periphery of the Glance stream is far from the source, the baseline's is not
        self.assertLess(res["glance"]["periph_psnr"]["mean"], res["baseline"]["periph_psnr"]["mean"])


class ExperimentLogic(unittest.TestCase):
    """Experiments A/B on ffmpeg's testsrc2 (test content only; real-clip numbers come from run.py --ab)."""

    @classmethod
    def setUpClass(cls):
        import experiments
        cls.ex = experiments
        cls.tmp = tempfile.TemporaryDirectory()
        cls.clip = os.path.join(cls.tmp.name, "src.mkv")
        pipeline.ffmpeg("-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=2", "-c:v", "ffv1", cls.clip)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_experiment_b_rows_are_consistent(self):
        rows = self.ex.experiment_b(self.clip, 360, [200, 400], n=30, tmp=os.path.join(self.tmp.name, "b"))
        self.assertEqual([r["cap_kbps"] for r in rows], [200, 400])
        for r in rows:
            self.assertTrue(r["synthetic_gaze"])
            self.assertAlmostEqual(r["foveal_psnr_gain_db"], r["glance"]["foveal_psnr"]["mean"] - r["baseline"]["foveal_psnr"]["mean"], places=9)
            self.assertGreater(r["baseline"]["kbps"], 0)
            self.assertGreater(r["glance"]["kbps"], 0)

    def test_experiment_a_result_is_self_consistent(self):
        r = self.ex.experiment_a(self.clip, 360, n=30, base_kbps=400, tmp=os.path.join(self.tmp.name, "a"))
        self.assertEqual(r["reached"], r["glance"] is not None)
        self.assertLessEqual(len(r["probes"]), 1 + self.ex.BISECT_STEPS)
        if r["reached"]:
            self.assertGreaterEqual(r["glance"]["foveal_psnr"]["mean"], r["goal_foveal_psnr"])
            self.assertAlmostEqual(r["percent_saved"], 100 * (1 - r["glance"]["kbps"] / r["baseline"]["kbps"]), places=9)
        else:
            self.assertIsNone(r["percent_saved"])
            self.assertLess(r["probes"][0]["foveal_psnr"]["mean"], r["goal_foveal_psnr"])


if __name__ == "__main__":
    unittest.main()
