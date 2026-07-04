# ===== Stage 1: build native deps =====
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++ git
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

# ===== Stage 2: lean runtime =====
FROM node:20-alpine AS runtime
WORKDIR /app

# Runtime-only deps: ffmpeg for WhatsApp voice/audio, tini for PID 1
RUN apk add --no-cache ffmpeg tini

COPY --from=deps /app/node_modules ./node_modules
COPY . .

EXPOSE 3000
ENV NODE_ENV=production

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]