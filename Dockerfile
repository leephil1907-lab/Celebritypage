# Takuya Kimura — Official Digital World (Express + SQLite, no external services)
#
#   docker build -t starto-site .
#   docker run -p 8080:8080 -p 8081:8081 \
#     -v "$PWD/data:/app/data" -v "$PWD/uploads:/app/uploads" starto-site
#
# Stage 1 resolves production dependencies (and compiles better-sqlite3 if the image has no
# prebuild for this platform). Stage 2 ships a slim runtime: no toolchain, no devDependencies,
# no client source — only what the server reads at request time.

FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# scripts stay ON: better-sqlite3's install step is what downloads (or compiles) the
# better_sqlite3.node binary — with --ignore-scripts the image builds fine and then dies at boot
RUN npm ci --omit=dev && npm cache clean --force

# assets are built from source into public/ (npm run build == node scripts/build.mjs)
COPY client ./client
COPY views ./views
COPY scripts ./scripts
COPY public ./public
RUN npm run build

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    ADMIN_PORT=8081 \
    DB_FILE=/app/data/celebrity.db
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/public ./public
COPY package.json ./
COPY server ./server
COPY views ./views
COPY scripts ./scripts

# content and uploads are state: mount them, and the image stays replaceable
RUN mkdir -p /app/data /app/uploads && chown -R node:node /app
USER node
EXPOSE 8080 8081
VOLUME ["/app/data", "/app/uploads"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# db.js creates the schema, seed.js fills it only when it is empty, then the app serves
CMD ["sh", "-c", "node server/db.js && node server/seed.js && exec node server/index.js"]
