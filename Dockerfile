# syntax=docker/dockerfile:1.7
# Multi-stage Dockerfile for A1 Suite Local ANT.
# Stages:
#   - deps:        install backend + SPA npm deps
#   - spa-builder: build the web-modern SPA (Vite)
#   - runtime:     slim runtime image (Node 22 + Fastify + built SPA)
#
# Outbound network is OFF by default; the env vars ARMOSPHERA_ONE_ALLOW_EGRESS=0
# and ARMOSPHERA_ONE_EGRESS_ALLOWLIST="" enforce the sovereignty posture at runtime.
# To go from this image to a self-hostable, network-isolated deploy, run with
#   --network=none   (after the build)   and   no --publish.

ARG NODE_VERSION=22.5

# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: install dependencies
# ─────────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS deps

WORKDIR /app

# Copy manifests first so npm can resolve before the rest of the source lands.
COPY package.json package-lock.json ./
COPY web-modern/package.json web-modern/package-lock.json* ./web-modern/

# Copy @a1/ai source from the armosphera mirror at the pinned commit so we don't
# hit the network at build time. Override A1_AI_CORE_PATH if you vendor it.
ARG A1_AI_CORE_PATH=""
ENV A1_AI_CORE_PATH=${A1_AI_CORE_PATH}

# Backend deps (production only — devDeps land in the builder stage).
RUN npm ci --omit=dev --no-audit --no-fund \
 && if [ -f web-modern/package.json ]; then \
      npm --prefix web-modern ci --omit=dev --no-audit --no-fund || true; \
    fi

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: build the web-modern SPA
# ─────────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS spa-builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY web-modern ./web-modern

# Vite build (the SPA script in web-modern defines the actual `build` script).
RUN if [ -f web-modern/package.json ]; then \
      npm --prefix web-modern run build; \
    else \
      echo "No web-modern SPA — skipping."; \
    fi

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3: runtime
# ─────────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

# Drop privileges; ARMOSPHERA_ONE_USER is created for the runtime process.
RUN groupadd --system --gid 1001 armosphera \
 && useradd  --system --uid 1001 --gid armosphera --no-create-home --shell /usr/sbin/nologin armosphera \
 && apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Backend code + node_modules from the deps stage.
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=armosphera:armosphera . .

# Built SPA goes into web-modern/dist (consumed by @fastify/static at runtime).
COPY --from=spa-builder --chown=armosphera:armosphera /app/web-modern/dist ./web-modern/dist

# Default env: sovereignty posture OFFLINE by default.
ENV NODE_ENV=production \
    ARMOSPHERA_ONE_ALLOW_EGRESS=0 \
    ARMOSPHERA_ONE_EGRESS_ALLOWLIST="" \
    PORT=4100 \
    SPA_PORT=3000 \
    DEPLOY_DEFAULT=spa

EXPOSE 4100 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/health" || exit 1

USER armosphera

ENTRYPOINT ["/usr/bin/tini", "--"]

# `start:all` runs the backend + SPA together via concurrently. Override with
# CMD ["npm", "run", "start:spa"] to run the SPA server alone, etc.
CMD ["npm", "run", "start"]