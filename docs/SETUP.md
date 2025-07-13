# Setup Guide

## Prerequisites

### Development Environment
- **Node.js**: LTS version
- **Docker**: Container runtime with Docker Compose
- **Terraform**: Infrastructure management
- **Git**: Version control

### Target Environment
- **Container Runtime**: Docker-compatible environment
- **SSH Access**: Key-based authentication
- **Network**: Accessible for external service webhooks

## Configuration

### 1. Repository Setup

```bash
git clone <repository-url>
cd TraktSync
```

### 2. Environment Configuration

**Local Development**:
```bash
cp terraform/terraform.tfvars.example terraform/local.tfvars
# Edit local.tfvars with your configuration
```

**Production**:
Configure secrets in your CI/CD system or secrets management solution.

### 3. External Service Configuration

#### Trakt.tv API
1. Create application at Trakt.tv developer portal
2. Configure OAuth redirect URI: `<your-domain>/auth/trakt/callback`
3. Obtain Client ID and Client Secret

#### Jellyfin Server
1. Access admin dashboard
2. Generate API key in Dashboard → API Keys
3. Note server URL and authentication details

#### ClickUp Integration
1. Create application or use personal token
2. Obtain API token
3. Identify workspace and list IDs from ClickUp URLs

#### Email Configuration
**SMTP Setup**:
- Configure SMTP server details
- For Gmail: use app passwords with 2FA enabled

### 4. Infrastructure Variables

Configure these variables in your `.tfvars` file:

```hcl
# Infrastructure
docker_host = "unix:///var/run/docker.sock"
slug = "your-app-name"
service_name = "Your Service Name"

# Database
postgres_version = "15-alpine"
api_version = "latest"

# Application
server_url = "https://your-domain.com"
sync_interval_ms = 600000

# External APIs
trakt_client_id = "your-trakt-client-id"
trakt_client_secret = "your-trakt-client-secret"
jellyfin_host = "https://your-jellyfin-server"
jellyfin_token = "your-jellyfin-api-key"
# ... other API configurations
```

## Deployment

### Local Development

**Start Services**:
```bash
cd terraform
terraform init
terraform apply -var-file="local.tfvars"
```

**Verify Deployment**:
```bash
# Check application health
curl http://localhost:3000/health

# View logs
docker logs <app-container-name>
docker logs <db-container-name>
```

### Production Deployment

**Automated (Recommended)**:
1. Configure CI/CD secrets
2. Push to main branch
3. Monitor deployment pipeline

**Manual**:
```bash
# Build and push images
docker build -t your-registry/app:tag components/api/

# Apply infrastructure
cd terraform
terraform init
terraform apply -var-file="production.tfvars"
```

## Database Setup

### Initial Schema
Database migrations run automatically via the migration component.

**Manual Migration** (if needed):
```bash
# Connect to database container
docker exec -it <db-container> psql -U <username>

# Check migration status
SELECT * FROM schema_migrations;
```

### Backup & Restore
```bash
# Create backup
docker exec <db-container> pg_dump -U <username> <database> > backup.sql

# Restore backup
docker exec -i <db-container> psql -U <username> <database> < backup.sql
```

## Verification

### Application Health
```bash
# Health endpoint
curl http://your-domain/health

# Database connection
docker exec <app-container> npm run db:check
```

### External Integrations
1. **Trakt**: Test OAuth flow and API connectivity
2. **Jellyfin**: Verify media library access
3. **ClickUp**: Check task creation permissions
4. **Email**: Send test notification
5. **Discord**: Verify bot permissions (if enabled)

### End-to-End Testing
1. Register test user
2. Link Trakt account
3. Add media to Trakt watchlist
4. Verify synchronization
5. Check ticket creation
6. Confirm notifications

## Environment Management

### Development vs Production
- Use different external service accounts for isolation
- Configure appropriate logging levels
- Set resource limits for production
- Enable monitoring and alerting

### Security Configuration
- Use strong, unique passwords
- Enable SSH key authentication
- Configure firewall rules
- Set up SSL/TLS certificates
- Regular security updates

### Monitoring Setup
- Configure health checks
- Set up log aggregation
- Enable error tracking
- Monitor external API usage
- Set up alerting thresholds

## Troubleshooting

### Common Issues

**Database Connection**:
```bash
# Check database status
docker exec <db-container> pg_isready -U <username>

# View database logs
docker logs <db-container>
```

**External API Issues**:
```bash
# Check API credentials
curl -H "Authorization: Bearer <token>" <api-endpoint>

# Review rate limiting
grep "rate limit" <app-logs>
```

**Container Issues**:
```bash
# Container status
docker ps
docker inspect <container-name>

# Resource usage
docker stats

# Network connectivity
docker network ls
docker network inspect <network-name>
```

### Debug Commands

**Application Debugging**:
```bash
# Application logs
docker logs -f <app-container>

# Container shell access
docker exec -it <app-container> sh

# Environment check
docker exec <app-container> env
```

**Infrastructure Debugging**:
```bash
# Terraform state
terraform show
terraform refresh

# Resource inspection
terraform state list
terraform state show <resource>
```

## Performance Tuning

### Application Optimization
- Configure caching settings
- Adjust sync intervals
- Optimize database queries
- Set appropriate resource limits

### Infrastructure Optimization
- Container resource allocation
- Database configuration tuning
- Network optimization
- Storage performance

### Monitoring & Alerting
- Set up performance monitoring
- Configure error rate alerting
- Monitor external API usage
- Track resource utilization

## Maintenance

### Regular Tasks
- **Weekly**: Check logs, monitor performance
- **Monthly**: Update dependencies, review security
- **Quarterly**: Full system health check, backup verification

### Updates
- Application updates via CI/CD pipeline
- Infrastructure updates via Terraform
- Security patches and dependency updates
- External service API version updates

### Backup Strategy
- Automated database backups
- Configuration backup
- Log retention policies
- Disaster recovery procedures