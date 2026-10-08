# The Linework server with the app built in: docker build -t linework . && docker run -p 8787:8787 -v linework-data:/data linework
ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN NODE_OPTIONS=--max-old-space-size=4096 npm run build && npm prune --omit=dev

FROM ${NODE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production PORT=8787 DATABASE_PATH=/data/linework.db
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server ./server
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8787
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
