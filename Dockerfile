# ---- Stage 1: build frontend ----
FROM node:20-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/
RUN npm ci
COPY frontend/ frontend/
RUN npm run build --workspace frontend

# ---- Stage 2: build backend ----
FROM node:20-alpine AS api
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/
RUN npm ci
COPY backend/ backend/
RUN npm run build --workspace backend

# ---- Stage 3: runtime (production deps only) ----
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/
RUN npm ci --omit=dev
COPY --from=api /app/backend/dist backend/dist
COPY --from=web /app/frontend/dist frontend/dist
WORKDIR /app/backend
ENV PUBLIC_DIR=../frontend/dist
EXPOSE 4000
CMD ["node", "dist/index.js"]