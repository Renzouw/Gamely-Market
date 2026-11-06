FROM node:22-slim
WORKDIR /app
COPY shared ./shared
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci
COPY server ./server
WORKDIR /app/server
RUN npm run build && npm prune --omit=dev
ENV NODE_ENV=production DB_PATH=/data/gamely.db PORT=8787
VOLUME /data
EXPOSE 8787
CMD ["node", "--max-old-space-size=256", "--disable-warning=ExperimentalWarning", "dist/server.mjs"]
