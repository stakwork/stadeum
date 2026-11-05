# stadeum-ui: Next.js standalone server on :3000, SQLite in /data.
FROM node:20-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build

FROM base AS run
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 \
    DATABASE_URL=file:/data/stadeum.db
RUN groupadd -r stadeum && useradd -r -g stadeum stadeum && mkdir -p /data && chown stadeum:stadeum /data
COPY --from=build --chown=stadeum:stadeum /app/.next/standalone ./
COPY --from=build --chown=stadeum:stadeum /app/.next/static ./.next/static
COPY --from=build --chown=stadeum:stadeum /app/public ./public
COPY --from=build --chown=stadeum:stadeum /app/prisma ./prisma
# The Prisma CLI applies migrations on start. Standalone output doesn't carry
# it, so it gets its own prefix, pinned to the version in package-lock.json.
RUN npm install --prefix /opt/prisma --no-save --omit=dev prisma@6.19.3 && npm cache clean --force
USER stadeum
VOLUME /data
EXPOSE 3000
CMD ["sh", "-c", "/opt/prisma/node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma && node server.js"]
