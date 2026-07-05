FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY apps/admin/package*.json ./apps/admin/
COPY apps/admin-ui/package*.json ./apps/admin-ui/
RUN npm ci

FROM deps AS build
COPY apps/admin ./apps/admin
COPY apps/admin-ui ./apps/admin-ui
RUN npm run build -w @codex-switch/admin-ui
RUN npm run build -w @codex-switch/backend

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY apps/admin/package*.json ./apps/admin/
RUN npm ci --omit=dev --workspace @codex-switch/backend --include-workspace-root --ignore-scripts
COPY --from=build /app/apps/admin/dist ./dist
COPY --from=build /app/apps/admin/public ./public
EXPOSE 8080
CMD ["node", "dist/main.js"]
