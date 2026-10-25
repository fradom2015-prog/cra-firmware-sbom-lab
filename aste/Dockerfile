# Immagine unica: server API + web app sullo stesso dominio.
# Build: docker build --build-arg PUBLIC_URL=https://aste.example.com -t aste .

FROM node:22-bookworm-slim AS web
WORKDIR /app
COPY app/package.json app/package-lock.json ./
RUN npm ci
COPY app/ ./
ARG PUBLIC_URL=http://localhost:3000
ARG STRIPE_PUBLISHABLE_KEY=""
ENV EXPO_PUBLIC_API_URL=$PUBLIC_URL EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=$STRIPE_PUBLISHABLE_KEY
RUN npx expo export --platform web --output-dir /web

FROM node:22-bookworm-slim AS server
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json server/tsconfig.build.json ./
COPY server/src src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production WEB_DIR=/app/web UPLOAD_DIR=/data/uploads
WORKDIR /app
COPY --from=server /app/node_modules node_modules
COPY --from=server /app/dist dist
COPY server/migrations migrations
COPY server/package.json ./
COPY --from=web /web web
RUN mkdir -p /data/uploads && chown node:node /data/uploads
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/index.js"]
