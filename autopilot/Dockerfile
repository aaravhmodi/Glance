# Claude Code + Google Chrome (for `npm run smoke`) + ffmpeg + Python for the experiment harness.
FROM node:24-bookworm
RUN npm install -g @anthropic-ai/claude-code playwright \
    && playwright install --with-deps chrome \
    && apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv python3-pip curl xz-utils \
    && rm -rf /var/lib/apt/lists/*
# Experiment harness (offline/experiments). Each optional layer may fail without breaking the image:
# the harness checks what is importable and skips that metric with a logged note.
RUN python3 -m venv /opt/venv \
    && (/opt/venv/bin/pip install --no-cache-dir numpy opencv-python-headless matplotlib || echo "WARN: core python packages failed")
RUN (/opt/venv/bin/pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
    && /opt/venv/bin/pip install --no-cache-dir pyfvvdp==1.2.2) || echo "WARN: pyfvvdp not installed (FovVideoVDP will be skipped)"
# Debian's ffmpeg has no libvmaf; a static build that has it goes first on PATH when the download works.
RUN ([ "$(uname -m)" = x86_64 ] \
    && curl -fsSL https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz -o /tmp/ff.tar.xz \
    && mkdir -p /opt/ffmpeg && tar -xJf /tmp/ff.tar.xz -C /opt/ffmpeg --strip-components=1 && rm /tmp/ff.tar.xz \
    && /opt/ffmpeg/bin/ffmpeg -hide_banner -filters | grep -q libvmaf) || (rm -rf /opt/ffmpeg; echo "WARN: no libvmaf ffmpeg (VMAF will be skipped)")
ENV PATH=/opt/ffmpeg/bin:/opt/venv/bin:$PATH
# "node" is uid 1000, same as aaravmodi on the server; Claude Code never runs as root.
USER node
WORKDIR /work
