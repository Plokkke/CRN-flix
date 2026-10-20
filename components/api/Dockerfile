ARG NODE_VERSION=26

# Build stage (context = monorepo root)
# -----------
FROM node:${NODE_VERSION}-alpine AS build-stage

RUN npm install -g pnpm@12.5.1

WORKDIR /repo

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@crn-flix/api...
RUN pnpm deploy --filter=@crn-flix/api --prod --legacy /out

# Production stage
# -----------
FROM node:${NODE_VERSION}-alpine AS production-stage

RUN addgroup -g 1001 -S appgroup && \
    adduser -S runner -u 1001 -G appgroup

WORKDIR /app

COPY --from=build-stage /out/package.json ./
COPY --from=build-stage /out/node_modules ./node_modules
COPY --from=build-stage /repo/components/api/dist ./dist
COPY --from=build-stage /repo/components/api/src/assets ./assets

RUN chown -R runner:appgroup /app

USER runner

ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/health/readiness',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/main.js"]
