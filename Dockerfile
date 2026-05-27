# =================================================================
# LearnRift — single-image monolith
# Builds frontend (Next.js) + installs backend (13 services run via tsx).
# `npm start` brings up backend services and Next.js together.
# =================================================================
FROM node:20-alpine AS base
WORKDIR /app

# Install only manifests first for cache-friendly installs
COPY package.json package-lock.json* ./
COPY frontend/package.json frontend/package-lock.json* ./frontend/
COPY backend/package.json backend/package-lock.json* ./backend/
COPY backend/api-gateway/package.json ./backend/api-gateway/
COPY backend/auth-service/package.json ./backend/auth-service/
COPY backend/user-service/package.json ./backend/user-service/
COPY backend/course-service/package.json ./backend/course-service/
COPY backend/enrollment-service/package.json ./backend/enrollment-service/
COPY backend/search-service/package.json ./backend/search-service/
COPY backend/payment-service/package.json ./backend/payment-service/
COPY backend/wallet-service/package.json ./backend/wallet-service/
COPY backend/payout-service/package.json ./backend/payout-service/
COPY backend/notification-service/package.json ./backend/notification-service/
COPY backend/support-service/package.json ./backend/support-service/
COPY backend/achievement-service/package.json ./backend/achievement-service/
COPY backend/analytics-service/package.json ./backend/analytics-service/
COPY backend/shared/package.json ./backend/shared/

# Root install triggers postinstall which installs frontend + backend
RUN npm install --no-audit --no-fund

# Copy the rest of the source
COPY . .

# Build the Next.js frontend
RUN npm run build

# Frontend (3000) + api-gateway (4000) are the two public-ish ports.
# Internal services bind 4001-4012 but only the gateway is meant to be reached externally.
EXPOSE 3000 4000

ENV NODE_ENV=production

CMD ["npm", "start"]
