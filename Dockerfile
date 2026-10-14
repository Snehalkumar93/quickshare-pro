# QuickShare Pro V2 — Production Dockerfile
FROM node:22-alpine

WORKDIR /usr/src/app

# Install dependencies first for layer caching
COPY package*.json ./
RUN npm ci --only=production

# Copy application source code
COPY . .

# Create uploads directory and set permissions
RUN mkdir -p uploads && chown -R node:node /usr/src/app

USER node

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "server.js"]
