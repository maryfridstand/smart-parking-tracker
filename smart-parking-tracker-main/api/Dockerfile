FROM node:22-alpine

WORKDIR /app

# Install dependencies first so this layer is cached when only code changes
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./

ENV NODE_ENV=production
EXPOSE 3000

# Don't run as root inside the container
USER node

CMD ["node", "server.js"]
