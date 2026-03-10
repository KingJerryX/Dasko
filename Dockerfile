# Dasko — Cloud Run (Node.js + TypeScript)
FROM node:20-bookworm-slim

WORKDIR /app

# Install deps (including dev for tsx)
COPY package.json package-lock.json ./
RUN npm ci

# App and frontend
COPY server.ts ./
COPY frontend ./frontend/

# Cloud Run sets PORT; server reads process.env.PORT
ENV NODE_ENV=production
EXPOSE 8000

CMD ["npm", "start"]
