FROM oven/bun:1.3.14-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

ENV HOST=0.0.0.0
ENV PORT=3002

EXPOSE 3002

CMD ["bun", "run", "src/index.ts"]
