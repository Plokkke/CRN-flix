FROM node:18-alpine

# Install PostgreSQL client for health checks
RUN apk add --no-cache postgresql-client

# Create non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S migrator -u 1001 -G appgroup

# Set working directory
WORKDIR /app

COPY components/database/src/scripts/ ./src/scripts/
COPY components/database/src/migrate.js ./src/

# Change ownership
RUN chown -R migrator:appgroup /app

USER migrator

ENTRYPOINT ["node", "src/migrate.js"]
