FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
FROM deps AS build
COPY . .
ARG SITE_NAME=CareerAtlas
ARG SITE_URL=http://localhost:3000
ARG BRAND_COLOR=#123d32
ENV NEXT_TELEMETRY_DISABLED=1 SITE_NAME=$SITE_NAME SITE_URL=$SITE_URL BRAND_COLOR=$BRAND_COLOR
RUN npm run build
FROM node:22-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node","server.js"]
FROM deps AS worker
COPY . .
ENV NODE_ENV=production
USER node
CMD ["npm","run","worker"]
