#!/usr/bin/env bash
# Unattended build loop on the home server: one TASKS.md item per Claude run.
# Claude runs in a container with an explicit tool allowlist (no permission bypass):
# it can edit the repo, build, run the smoke test and commit. Only this script pushes,
# and only to the `autopilot` branch. See autopilot/README.md.
set -u
cd "$(dirname "$0")/.."
MAX_RUNS=${MAX_RUNS:-15}
TOOLS='Read,Edit,Write,Glob,Grep,Bash(npm ci),Bash(npm run build),Bash(npm run smoke),Bash(git status:*),Bash(git diff:*),Bash(git log:*),Bash(git add:*),Bash(git commit:*),Bash(ffmpeg:*)'
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
if ! git merge -q --no-edit origin/main; then  # picks up TASKS.md edits made on main
  git merge --abort
  notify 4 warning "Glance autopilot didn't start" "Merging main into the autopilot branch conflicted. Merge it on the laptop, push, start again."
  exit 1
fi
compose build -q || { notify 4 warning "Glance autopilot didn't start" "The agent image failed to build."; exit 1; }

for run in $(seq 1 "$MAX_RUNS"); do
  if [ -e STOP ]; then notify 3 pause_button "Glance autopilot stopped" "Stopped by you after $((run - 1)) runs."; exit 0; fi
  before=$(git rev-parse HEAD)
  echo "=== run $run $(date '+%F %T') ==="
  if ! timeout 3h docker compose -f autopilot/compose.yaml run --rm -T agent \
      claude -p "$(cat autopilot/PROMPT.md)" --allowedTools "$TOOLS"; then
    echo "claude exited non-zero (usage limit or crash); waiting 30 min"
    sleep 1800
    continue
  fi
  git push -q origin autopilot
  if [ "$(git rev-parse HEAD)" = "$before" ]; then
    notify 4 warning "Glance autopilot is stuck" "Run $run made no commit, so it stopped. Log: ~/projects/glance-autopilot/autopilot.log"
    exit 1
  fi
  notify 2 robot "Glance autopilot: run $run done" "$(git log --format='• %s' "$before"..HEAD | head -8)"
  if grep -q '^ALL DONE' autopilot/TASKS.md; then
    notify 3 checkered_flag "Glance autopilot finished" "Every task in TASKS.md is done or blocked. Merge the autopilot branch when you land."
    exit 0
  fi
done
notify 3 hourglass "Glance autopilot hit its run limit" "$MAX_RUNS runs done. Start it again to continue."
