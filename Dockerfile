FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/app/data/crm.db
ENV UPLOAD_DIR=/app/uploads
WORKDIR /app

COPY package.json ./
COPY db.js server.js ./
COPY server ./server
COPY public ./public
COPY --chown=node:node scripts ./scripts
RUN mkdir -p /app/data /app/uploads && chown -R node:node /app/data /app/uploads

USER node
EXPOSE 3000
CMD ["node", "server.js"]
