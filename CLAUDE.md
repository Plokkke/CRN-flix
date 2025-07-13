# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CRN-Flix is a NestJS application that synchronizes media requests between Trakt.tv and Jellyfin media server. It manages user registrations, media synchronization, and automated ticket creation in ClickUp for administrative tasks.

## Key Development Commands

```bash
# Build and validation
npm run build                    # Build the application
npm run lint                     # Run ESLint
npm run lint:fix                 # Fix linting issues
npm run validate                 # Run lint + build + tests

# Testing
npm run test                     # Run unit tests
npm run test:unit                # Run unit tests explicitly
npm run test:cov                 # Run tests with coverage
npm run test:mut                 # Run mutation tests with Stryker

# Development
npm run start:dev                # Start in development mode with watch
npm run start:debug              # Start in debug mode
npm run start:local              # Start with local entry file
npm run start:prod               # Start production build
```

## Architecture Overview

### Core Domain Flow
1. **User Registration**: Users register via Discord/messaging → Admin approval → Jellyfin account creation
2. **Media Sync**: Trakt watchlists → Database → ClickUp tickets for missing media
3. **Status Updates**: Media availability changes → User notifications via email/Discord

### Key Components

**App Service (`src/app.service.ts`)**
- Main orchestrator that handles database events and coordinates all services
- Listens to PostgreSQL notifications for real-time updates
- Manages user approval workflow and sync scheduling

**Sync Service (`src/services/sync.ts`)**
- Core synchronization logic between Trakt and Jellyfin
- Handles media expansion (shows → episodes) and filtering
- Uses activity-based sync to minimize API calls

**Database Events (`src/services/database/requests.ts`)**
- PostgreSQL notification system for real-time updates
- Event types: request created/status changed, user joined/left
- Uses JSON payloads with Zod validation

**ClickUp Integration (`src/services/messaging/admin/clickup.ts`)**
- Primary ticket management system (Discord threads are legacy)
- Creates tasks for new media requests with custom fields
- Updates task status based on media availability

### External Integrations

**Trakt API (`src/modules/trakt/api.ts`)**
- OAuth device flow for user authentication
- Intelligent caching based on last activity timestamps
- Rate limiting with automatic retry

**Jellyfin API (`src/modules/jellyfin/jellyfin.ts`)**
- Media library scanning and user management
- Plugin configuration for Trakt integration

**Messaging System**
- User notifications: Email (primary) + Discord
- Admin notifications: Discord reactions for user approval
- ClickUp: Ticket creation and status updates

### Database Schema

Key tables:
- `users`: User accounts with messaging contexts
- `medias`: Media catalog with IMDB IDs
- `media_requests`: Request tracking with ClickUp task IDs
- `request_users`: Many-to-many user requests with reasons
- `user_activities`: Sync timestamps per request type

Note: `thread_id` column stores ClickUp task IDs (legacy naming from Discord)

### Configuration

Environment variables are validated through Zod schema in `src/environment.ts`. Key configurations:
- External service credentials (Trakt, Jellyfin, Discord, ClickUp, Email)
- Database connection
- Sync intervals and thresholds

### Request Lifecycle

1. User adds media to Trakt watchlist
2. Sync service detects changes via last activities API
3. Media requests created in database
4. ClickUp task created for admin tracking
5. Media status updated when available in Jellyfin
6. Users notified of status changes
7. ClickUp task status updated accordingly

### Cache Strategy

Memory-based caching with TTL for:
- Trakt API responses (keyed by activity timestamps)
- User settings and show details (24h TTL)
- Last activities (1min TTL for change detection)

### Testing Approach

- Unit tests with Jest
- Mutation testing with Stryker for quality assurance
- Test configuration in `test/jest-unit.js`
- Coverage reports in `reports/tests/unit/coverage/`

## Important Notes

- ClickUp is the primary ticket system; Discord thread references are legacy
- Sync is activity-based to minimize API calls to Trakt
- Database uses PostgreSQL NOTIFY/LISTEN for real-time events
- All external API calls have rate limiting and retry logic
- Media expansion (shows → episodes) includes aired episode filtering