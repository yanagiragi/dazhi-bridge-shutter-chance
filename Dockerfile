FROM node:24-bookworm-slim AS build

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public
COPY config ./config
COPY scripts/audit-callsigns.js ./scripts/audit-callsigns.js

FROM node:24-bookworm-slim

WORKDIR /app

COPY --from=build /app ./


ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/data/dazhi.sqlite
ENV TZ=Asia/Taipei

RUN mkdir -p /data && chown -R node:node /app /data
USER node

VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/server.js"]
