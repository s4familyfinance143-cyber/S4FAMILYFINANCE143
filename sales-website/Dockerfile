FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder

WORKDIR /app

ARG NEXT_PUBLIC_API_BASE=http://localhost:8001/api
ARG NEXT_PUBLIC_LEGAL_BUSINESS_NAME=S4BUSINESSTHINKING
ARG NEXT_PUBLIC_LEGAL_REGISTERED_ADDRESS=Bangladesh
ARG NEXT_PUBLIC_LEGAL_JURISDICTION=Bangladesh
ARG NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE=2026-07-18
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_LEGAL_BUSINESS_NAME=$NEXT_PUBLIC_LEGAL_BUSINESS_NAME
ENV NEXT_PUBLIC_LEGAL_REGISTERED_ADDRESS=$NEXT_PUBLIC_LEGAL_REGISTERED_ADDRESS
ENV NEXT_PUBLIC_LEGAL_JURISDICTION=$NEXT_PUBLIC_LEGAL_JURISDICTION
ENV NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE=$NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000', r => process.exit(r.statusCode < 500 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["npm", "run", "start"]
