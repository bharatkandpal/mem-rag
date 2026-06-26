# --- build stage (toolchain only — not shipped) ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN npm run build \
    && npm prune --omit=dev   # keep only production deps for the runtime copy

# --- runtime stage: distroless ---
# Minimal attack surface: only Node + the app, no shell, npm, or OS package
# manager → far fewer CVEs than a full node image, and runs as nonroot.
# Pin by digest before publishing for reproducibility.
FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 3000
# The distroless nodejs image's entrypoint is `node`; pass the script as its arg.
CMD ["dist/main.js"]
