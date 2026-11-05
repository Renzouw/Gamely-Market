FROM node:22-slim
WORKDIR /app
COPY shared ./shared
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY server ./server
WORKDIR /app/server
ENV NODE_ENV=production DB_PATH=/data/gamely.db PORT=8787
VOLUME /data
EXPOSE 8787
CMD ["npx", "tsx", "src/index.ts"]
