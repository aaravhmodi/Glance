#!/usr/bin/env bash
cd ~/projects/glance-autopilot
while ps -eo args | grep -qE "^(/usr/bin/)?bash autopilot/run.sh"; do sleep 15; done
git pull -q --rebase origin autopilot || { git rebase --abort; echo "RESYNC CONFLICT" >> autopilot.log; exit 1; }
git push -q origin autopilot
setsid nohup autopilot/run.sh >> autopilot.log 2>&1 < /dev/null &
