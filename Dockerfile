ARG NODE_VERSION=lts

# Build stage
# -----------
FROM node:${NODE_VERSION}-alpine AS build-stage

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY src/ ./src/
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
RUN npm run build

# Production stage
# -----------
FROM node:${NODE_VERSION}-alpine AS production-stage

WORKDIR /app

COPY package.json package-lock.json ./
COPY --from=build-stage /app/node_modules ./node_modules
COPY --from=build-stage /app/dist ./dist

ENV PORT=3000
EXPOSE 3000
ENTRYPOINT ["node", "dist/main.js"]
