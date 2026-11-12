#!/usr/bin/env bash
# Unattended build loop on the home server: one TASKS.md item per Claude run.
# Claude runs in a container with an explicit tool allowlist (no permission bypass):
# it can edit the repo, build, run the smoke test and commit. Only this script pushes,
# and only to the `autopilot` branch. See autopilot/README.md.
set -u
cd "$(dirname "$0")/.."
MAX_RUNS=${MAX_RUNS:-200}
# Research (web search/fetch) and subagents per docs/AGENT_TEAM.md; no push, no package installs.
# python3 = experiment harness (offline/experiments); curl only from media.xiph.org (test clips).
TOOLS='Read,Edit,Write,Glob,Grep,TodoWrite,WebSearch,WebFetch,Agent,Task,Bash(npm ci),Bash(npm test),Bash(npm run:*),Bash(git status:*),Bash(git diff:*),Bash(git log:*),Bash(git show:*),Bash(git add:*),Bash(git commit:*),Bash(git worktree:*),Bash(ffmpeg:*),Bash(ffprobe:*),Bash(python3:*),Bash(curl -fsSL https://media.xiph.org/:*),Bash(mkdir:*),Bash(ls:*)'
notify() { "$HOME/homelab/alerts/notify.sh" "$@" || true; }
compose() { docker compose -f autopilot/compose.yaml "$@"; }

rm -f STOP
git fetch -q origin
# `git switch`, not checkout: `checkout autopilot` matches the autopilot/ folder as a path.
git switch -q autopilot 2> /dev/null || git switch -q -c autopilot origin/main
if [ "$(git branch --show-current)" != autopilot ]; then
  notify 4 warning "Glance autopilot didn't start" "Couldn't switch to the autopilot branch."
  exit 1
fi
git merge -q --ff-only origin/autopilot 2> /dev/null  # edits pushed to the branch from the laptop
# Nothing below may stop the loop except STOP or ALL DONE (Aarav, 13 Nov): failures are logged and the loop goes on.
git merge -q --no-edit origin/main || { git merge --abort; echo "merge of main conflicted; continuing without it"; }
compose build -q || { echo "image build failed; continuing with the existing image"; notify 4 warning "Glance autopilot: image build failed" "Continuing with the old image."; }

# Keep work the agent left uncommitted (it is sometimes refused git, cause unknown): commit if smoke passes, else stash.
salvage() {
  [ -n "$(git status --porcelain)" ] || return 0
  if compose run --rm -T agent sh -c 'cd web && npm run smoke'; then
    git add -A && git commit -q -m "autopilot: work from run $run that the agent could not commit (smoke green)"
  else
    git stash push -q -u -m "run $run: uncommitted work, smoke failed"
  fi
}

run=0
while [ "$run" -lt "$MAX_RUNS" ]; do
  run=$((run + 1))
  if [ -e STOP ]; then notify 3 pause_button "Glance autopilot stopped" "Stopped by you after $((run - 1)) runs."; exit 0; fi
  git pull -q --rebase origin autopilot || git rebase --abort  # commits pushed from the laptop between runs
  before=$(git rev-parse HEAD)
  echo "=== run $run $(date '+%F %T') ==="
  timeout 3h docker compose -f autopilot/compose.yaml run --rm -T agent       claude -p "$(cat autopilot/PROMPT.md)" --allowedTools "$TOOLS"
  rc=$?
  salvage
  git push -q origin autopilot || echo "push failed; work stays in this clone, continuing"
  if [ "$rc" -ne 0 ]; then
    echo "claude exited $rc (usage limit, timeout or crash); waiting 30 min, this attempt is not counted"
    run=$((run - 1))
    sleep 1800
    continue
  fi
  if grep -q '^ALL DONE' autopilot/TASKS.md; then
    notify 3 checkered_flag "Glance autopilot finished" "Every task in TASKS.md is done or blocked. Merge the autopilot branch when you land."
    exit 0
  fi
  if [ "$(git rev-parse HEAD)" = "$before" ]; then
    echo "run $run changed nothing; waiting 10 min before the next run"
    notify 4 warning "Glance autopilot: empty run" "Run $run made no commit. Continuing."
    sleep 600
    continue
  fi
  notify 2 robot "Glance autopilot: run $run done" "$(git log --format='• %s' "$before"..HEAD | head -8)"
done
notify 3 hourglass "Glance autopilot hit its run limit" "$MAX_RUNS runs done. Start it again to continue."
