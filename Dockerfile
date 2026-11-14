# syntax=docker/dockerfile:1
# Node 20 is end-of-life; use the current LTS. For reproducible builds pin by digest:
#   docker buildx imagetools inspect node:22-alpine  ->  FROM node:22-alpine@sha256:<digest>
FROM node:22-alpine

ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
WORKDIR /app

# Only what the app needs (no .git, .env, tests or docs in the image); owned by root, read-only to the app user
COPY --chown=root:root package.json server.js ./
COPY --chown=root:root public ./public

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||8080,path:'/healthz',timeout:2000},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
