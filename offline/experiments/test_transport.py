import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fovea  # noqa: E402
import transport  # noqa: E402


def seq(n=150, size=3000, key=60):
    return [(k, size, k % key == 0) for k in range(n)]


class TransportModel(unittest.TestCase):
    def test_no_loss_no_jitter_is_identity(self):
        shown, st = transport.simulate(seq(), 150, 0.0, 0, 1)
        self.assertEqual(shown, list(range(150)))
        self.assertEqual(st["frozen_frames"], 0)
        self.assertEqual(st["packets_lost"], 0)

    def test_total_loss_shows_nothing(self):
        shown, st = transport.simulate(seq(), 150, 1.0, 0, 1)
        self.assertTrue(all(s is None for s in shown))
        self.assertEqual(st["never_shown_frames"], 150)

    def test_loss_freezes_until_next_keyframe(self):
        # find a seed where exactly one non-key frame in the first GOP is lost and check the freeze length
        for seed in range(1, 400):
            shown, st = transport.simulate(seq(), 150, 0.01, 0, seed)
            lost_frames = [k for k in range(150) if shown[k] != k]
            if lost_frames and lost_frames[0] > 5 and lost_frames[0] < 55 and st["frames_with_loss"] == 1:
                first = lost_frames[0]
                self.assertEqual(lost_frames, list(range(first, 60)))   # frozen up to the keyframe at 60, then recovered
                self.assertTrue(all(shown[k] == first - 1 for k in range(first, 60)))  # keeps the last good frame
                self.assertEqual(shown[60:], list(range(60, 150)))
                return
        self.fail("no suitable seed found")

    def test_frame_loss_rate_matches_binomial(self):
        # 3 packets/frame, p = 2 %: P(frame has a loss) = 1-(0.98)^3. Count over many frames and seeds.
        p, packets, trials = 0.02, 3, 0
        lost = 0
        for seed in range(1, 41):
            _, st = transport.simulate(seq(150, 3600, key=10 ** 6), 150, p, 0, seed)
            lost += st["frames_with_loss"]
            trials += 150
        exp = 1 - (1 - p) ** packets
        sd = math.sqrt(exp * (1 - exp) / trials)
        self.assertLess(abs(lost / trials - exp), 3 * sd)

    def test_deterministic_and_same_draws_for_both_streams(self):
        a = transport.simulate(seq(), 150, 0.02, 100, 3)
        self.assertEqual(a, transport.simulate(seq(), 150, 0.02, 100, 3))
        # a stream with fewer packets per frame never loses a frame the bigger one kept: its draws are a prefix of the bigger one's
        small = transport.simulate(seq(150, 1200), 150, 0.05, 0, 5)[1]["frames_with_loss"]
        big = transport.simulate(seq(150, 6000), 150, 0.05, 0, 5)[1]["frames_with_loss"]
        self.assertLessEqual(small, big)

    def test_late_frames_dropped_only_with_jitter(self):
        _, st0 = transport.simulate(seq(150, 1000, key=10 ** 6), 150, 0.0, 0, 1)
        self.assertEqual(st0["frames_late"], 0)
        late = sum(transport.simulate(seq(150, 1000), 150, 0.0, 100, s)[1]["frames_late"] for s in range(1, 21))
        # delay half-normal sd 50 ms, buffer 100 ms: P(late) = P(|z| > 2) = 4.55 %
        self.assertAlmostEqual(late / (20 * 150), 0.0455, delta=0.012)


class TrackerNoise(unittest.TestCase):
    def test_mean_radial_error_matches_target(self):
        px = fovea.deg_to_px(4.0, 1280)
        errs = []
        for seed in range(1, 31):
            noise = transport.tracker_noise(seed, 300, px)
            errs += [math.hypot(dx, dy) for dx, dy in noise]
        self.assertAlmostEqual(sum(errs) / len(errs) / px, 1.0, delta=0.1)

    def test_zero_error_is_zero(self):
        self.assertTrue(all(d == (0.0, 0.0) for d in transport.tracker_noise(1, 10, 0.0)))

    def test_deterministic(self):
        self.assertEqual(transport.tracker_noise(3, 20, 50.0), transport.tracker_noise(3, 20, 50.0))


if __name__ == "__main__":
    unittest.main()
