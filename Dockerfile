# --- web UI build stage (Vite/React → static assets, GO-21e-g) ---
# Its own package + lockfile; built to /web/dist and served by Nest at runtime.
FROM node:22-alpine AS web-build
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# --- build stage (toolchain only — not shipped) ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN npm run build \
    && npm prune --omit=dev \
    && mkdir -p /hf-cache      # writable weight-cache mountpoint for local embeddings (see runtime)

# --- runtime stage: distroless ---
# Minimal attack surface: only Node + the app, no shell, npm, or OS package
# manager → far fewer CVEs than a full node image, and runs as nonroot.
# Pin by digest before publishing for reproducibility.
FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Schema migrations applied by the runner (dist/database/migrate.js, RAG-46).
# Baked in so the deploy image is self-contained — the compose `migrate` service
# and a k8s Job/init-container (RAG-64) run it with no repo checkout.
COPY db/migrations ./db/migrations
# Built React chat UI served by main.ts (useStaticAssets → ../web/dist), same
# origin as the API (GO-21e-g / RAG-33). Baked in — no build step at runtime.
COPY --from=web-build /web/dist ./web/dist
# Local (transformers.js) embeddings cache their weights here — node_modules is
# read-only for the nonroot user. Owned by nonroot so a mounted named volume
# (docker-compose.local.yml) inherits writable ownership. Inert for the default
# Voyage/Anthropic image, which never loads a local model.
COPY --from=build --chown=65532:65532 /hf-cache /hf-cache
ENV TRANSFORMERS_CACHE=/hf-cache
EXPOSE 3000
# The distroless nodejs image's entrypoint is `node`; pass the script as its arg.
CMD ["dist/main.js"]
