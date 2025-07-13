# System Architecture

## Overview

CRN-Flix follows a **microservices-oriented monorepo architecture** with Infrastructure as Code, designed for scalability and maintainability.

## Component Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   External APIs │    │   Application   │    │   Data Layer    │
│                 │    │   Components    │    │                 │
├─────────────────┤    ├─────────────────┤    ├─────────────────┤
│ Trakt.tv        │◄──►│ API Component   │◄──►│ PostgreSQL      │
│ Jellyfin        │    │ (NestJS)        │    │                 │
│ ClickUp         │    │                 │    │ Migration       │
│ Email/Discord   │    │                 │    │ Component       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │
                       ┌─────────────────┐
                       │ Infrastructure  │
                       │ (Terraform)     │
                       └─────────────────┘
```

## Core Components

### API Component (`components/api/`)
**Responsibility**: Main application logic and external service orchestration

**Key Modules**:
- **App Service**: Central orchestrator handling database events and service coordination
- **Sync Service**: Trakt-Jellyfin synchronization with intelligent caching
- **Messaging Services**: User and admin notifications
- **External Modules**: Trakt API, Jellyfin API integrations

**Architecture Patterns**:
- Event-driven architecture with PostgreSQL NOTIFY/LISTEN
- Dependency injection via NestJS
- Repository pattern for data access
- Factory pattern for service instantiation

### Migration Component (`components/migration/`)
**Responsibility**: Database schema management and data migrations

**Features**:
- **SQL Migrations**: Versioned schema changes
- **Script Support**: JavaScript/Node.js migration scripts
- **Idempotent Operations**: Safe to re-run migrations
- **Rollback Support**: Automated rollback capabilities

### Infrastructure Component (`terraform/`)
**Responsibility**: Complete infrastructure definition and deployment

**Modules**:
- **API Module**: Application container and networking
- **Migration Module**: Database migration runner
- **Datasource Module**: PostgreSQL configuration and persistence

## Data Flow Architecture

### Request Lifecycle

```
1. User adds media to Trakt watchlist
2. Sync Service detects changes via activity polling
3. Media requests created/updated in database
4. Database events trigger downstream processes
5. Ticket creation in ClickUp for admin tracking
6. Media availability checked in Jellyfin
7. Status updates propagated to users
8. Ticket status synchronized with current state
```

### Event-Driven Processing

```
PostgreSQL NOTIFY/LISTEN
         │
         ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ Database Events │──►│ App Service     │──►│ Messaging       │
│                 │    │ Event Handlers  │    │ Services        │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

**Event Types**:
- Request created/updated
- User joined/left request
- Media availability changed
- User approval status changed

## External Service Integration

### Trakt.tv Integration
- **OAuth Device Flow**: Secure user authentication
- **Activity-Based Sync**: Efficient change detection
- **Rate Limiting**: Automatic throttling and retry logic
- **Caching Strategy**: Configurable TTL for API responses

### Jellyfin Integration
- **Media Library Scanning**: Availability detection
- **User Management**: Account creation and configuration
- **Plugin Integration**: Trakt sync plugin coordination

### ClickUp Integration
- **Ticket Management**: Automated task creation and updates
- **Custom Fields**: Rich metadata (IMDb IDs, seasons, episodes)
- **Status Synchronization**: Bidirectional status updates
- **Rate Limiting**: API quota management

### Messaging Integration
- **Email Notifications**: SMTP-based user communications
- **Discord Integration**: Optional admin notifications
- **Template System**: Configurable message templates

## Database Architecture

### Schema Design
```sql
-- Core entities
users              # User accounts and messaging contexts
medias             # Media catalog with external IDs
media_requests     # Request tracking with status
request_users      # Many-to-many user requests
user_activities    # Sync state management

-- Event system
NOTIFY/LISTEN      # Real-time event propagation
```

### Data Patterns
- **Normalized Schema**: Efficient storage and queries
- **Event Sourcing**: Database events for state changes
- **Optimistic Concurrency**: Safe concurrent operations
- **Bulk Operations**: Efficient batch processing

## Deployment Architecture

### Containerization Strategy
```
┌─────────────────────────────────────────────────────────┐
│                 Container Runtime                       │
│                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │ Migration   │  │ API         │  │ PostgreSQL  │     │
│  │ Container   │  │ Container   │  │ Container   │     │
│  │ (One-time)  │  │ (Long-run)  │  │ (Stateful)  │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
│                                                         │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              Container Network                      │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### Infrastructure as Code
- **Terraform Modules**: Reusable infrastructure components
- **Environment Separation**: Development/staging/production configs
- **State Management**: Remote state storage and locking
- **Dependency Management**: Proper resource ordering

## Performance Optimization

### Caching Strategy
- **Multi-layer Caching**: Memory and configurable external cache
- **Cache Invalidation**: TTL-based and event-driven expiration
- **Hit Rate Optimization**: Strategic cache key design

### Database Optimization
- **Query Optimization**: Proper indexing and query planning
- **Connection Pooling**: Efficient database connections
- **Bulk Operations**: Reduced query overhead
- **Event Processing**: Asynchronous event handling

### API Optimization
- **Rate Limiting**: Respect external API constraints
- **Request Batching**: Minimize API calls
- **Error Handling**: Exponential backoff and circuit breakers
- **Monitoring**: Performance metrics and alerting

## Security Architecture

### Container Security
- **Non-root Execution**: All containers run as unprivileged users
- **Resource Limits**: CPU and memory constraints
- **Network Isolation**: Secure inter-service communication
- **Image Security**: Regular base image updates

### Data Security
- **Encryption**: Sensitive data encryption at rest and in transit
- **Access Control**: Role-based access patterns
- **Secrets Management**: Secure configuration handling
- **Audit Logging**: Security event tracking

### Network Security
- **Internal Networks**: Isolated container communication
- **External Access**: Controlled public interface exposure
- **Authentication**: Secure API authentication mechanisms

## Monitoring & Observability

### Health Monitoring
- **Application Health**: HTTP endpoint monitoring
- **Database Health**: Connection and query performance
- **Service Dependencies**: External API availability

### Logging Strategy
- **Structured Logging**: JSON-formatted log entries
- **Log Aggregation**: Centralized log collection
- **Error Tracking**: Exception monitoring and alerting
- **Performance Logging**: Request/response timing

### Metrics Collection
- **Application Metrics**: Business logic performance
- **Infrastructure Metrics**: Resource utilization
- **External API Metrics**: Rate limiting and response times

## Scalability Considerations

### Current Limitations
- **Single Instance**: One application instance per environment
- **Database**: Single PostgreSQL instance
- **Processing**: Sequential request processing

### Scaling Strategies
- **Horizontal Scaling**: Multiple API instances with load balancing
- **Database Scaling**: Read replicas and connection pooling
- **Cache Scaling**: Distributed caching solutions
- **Queue Processing**: Asynchronous task processing

### Future Enhancements
- **Microservices Split**: Domain-specific service separation
- **Event Streaming**: Apache Kafka or similar for event processing
- **API Gateway**: Centralized API management and routing
- **Service Mesh**: Advanced service-to-service communication