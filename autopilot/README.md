# Autopilot

Keeps building Glance on the home server while you're offline. Each run, Claude Code (in a container, with a tool allowlist: edit repo, build, smoke test, commit) does the first unchecked item in `TASKS.md`. Then `run.sh` pushes to the `autopilot` branch and sends a push to your phone. Stops on `ALL DONE`, a run with no commit, `MAX_RUNS` (15), or a `STOP` file.

**One-time setup** (server, already done except the token):
```
# copy only the Claude token into the autopilot clone (you run this; I don't handle keys)
ssh aaravmodi@100.76.57.23 'grep ^CLAUDE_CODE_OAUTH_TOKEN= ~/homelab/claude-harness/.env > ~/projects/glance-autopilot/.env'
```

**Start** (before boarding, after pushing your TASKS.md edits to main):
```
ssh aaravmodi@100.76.57.23 'cd ~/projects/glance-autopilot && nohup autopilot/run.sh >> autopilot.log 2>&1 &'
```
**Stop:** `ssh aaravmodi@100.76.57.23 'touch ~/projects/glance-autopilot/STOP'` (finishes the current run first).
**Watch:** `ssh aaravmodi@100.76.57.23 'tail -f ~/projects/glance-autopilot/autopilot.log'`

**When you land:** `git fetch server && git log --oneline main..server/autopilot`, then `git merge server/autopilot` and `git push server main` (deploys).
