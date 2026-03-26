ARG NODE_VERSION=lts

# Build stage
# -----------
FROM node:${NODE_VERSION}-alpine AS build-stage

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force

COPY src/ ./src/
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
RUN npm run build

# Production stage
# -----------
FROM node:${NODE_VERSION}-alpine AS production-stage

RUN addgroup -g 1001 -S appgroup && \ 
adduser -S runner -u 1001 -G appgroup

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build-stage /app/dist ./dist

RUN chown -R runner:appgroup /app

USER runner

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "dist/main.js"]
