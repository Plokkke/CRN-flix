FROM node:18-alpine

# Install PostgreSQL client for health checks
RUN apk add --no-cache postgresql-client

# Create non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S migrator -u 1001 -G appgroup

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy schema and migrations
COPY src/schema.prisma ./src/
COPY migrations/ ./migrations/

# Generate Prisma client
RUN npx prisma generate --schema=src/schema.prisma

# Copy migration runner
COPY src/ ./src/

# Change ownership
RUN chown -R migrator:appgroup /app

USER migrator

ENTRYPOINT ["npm", "run", "migrate"]