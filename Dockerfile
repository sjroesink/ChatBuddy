FROM node:20-slim

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

RUN mkdir -p /app/data

ENV DATABASE_PATH=/app/data/bot.db

CMD ["node", "dist/index.js"]
