# Containers stopped for the overnight run

Checked Fri 13 Nov 2026 ~01:00 Helsinki, on the laptop (Windows) where the run happens.

`docker ps` result: the Docker daemon is not running on this machine
(`failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`).

| Name | Image | ID |
|------|-------|----|
| (none running) | | |

**Nothing was stopped.** Containers on the home server (`glance-web-1` etc.) were not touched:
the brief forbids changing SSH/server config, and the `KEEP_RUNNING` list was left unfilled.

Restart command: none needed.

## Update: run moved to the home server
Aarav chose to continue the run with the server autopilot. That agent runs inside its own container
with no Docker access, so it cannot stop anything either. No container was stopped anywhere.
