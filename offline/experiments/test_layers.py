"""Two-layer tests. Content is ffmpeg's synthetic testsrc2 and the gaze is synthetic: for tests only, never a result."""
import os
import random
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fovea  # noqa: E402
import layers  # noqa: E402
import pipeline  # noqa: E402
import traces  # noqa: E402

W, H, N, CELL, DEG = 320, 180, 30, 40, 5.0


class CropMaths(unittest.TestCase):
    def test_rect_inside_constant_snapped_contains_gaze(self):
        rng = random.Random(3)
        for (w, h, cell) in [(1280, 720, 160), (320, 180, 40), (1920, 1080, 160)]:
            r = fovea.deg_to_px(DEG, w)
            size = layers.crop_size(w, h, r, cell)
            for _ in range(500):
                gx, gy = rng.uniform(0, w), rng.uniform(0, h)
                x, y, cw, ch = layers.crop_rect(gx, gy, w, h, r, cell)
                self.assertEqual((cw, ch), size)
                self.assertTrue(0 <= x and x + cw <= w and 0 <= y and y + ch <= h)
                self.assertTrue(x <= gx <= x + cw and y <= gy <= y + ch)
                # the whole fovea disc (the part inside the frame) is inside the crop
                self.assertTrue(x <= max(0, gx - r) and min(w, gx + r) <= x + cw)
                self.assertTrue(y <= max(0, gy - r) and min(h, gy + r) <= y + ch)
                self.assertTrue(x % cell == 0 or x == w - cw)  # on the grid, or clamped to the far edge
                self.assertTrue(y % cell == 0 or y == h - ch)
                self.assertEqual((x % 2, y % 2, cw % 2, ch % 2), (0, 0, 0, 0))

    def test_rect_fixed_inside_a_cell(self):
        r = fovea.deg_to_px(DEG, 1280)  # ~216.7: gaze 537..696 all give floor((g - r) / 160) = 2
        self.assertEqual({layers.crop_rect(g, 360, 1280, 720, r, 160) for g in range(537, 697)}, {(320, 0, 640, 640)})

    def test_schedule_covers_every_frame_and_jumps_are_changes(self):
        tr = traces.generate(1, 3.0, width=1280, height=720)
        rects, jumps = layers.crop_schedule(tr, 1280, 720, 90, DEG, 160)
        self.assertEqual(len(rects), 90)
        self.assertEqual(jumps, [k for k in range(1, 90) if rects[k] != rects[k - 1]])
        self.assertGreater(len(jumps), 0)  # seed 1 moves the crop at least once
        self.assertEqual(rects, layers.crop_schedule(traces.generate(1, 3.0, width=1280, height=720), 1280, 720, 90, DEG, 160)[0])

    def test_cut_then_paste_is_identity(self):
        rng = random.Random(0)
        frame = bytes(rng.randrange(256) for _ in range(32 * 16 * 3 // 2))
        rect = (8, 4, 16, 8)
        blank = bytearray(len(frame))
        layers.paste(blank, 32, 16, layers.cut(frame, 32, 16, rect), rect)
        again = bytearray(frame)
        layers.paste(again, 32, 16, layers.cut(frame, 32, 16, rect), rect)
        self.assertEqual(bytes(again), frame)
        self.assertEqual(bytes(blank[8 * 32 + 8: 8 * 32 + 24]), frame[8 * 32 + 8: 8 * 32 + 24])
        self.assertEqual(blank[0], 0)


class Pipeline(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.ref = os.path.join(cls.tmp, "ref.mkv")
        pipeline.ffmpeg("-f", "lavfi", "-i", f"testsrc2=size={W}x{H}:rate=30", "-frames:v", str(N), "-pix_fmt", "yuv420p", "-c:v", "ffv1", cls.ref)
        cls.trace = traces.generate(5, N / 30, width=W, height=H, centre_bias=0.0)
        cls.ctx = layers.context(cls.ref, W, H, N, cls.trace, DEG, 1, cls.tmp, CELL)  # factor 1: a lossless full-size base

    def test_trace_moves_the_crop(self):
        self.assertGreater(len(self.ctx["jumps"]), 0)  # otherwise the alignment tests below prove little

    def test_lossless_layers_reproduce_reference(self):
        c = self.ctx
        comp = layers.composite(c["base_in"], c["crop_in"], W, H, N, c["rects"], os.path.join(self.tmp, "c1.mkv"), self.tmp)
        m = pipeline.measure(self.ref, comp, W, H, N, c["true_gaze"], c["r_meas"], self.tmp)
        self.assertEqual(m["full_psnr"]["worst"], pipeline.PSNR_CAP)
        self.assertEqual(m["foveal_psnr"]["worst"], pipeline.PSNR_CAP)

    def test_crop_alone_carries_the_fovea(self):
        # black base: the fovea disc is exact only if crop frame k was cut from source frame k and pasted at rects[k]
        c = self.ctx
        black = os.path.join(self.tmp, "black.mkv")
        pipeline.ffmpeg("-f", "lavfi", "-i", f"color=black:size={W}x{H}:rate=30", "-frames:v", str(N), "-pix_fmt", "yuv420p", "-c:v", "ffv1", black)
        comp = layers.composite(black, c["crop_in"], W, H, N, c["rects"], os.path.join(self.tmp, "c2.mkv"), self.tmp)
        m = pipeline.measure(self.ref, comp, W, H, N, c["true_gaze"], c["r_meas"], self.tmp)
        self.assertEqual(m["foveal_psnr"]["worst"], pipeline.PSNR_CAP)
        self.assertLess(m["periph_psnr"]["mean"], 20)
        # and a schedule shifted by one frame must NOT be exact (the check can fail)
        shifted = [c["rects"][0]] + c["rects"][:-1]
        comp = layers.composite(black, c["crop_in"], W, H, N, shifted, os.path.join(self.tmp, "c3.mkv"), self.tmp)
        m = pipeline.measure(self.ref, comp, W, H, N, c["true_gaze"], c["r_meas"], self.tmp)
        self.assertLess(m["foveal_psnr"]["worst"], 40)

    def test_forced_keyframes_land_on_jump_frames(self):
        c = self.ctx
        out = layers._encode(c["crop_in"], 300, os.path.join(self.tmp, "kf.webm"), layers._kf_args(c["jumps"]))
        pk = layers.packet_frames(out)
        keys = {k for k, key in pk if key}
        present = {k for k, _ in pk}
        self.assertEqual(keys, {0} | (set(c["jumps"]) & present))

    def test_total_bitrate_matches_baseline(self):
        c = self.ctx
        ctx = layers.context(self.ref, W, H, N, self.trace, DEG, 2, self.tmp, CELL)
        base = pipeline.stream_stats(pipeline.encode(self.ref, 300, os.path.join(self.tmp, "b.webm")), N)
        g = layers.two_layer(ctx, base["kbps"], 0.5)
        self.assertLessEqual(abs(g["kbps"] - base["kbps"]) / base["kbps"], layers.MATCH_TOL)
        self.assertTrue(g["budget_matched"])
        self.assertAlmostEqual(g["kbps"], g["base_kbps"] + g["fovea_kbps"], places=9)
        self.assertEqual(g["jumps"], len(c["jumps"]))


if __name__ == "__main__":
    unittest.main()
