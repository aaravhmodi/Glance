You are working unattended on Glance, a hackathon project (foveated video encoding driven by webcam gaze), while its author is on a flight. Nobody can answer questions: decide sensibly and write down what you decided.

Read first: `MEMORY.md`, `docs/BUILD_PLAN.md`, `docs/results.md`, `autopilot/TASKS.md`, then the code in `web/`.

Do exactly ONE task per run: the first unchecked `- [ ]` item in `autopilot/TASKS.md`.

1. Build the smallest complete version of it that works. Follow the repo layout and notes in BUILD_PLAN.md. Chrome only. Gaze comes from the mouse for now (BUILD_PLAN R9).
2. Verify it:
   - `cd web && npm ci` if `web/node_modules` is missing.
   - `npm run build` must pass (TypeScript + Vite).
   - For anything that runs in the browser, extend `web/scripts/smoke.mjs` (headless Google Chrome via Playwright, fake webcam) so it checks the new feature, then `npm run smoke` must pass. Keep the `?smoke` page working.
3. Make small, real commits as you go (`git add` + `git commit` only). End every commit message with the line `Co-Authored-By: Claude (Glance autopilot) <noreply@anthropic.com>`.
4. When the task is done: tick it (`- [x]`) in TASKS.md, add 1–3 concise bullets for it to MEMORY.md under a heading for the current stage, put any numbers in docs/results.md, and commit.

If a task needs a human (a real webcam and eyes, a go/no-go decision, choosing or downloading video clips, credentials, a new npm package) do not fake it: move it to the "Blocked" section of TASKS.md with one line saying why, commit, and end the run.
If no unchecked task remains, add a final line `ALL DONE` to TASKS.md and commit.

Rules:
- Never read or print any `.env` file.
- Don't edit the root `Dockerfile`, `compose.yaml`, or anything in `autopilot/` except TASKS.md.
- Everything must keep working offline: no CDNs, no runtime network calls.
- Use only the dependencies already in `web/package.json`.
