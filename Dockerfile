# syntax=docker/dockerfile:1
FROM node:22.22.1-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM dependencies AS builder
ENV NEXT_TELEMETRY_DISABLED=1 DESTINY_STANDALONE=true DESTINY_DATA_MODE=server
COPY . .
RUN npm run build

# Keep the one-shot migration image limited to the packages it executes.
FROM node:22.22.1-bookworm-slim AS migration-dependencies
WORKDIR /app
COPY migration/package.json migration/package-lock.json ./
RUN npm ci --no-audit --no-fund

# Migration is a separate explicit operation, never part of application startup.
FROM migration-dependencies AS migration
ENV NODE_ENV=production DESTINY_DATA_MODE=server
COPY src ./src
COPY tsconfig.json ./
COPY database ./database
COPY scripts ./scripts
USER node
CMD ["node", "scripts/cloud-init.mjs"]

FROM node:22.22.1-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0 DESTINY_DATA_MODE=server
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --chown=node:node scripts/cloud-entry.mjs scripts/cloud-validation.mjs ./
COPY --chown=node:node scripts/lib/error-log.mjs ./lib/error-log.mjs
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "cloud-entry.mjs"]
