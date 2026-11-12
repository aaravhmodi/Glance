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

## Update 2: Aarav asked for unrelated containers on the home server to be stopped (12 Nov 23:40 UTC)

Full `docker ps` on the server before stopping anything:

| Name | Image | ID | Action |
|------|-------|----|--------|
| glance-web-1 | glance-web | e3c70a12a127 | kept (deployed Glance site) |
| intern-agent-dashboard-1 | intern-agent-dashboard | 6cd47654164f | **stopped** |
| intern-agent-browser-1 | intern-agent-browser | 6582e0c826fb | **stopped** |
| uarb-agent-agent-1 | uarb-agent-agent | bb3c870a6d51 | **stopped** |
| uarb-agent-tunnel-1 | cloudflare/cloudflared:latest | 3f2c93e15beb | **stopped** |
| study-agent-dashboard-1 | study-agent-dashboard | c014f40e5f30 | **stopped** |
| study-agent-browser-1 | study-agent-browser | e925ecc48942 | **stopped** |
| enerzen-tunnel-1 | cloudflare/cloudflared:latest | e617dc756354 | kept (not on the list Aarav approved) |
| enerzen-web-1 | enerzen-web | e6bfd77ae4a1 | kept (same) |
| enerzen-api-1 | enerzen-api | e9f13c1432cc | kept (same) |
| home-dashboard-messages-1 | python:3.12-slim | c6a3a388a239 | kept (same) |
| home-dashboard-homepage-1 | ghcr.io/gethomepage/homepage:v2.5.0 | f6d8f39e024a | kept (same) |
| home-dashboard-docker-proxy-1 | ghcr.io/tecnativa/docker-socket-proxy:v0.5.0 | ee3250349a00 | kept (same) |
| n8n-n8n-1 | n8nio/n8n:2.42.6 | 98a89233a6cc | kept (same) |
| claude-harness-harness-1 | claude-harness-harness | 325683a15083 | kept (same) |
| monitoring-grafana-1 | grafana/grafana-oss:latest | 1c5a289f1183 | kept (same) |
| monitoring-container-stats-1 | docker:cli | d15f7b5495a9 | kept (same) |
| monitoring-blackbox-1 | prom/blackbox-exporter:latest | cd0f91ecefb7 | kept (same) |
| monitoring-node-exporter-1 | prom/node-exporter:latest | ec520d247404 | kept (same) |
| monitoring-prometheus-1 | prom/prometheus:latest | 59a8f4ea2748 | kept (same) |
| homelab-grafana-1 | grafana/grafana:latest | d2b710fbc6b6 | kept (same) |
| homelab-postgres-1 | postgres:16 | 4099804eea0f | kept (same) |
| homelab-redis-1 | redis:7-alpine | 3f441a849eef | kept (same) |
| homelab-uptime-kuma-1 | louislam/uptime-kuma:1 | e05fe75216a2 | kept (same) |
| cloudflared | cloudflare/cloudflared:latest | 989946d964f2 | kept (same) |

`docker stop` only; nothing removed. Restart them all:

```
ssh aaravmodi@100.76.57.23 'docker start intern-agent-dashboard-1 intern-agent-browser-1 uarb-agent-agent-1 uarb-agent-tunnel-1 study-agent-dashboard-1 study-agent-browser-1'
```
