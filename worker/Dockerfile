# ============================================================================
# VAYLO AD RENDER WORKER
#
# This image is the answer to a hard constraint: Supabase Edge Functions cannot
# spawn subprocesses, so FFmpeg needs a real container. Everything here is in
# service of that one fact.
#
# Debian's `ffmpeg` does not always carry libx264 — the GPL-encumbered encoders
# live in libavcodec-extra. Without it, every render fails at the encode step
# with "Unknown encoder 'libx264'", which is a confusing way to discover a
# packaging detail, so both packages are installed deliberately and /health
# reports whether the encoder is actually present.
# ============================================================================
FROM node:22-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg \
      libavcodec-extra \
      fonts-dejavu-core \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# The worker's own manifest, then the shared engine it bundles.
COPY worker/package.json ./package.json
COPY worker/build.mjs ./build.mjs
COPY worker/server.mjs ./server.mjs
COPY supabase/functions/_shared/renderPlan.ts ./src/renderPlan.ts

RUN npm install --no-audit --no-fund \
 && node build.mjs \
 && npm prune --omit=dev

# Build-time proof that the toolchain is present, so a broken image never ships.
RUN ffmpeg -version | head -1 && ffprobe -version | head -1 && node --check server.mjs

ENV NODE_ENV=production \
    PORT=8080 \
    FONT_FILE=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf \
    MAX_CONCURRENCY=2

# Renders write to the OS temp dir, which is the only writable path.
USER node

EXPOSE 8080
CMD ["node", "server.mjs"]
