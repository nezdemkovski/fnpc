FROM node:22-alpine AS runtime

ENV NODE_ENV=production
ENV MASTRA_STUDIO_PATH=/app/studio
ENV MASTRA_AUTO_DETECT_URL=true
ENV MASTRA_HIDE_CLOUD_CTA=true
WORKDIR /app

COPY .mastra/output ./
COPY drizzle ./drizzle
COPY scripts/migrate.mjs ./migrate.mjs

EXPOSE 4111

CMD ["node", "index.mjs"]
