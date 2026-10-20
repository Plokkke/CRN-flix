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

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "dist/main.js"]
