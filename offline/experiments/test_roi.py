"""ROI method tests. Content is ffmpeg's synthetic testsrc2 and the gaze is synthetic: for tests only, never reported as a result."""
import os
import re
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fovea  # noqa: E402
import pipeline  # noqa: E402
import roi  # noqa: E402
import traces  # noqa: E402

W, H, N, DEG, KBPS = 320, 180, 30, 5.0, 150


def two_fixations(w=W, h=H, n=N):
    """Gaze on the left for the first half of the frames, on the right for the second half."""
    return {"synthetic": True, "width": w, "height": h,
            "samples": [{"t": k / pipeline.FPS, "x": 0.25 if k < n // 2 else 0.75, "y": 0.5, "sigma": 0.0} for k in range(n)]}


class Graph(unittest.TestCase):
    def test_every_frame_exactly_once(self):
        for seed in (1, 2, 3):
            tr = traces.generate(seed, 3.0, width=1280, height=720)
            graph, regions = roi.roi_filter_graph(tr, 1280, 720, 90, DEG)
            self.assertEqual(len(regions), 90)
            covered = []
            for a, b in re.findall(r"between\(n,(\d+),(\d+)\)", graph):
                covered += range(int(a), int(b) + 1)
            self.assertEqual(sorted(covered), list(range(90)))
            branches = graph.count("select=")
            self.assertIn(f"split={branches}", graph)
            self.assertIn(f"interleave=nb_inputs={branches}[out]", graph)

    def test_regions_inside_frame_on_macroblock_grid_and_nested(self):
        for (w, h) in ((1280, 720), (1920, 1080), (W, H)):
            tr = traces.generate(5, 3.0, width=w, height=h, centre_bias=0.0)  # uniform targets: reaches the frame edges
            r = fovea.deg_to_px(DEG, w)
            _, regions = roi.roi_filter_graph(tr, w, h, 90, DEG, qoffsets=(-0.5, -0.3, -0.1))
            for k, reg in enumerate(regions):
                self.assertEqual(len(reg), 3)
                gx, gy = pipeline.gaze_px(tr, k, w, h)[:2]
                for i, (x, y, rw, rh, q) in enumerate(reg):
                    self.assertTrue(0 <= x < x + rw <= w and 0 <= y < y + rh <= h)
                    self.assertEqual((x % 16, y % 16), (0, 0))
                    self.assertTrue((x + rw) % 16 == 0 or x + rw == w)  # the frame edge itself may be off-grid (1080 rows)
                    self.assertTrue((y + rh) % 16 == 0 or y + rh == h)
                    if i:  # each ring contains the one before it, and is weaker
                        px, py, pw, ph, pq = reg[i - 1]
                        self.assertTrue(x <= px and y <= py and x + rw >= px + pw and y + rh >= py + ph)
                        self.assertGreater(q, pq)
                x, y, rw, rh, _ = reg[0]  # the inner square covers the fovea disc wherever the disc is inside the frame
                self.assertTrue(x <= max(0, gx - r) and x + rw >= min(w, gx + r) and y <= max(0, gy - r) and y + rh >= min(h, gy + r))

    def test_no_regions_means_no_graph(self):
        graph, regions = roi.roi_filter_graph(two_fixations(), W, H, N, DEG, qoffsets=())
        self.assertIsNone(graph)
        self.assertEqual(regions, [()] * N)


class Encode(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.TemporaryDirectory()
        cls.tmp = cls.dir.name
        cls.ref = os.path.join(cls.tmp, "ref.mkv")
        pipeline.ffmpeg("-f", "lavfi", "-i", f"testsrc2=size={W}x{H}:rate={pipeline.FPS}", "-vf", "format=yuv420p",
                        "-frames:v", str(N), "-c:v", "ffv1", cls.ref)
        cls.trace = two_fixations()
        cls.gaze = [pipeline.gaze_px(cls.trace, k, W, H)[:2] for k in range(N)]
        cls.r = fovea.deg_to_px(DEG, W)

    @classmethod
    def tearDownClass(cls):
        cls.dir.cleanup()

    def enc(self, name, kbps=KBPS, qoffsets=None):
        graph = roi.roi_filter_graph(self.trace, W, H, N, DEG, qoffsets)[0] if qoffsets else None
        out = roi.encode_h264(self.ref, kbps, os.path.join(self.tmp, name + ".mp4"), graph)
        return out, pipeline.stream_stats(out, N)

    def fov(self, path, centres=None):
        return pipeline.measure(self.ref, path, W, H, N, centres or self.gaze, self.r, self.tmp)["foveal_psnr"]["mean"]

    def test_zero_offset_equals_baseline(self):
        # the whole split/select/addroi/interleave path with qoffset 0 must be neutral: no frame lost, reordered or changed
        b, bs = self.enc("zb")
        z, zs = self.enc("zz", qoffsets=(0.0,))
        self.assertEqual(zs["frames_encoded"], N)
        self.assertEqual(bs["frames_encoded"], N)
        self.assertLess(abs(zs["kbps"] - bs["kbps"]) / bs["kbps"], 0.02)
        self.assertLess(abs(self.fov(z) - self.fov(b)), 0.05)

    def test_region_moves_with_the_gaze(self):
        # scored around the TRUE gaze (left then right) the ROI stream must beat the baseline, and by clearly more than
        # when scored around the mirrored gaze (right then left). A region that did not move would score the same both ways.
        b, _ = self.enc("mb")
        g, gs = self.enc("mg", qoffsets=(-0.5,))
        self.assertEqual(gs["frames_dropped"], 0)
        mirrored = [(W - x, y) for x, y in self.gaze]
        gain_true = self.fov(g) - self.fov(b)
        gain_mirrored = self.fov(g, mirrored) - self.fov(b, mirrored)
        print(f"\n[moving region] foveal gain at true gaze {gain_true:+.2f} dB, at mirrored gaze {gain_mirrored:+.2f} dB")
        self.assertGreater(gain_true, 1.0)
        self.assertGreater(gain_true - gain_mirrored, 1.5)

    def test_equal_achieved_bitrate_gain_is_recorded(self):
        # re-target the ROI stream until its ACHIEVED kbps is within 2 % of the baseline's, then compare foveal PSNR.
        # The gain is printed, not forced: only "not clearly worse" is asserted, since this is synthetic content.
        b, bs = self.enc("eb")
        t, best = KBPS, None
        for _ in range(roi.MATCH_STEPS):
            g, gs = self.enc("eg", kbps=t, qoffsets=roi.QOFFSETS)
            err = abs(gs["kbps"] - bs["kbps"]) / bs["kbps"]
            if best is None or err < best[0]:
                best = (err, self.fov(g), gs["kbps"])
            if err <= roi.MATCH_TOL:
                break
            t = t * bs["kbps"] / gs["kbps"]
        gain = best[1] - self.fov(b)
        print(f"\n[equal bitrate] baseline {bs['kbps']:.0f} kbps, ROI {best[2]:.0f} kbps (off by {100 * best[0]:.1f} %), foveal gain {gain:+.2f} dB")
        self.assertLess(best[0], 0.05)
        self.assertGreater(gain, -0.5)


if __name__ == "__main__":
    unittest.main()
