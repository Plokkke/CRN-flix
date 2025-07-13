# CRN-Flix Media Sync Platform

A modern media request synchronization system that connects Trakt.tv watchlists with Jellyfin media server, featuring automated ticket management and user notifications.

## 🏗️ Architecture

This project follows a **monorepo multi-component architecture** aligned with the infrastructure:

```
project-root/
├── components/           # Application components
│   ├── api/             # NestJS application
│   ├── migration/       # Database migration service
│   └── datasource/      # PostgreSQL configuration
├── terraform/           # Infrastructure as Code
├── scripts/             # Deployment and utility scripts
└── docs/               # Documentation
```

## 🚀 Quick Start

### Local Development

1. **Clone and setup**:
```bash
git clone <repository-url>
cd TraktSync
```

2. **Configure environment**:
```bash
cp terraform/terraform.tfvars.example terraform/local.tfvars
# Edit terraform/local.tfvars with your configuration
```

3. **Deploy locally**:
```bash
cd terraform
terraform init
terraform apply -var-file="local.tfvars"
```

### Production Deployment

Production deployment is handled via GitHub Actions with Infrastructure as Code, supporting various target environments.

## 🏛️ System Architecture

### Core Flow
```
Trakt.tv Watchlists → Sync Service → Database → Ticket System → User Notifications
                                        ↓
                                  Media Server → Status Updates
```

### Components

- **API Component**: NestJS application handling all business logic
- **Migration Component**: Database schema management with automated migrations
- **Infrastructure**: Complete infrastructure defined as code

### External Integrations
- **Trakt.tv**: Watchlist synchronization with OAuth authentication
- **Jellyfin**: Media server integration for availability checking
- **ClickUp**: Ticket management system
- **Email**: User notifications via SMTP
- **Discord**: Optional admin notifications

## 📊 Key Features

- **Real-time synchronization** from watchlists to media requests
- **Intelligent caching** with activity-based sync to minimize API calls
- **Automated ticket creation** for missing media
- **User notifications** via email with status updates
- **Admin notifications** for user approvals
- **Database events** using PostgreSQL NOTIFY/LISTEN for real-time updates

## 🛠️ Technology Stack

- **Backend**: NestJS (TypeScript)
- **Database**: PostgreSQL with automated migrations
- **Infrastructure**: Terraform + Docker
- **API Integration**: REST APIs for external services
- **Notifications**: Email (SMTP), Discord
- **Deployment**: GitHub Actions, containerized deployment

## 📚 Documentation

- [**Architecture Guide**](docs/ARCHITECTURE.md) - Detailed system architecture and component interactions
- [**Setup Guide**](docs/SETUP.md) - Step-by-step setup instructions
- [**Deployment Guide**](docs/DEPLOYMENT.md) - Deployment procedures and troubleshooting

## 🔧 Development

### Project Structure
```
components/api/          # Main NestJS application
├── src/
│   ├── controllers/     # HTTP controllers
│   ├── services/        # Business logic services
│   ├── modules/         # External API modules
│   ├── providers/       # Data providers and messaging
│   └── schemas.ts       # Database and validation schemas
├── Dockerfile          # Container configuration
└── package.json        # Dependencies and scripts

components/migration/    # Database migration service
├── sql/                # SQL migration files
└── Dockerfile          # Migration container

terraform/              # Infrastructure as Code
├── components/         # Terraform modules
│   ├── api/           # API service module
│   ├── migration/     # Migration service module
│   └── datasource/    # Database module
└── main.tf            # Main infrastructure definition
```

### Key Commands

**API Development**:
```bash
cd components/api
npm run start:dev        # Development mode
npm run test            # Run tests
npm run build           # Build for production
```

**Infrastructure**:
```bash
cd terraform
terraform plan -var-file="local.tfvars"     # Plan changes
terraform apply -var-file="local.tfvars"    # Apply changes
terraform destroy -var-file="local.tfvars"  # Cleanup
```

## 📈 Performance

The system is optimized for efficient operation:
- **Activity-based synchronization**: Only syncs when external activity changes
- **Intelligent caching**: Configurable TTL for external API responses
- **Optimized queries**: Uses bulk operations and proper indexing
- **Rate limiting**: Respects all external API limits

## 🔒 Security

- **Non-root containers**: All services run as non-privileged users
- **SSH key authentication**: Secure deployment mechanisms
- **Secrets management**: Secure configuration management
- **Network isolation**: Container networks for service communication

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes following the existing code structure
4. Test thoroughly
5. Submit a pull request

## 📄 License

[Add your license information here]

## 🆘 Support

- **Documentation**: Check the `docs/` directory
- **Issues**: Report bugs via GitHub Issues
- **Architecture Questions**: See [ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **Setup Problems**: See [SETUP.md](docs/SETUP.md)