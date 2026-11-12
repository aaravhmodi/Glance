# Questions for Aarav

Decisions taken in the meantime are in brackets; all are reversible.

1. **Gaze traces for the experiments.** None recorded by a person exist. [Seeded synthetic fixation/saccade
   traces, labelled synthetic. Record a real one with key `E` in the app once T10 lands and re-run
   `python3 offline/experiments/run.py --all --trace <file>`.]
2. **Physical screen width.** The fovea radius in pixels depends on it. [60 cm distance, 31 cm-wide view,
   the existing defaults; set `?screencm=` and `?dist=` for the venue monitor.]
3. **Gaze accuracy number.** Only you can measure it (press C, then T). The tracker-error experiment assumes 2°.
4. **Stability fix from 12 Nov** (linear calibration model, stronger smoothing) is still unconfirmed by you.
