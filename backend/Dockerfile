# The Linework API, from backend/: docker build -t linework-api . && docker run -p 8787:8787 --env-file .env linework-api
# Data is kept in Google Drive (see .env.example), so the container needs no volume.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
EXPOSE 8787
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "index.js"]
