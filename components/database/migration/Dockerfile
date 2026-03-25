FROM node:18-alpine

# Install PostgreSQL client for health checks
RUN apk add --no-cache postgresql-client

# Create non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S migrator -u 1001 -G appgroup

# Set working directory
WORKDIR /app

# Copy package files
COPY components/database/migration/package.json ./
RUN npm install && npm cache clean --force

# Copy schema and scripts from database component
COPY components/database/src/schema.prisma ./src/
COPY components/database/src/scripts/ ./src/scripts/
COPY components/database/src/migrate.js ./src/

# Generate Prisma client
RUN npx prisma generate --schema=src/schema.prisma

# Change ownership
RUN chown -R migrator:appgroup /app

USER migrator

ENTRYPOINT ["node", "src/migrate.js"]
