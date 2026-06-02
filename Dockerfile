FROM oven/bun:1.3.14-alpine AS build

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
ENV MASTRA_STUDIO_PATH=/app/studio
ENV MASTRA_AUTO_DETECT_URL=true
ENV MASTRA_HIDE_CLOUD_CTA=true
WORKDIR /app

COPY --from=build /app/.mastra/output ./
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts/migrate.mjs ./migrate.mjs

EXPOSE 4111

CMD ["node", "index.mjs"]
