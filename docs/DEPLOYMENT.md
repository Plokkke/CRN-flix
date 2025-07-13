# Deployment Guide

## Overview

Deployment is handled through **Infrastructure as Code** using Terraform, with automated CI/CD pipelines for production environments and local development support.

## Deployment Strategies

### Automated Deployment (Production)

**CI/CD Pipeline Flow**:
```
Git Push → CI/CD → Build → Test → Deploy → Verify
```

**Requirements**:
- CI/CD system configured with secrets
- Target environment accessible via SSH
- Container registry (if using remote images)

**Process**:
1. Configure deployment secrets
2. Push to deployment branch
3. Monitor pipeline execution
4. Verify deployment health

### Local Development

**Quick Start**:
```bash
cd terraform
terraform init
terraform apply -var-file="local.tfvars"
```

**Cleanup**:
```bash
terraform destroy -var-file="local.tfvars"
```

## Infrastructure Components

### Terraform Modules

**Core Modules**:
- **API Module**: Application container and networking
- **Migration Module**: Database schema management
- **Datasource Module**: PostgreSQL configuration

**Module Dependencies**:
```
Migration → Datasource → API
```

### Container Strategy

**Build Strategy**:
- **Local**: Build from source for development
- **Production**: Use pre-built images from registry

**Container Lifecycle**:
1. **Migration**: Runs once, updates database schema
2. **Database**: Long-running, stateful service
3. **API**: Long-running, stateless application

## Environment Configuration

### Required Secrets

**Infrastructure**:
- SSH credentials for target environment
- Container registry credentials (if applicable)

**Application**:
- External API credentials (Trakt, Jellyfin, ClickUp)
- SMTP configuration for notifications
- Database passwords (auto-generated or provided)

### Variable Management

**Development**:
```hcl
# local.tfvars
docker_host = "unix:///var/run/docker.sock"
slug = "dev-instance"
server_url = "http://localhost:3000"
# ... development-specific values
```

**Production**:
```hcl
# production.tfvars (managed via CI/CD)
slug = "production"
server_url = "https://your-domain.com"
# ... production values from secrets
```

## Deployment Process

### Pre-deployment Validation

**Infrastructure Validation**:
```bash
# Terraform validation
terraform validate
terraform plan -var-file="<environment>.tfvars"

# Docker validation
docker buildx ls  # Multi-platform support
docker info       # Runtime status
```

**Application Validation**:
```bash
# Run tests
cd components/api
npm test

# Build verification
docker build -t test-image .
```

### Deployment Execution

**Step-by-Step Process**:

1. **Infrastructure Preparation**:
```bash
terraform init
terraform plan -var-file="<environment>.tfvars" -out=deployment.tfplan
```

2. **Resource Deployment**:
```bash
terraform apply deployment.tfplan
```

3. **Health Verification**:
```bash
# Application health
curl http://<target>/health

# Database connectivity
docker exec <db-container> pg_isready
```

### Post-deployment Verification

**Automated Checks**:
- Application health endpoint response
- Database connectivity test
- External service integration validation
- Container resource utilization

**Manual Verification**:
- End-to-end workflow testing
- Log analysis for errors
- Performance baseline establishment

## Multi-Environment Management

### Environment Separation

**Development**:
- Local Docker environment
- Test external service accounts
- Reduced resource allocation
- Verbose logging enabled

**Staging**:
- Production-like infrastructure
- Staging external service accounts
- Production resource allocation
- Production-level logging

**Production**:
- Full production infrastructure
- Production external service accounts
- Optimized resource allocation
- Structured logging with aggregation

### Configuration Management

**Terraform Workspaces**:
```bash
# Create environment-specific workspaces
terraform workspace new development
terraform workspace new staging
terraform workspace new production

# Switch between environments
terraform workspace select production
```

**Variable Files**:
- `local.tfvars` - Local development
- `staging.tfvars` - Staging environment
- `production.tfvars` - Production environment

## Monitoring & Alerting

### Deployment Monitoring

**Real-time Monitoring**:
- Container health status
- Application performance metrics
- External API connectivity
- Database performance

**Alert Configuration**:
- Deployment failure notifications
- Health check failures
- Resource utilization thresholds
- External service unavailability

### Log Management

**Log Aggregation**:
- Centralized log collection
- Structured log formatting
- Error pattern detection
- Performance metric extraction

**Log Retention**:
- Development: Short-term retention
- Production: Long-term retention with archival

## Rollback Procedures

### Automated Rollback

**Trigger Conditions**:
- Health check failures
- Critical error rate thresholds
- External service integration failures

**Rollback Process**:
1. Identify last known good state
2. Execute Terraform rollback
3. Verify system stability
4. Investigate failure cause

### Manual Rollback

**Emergency Procedures**:
```bash
# Quick rollback to previous Terraform state
terraform apply -var-file="<environment>.tfvars" -target=<previous-resource>

# Container-level rollback
docker service update --rollback <service-name>
```

## Security Considerations

### Deployment Security

**Access Control**:
- SSH key-based authentication
- Principle of least privilege
- Audit logging for all deployments

**Secret Management**:
- Encrypted secret storage
- Secret rotation procedures
- Environment-specific secrets

**Network Security**:
- Isolated deployment networks
- Firewall configuration
- TLS/SSL certificate management

### Container Security

**Image Security**:
- Base image vulnerability scanning
- Regular security updates
- Minimal container surface area

**Runtime Security**:
- Non-root container execution
- Resource limits and constraints
- Security context configuration

## Troubleshooting

### Common Deployment Issues

**Infrastructure Issues**:
```bash
# SSH connectivity
ssh -i <key> user@target "docker info"

# Terraform state conflicts
terraform force-unlock <lock-id>

# Resource conflicts
terraform import <resource-type>.<name> <resource-id>
```

**Application Issues**:
```bash
# Container startup failures
docker logs <container-name>

# Database connectivity
docker exec <app-container> pg_isready -h <db-host>

# External API connectivity
docker exec <app-container> curl -I <api-endpoint>
```

### Debug Procedures

**Infrastructure Debugging**:
```bash
# Terraform debugging
export TF_LOG=DEBUG
terraform apply

# Resource inspection
terraform state show <resource>
terraform refresh
```

**Application Debugging**:
```bash
# Container inspection
docker inspect <container-name>
docker exec -it <container-name> sh

# Network debugging
docker network inspect <network-name>
ping <service-name>
```

## Performance Optimization

### Deployment Performance

**Build Optimization**:
- Multi-stage Docker builds
- Build cache utilization
- Parallel build processes

**Transfer Optimization**:
- Image layer optimization
- Registry proximity
- Incremental deployments

### Runtime Performance

**Resource Allocation**:
- CPU and memory limits
- Storage performance optimization
- Network bandwidth allocation

**Scaling Configuration**:
- Horizontal scaling parameters
- Load balancing configuration
- Auto-scaling thresholds

## Maintenance Procedures

### Regular Maintenance

**Weekly Tasks**:
- Deployment pipeline health check
- Security patch review
- Performance metric analysis

**Monthly Tasks**:
- Infrastructure cost optimization
- Security audit and compliance check
- Disaster recovery testing

**Quarterly Tasks**:
- Full system architecture review
- Capacity planning assessment
- Technology stack evaluation

### Update Procedures

**Application Updates**:
- Automated via CI/CD pipeline
- Blue-green deployment strategy
- Canary deployment for major changes

**Infrastructure Updates**:
- Terraform version management
- Provider version updates
- Infrastructure drift detection