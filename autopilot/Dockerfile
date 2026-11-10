# Claude Code + Google Chrome (for `npm run smoke`) + ffmpeg (synthetic test clips).
FROM node:24-bookworm
RUN npm install -g @anthropic-ai/claude-code playwright \
    && playwright install --with-deps chrome \
    && apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
# "node" is uid 1000, same as aaravmodi on the server; Claude Code never runs as root.
USER node
WORKDIR /work
