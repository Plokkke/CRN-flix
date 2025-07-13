# CI/CD Workflows & Configuration Guide

## Overview

CRN-Flix uses a multi-component CI/CD architecture with GitHub Actions, Google Cloud Platform integration, and Terraform Infrastructure as Code. This guide covers the complete setup and workflow management.

## 🏗️ Architecture Overview

### Component Structure
```
crn-flix/
├── components/
│   ├── api/         # NestJS application
│   ├── database/    # Prisma schema & migrations
│   └── ...          # Future components
├── terraform/       # Infrastructure as Code
├── scripts/         # Build & version management
└── .github/workflows/ # CI/CD workflows
```

### Workflow Types
- **validate.yml** - Component validation on PRs
- **release.yaml** - Semantic releases with component publishing
- **deploy.yml** - Multi-environment deployment with health checks

---

## 🔧 Complete Setup Guide

### 1. Google Cloud Platform Setup

#### 1.1 Create GCP Project
```bash
# Create project
gcloud projects create your-project-id

# Set default project
gcloud config set project your-project-id

# Enable required APIs
gcloud services enable secretmanager.googleapis.com
gcloud services enable storage.googleapis.com
gcloud services enable iam.googleapis.com
gcloud services enable artifactregistry.googleapis.com
```

#### 1.2 Create Service Account
```bash
# Create service account for GitHub Actions
gcloud iam service-accounts create github-actions \
  --display-name="GitHub Actions Service Account"

# Get service account email
SA_EMAIL=$(gcloud iam service-accounts list \
  --filter="displayName:GitHub Actions Service Account" \
  --format="value(email)")
```

#### 1.3 Setup Workload Identity Federation
```bash
# Create Workload Identity Pool
gcloud iam workload-identity-pools create github-pool \
  --location=global \
  --display-name="GitHub Actions Pool"

# Create Workload Identity Provider (replace YOUR_ORG/YOUR_REPO with your GitHub repository)
gcloud iam workload-identity-pools providers create-oidc github-provider \
  --location=global \
  --workload-identity-pool=github-pool \
  --display-name="GitHub Provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.actor=assertion.actor" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-condition="assertion.repository=='YOUR_ORG/YOUR_REPO'"

# Get pool and provider names
POOL_NAME=$(gcloud iam workload-identity-pools describe github-pool \
  --location=global --format="value(name)")
PROVIDER_NAME=$(gcloud iam workload-identity-pools providers describe github-provider \
  --location=global --workload-identity-pool=github-pool \
  --format="value(name)")
```

#### 1.4 Grant IAM Permissions
```bash
# Get the full pool path for the policy binding
PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format="value(projectNumber)")
POOL_PATH="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool"

# Allow GitHub to impersonate service account
gcloud iam service-accounts add-iam-policy-binding $SA_EMAIL \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/${POOL_PATH}/attribute.repository/YOUR_ORG/YOUR_REPO"

# Grant required permissions to service account
gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
  --member="serviceAccount:$SA_EMAIL" \
  --role=roles/secretmanager.secretAccessor

gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
  --member="serviceAccount:$SA_EMAIL" \
  --role=roles/storage.admin

gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
  --member="serviceAccount:$SA_EMAIL" \
  --role=roles/artifactregistry.writer
```

#### 1.5 Create Artifact Registry Repository
```bash
# Create Artifact Registry repository for Docker images
gcloud artifacts repositories create your-app-name \
  --repository-format=docker \
  --location=europe-west1 \
  --description="Application Docker images"

# Configure Docker authentication for Artifact Registry (for local development)
gcloud auth configure-docker europe-west1-docker.pkg.dev
```

#### 1.6 Create GCS Bucket for Terraform State
```bash
# Create bucket for Terraform state (must be globally unique)
gsutil mb gs://your-terraform-state-bucket

# Enable versioning
gsutil versioning set on gs://your-terraform-state-bucket
```

### 2. Secret Manager Configuration

#### 2.1 Create Environment-Specific Secrets

**Production Secret:**
```bash
# Create production config secret
gcloud secrets create your-app-production

# Add secret version with JSON config matching terraform/variables.tf
cat > production-config.json << EOF
{
  "docker_host": "ssh://deploy@production-server.com",
  "image_registry": "europe-west1-docker.pkg.dev/your-project-id/your-app-name",
  "slug": "your-app-prod",
  "service_name": "Your Application Production", 
  "server_url": "https://your-domain.com",
  "sync_interval_ms": 600000,
  "trakt_client_id": "your-trakt-client-id",
  "trakt_client_secret": "your-trakt-client-secret",
  "jellyfin_host": "https://your-jellyfin.com",
  "jellyfin_token": "your-jellyfin-api-token",
  "jellyfin_login": "AdminLogin",
  "jellyfin_password": "your-jellyfin-password",
  "discord_channel_id": "your-discord-channel-id", 
  "discord_bot_token": "your-discord-bot-token",
  "discord_admin_ids": "admin1,admin2,admin3",
  "gmail_email": "your-email@gmail.com",
  "gmail_password": "your-app-password",
  "clickup_api_token": "your-clickup-api-token",
  "clickup_team_id": "your-clickup-team-id",
  "clickup_list_id": "your-clickup-list-id",
  "database_password": "secure-production-password",
  "docker_ssh_key": "-----BEGIN OPENSSH PRIVATE KEY-----\n...your-deployment-ssh-key...\n-----END OPENSSH PRIVATE KEY-----"
}
EOF

gcloud secrets versions add your-app-production --data-file=production-config.json
rm production-config.json
```

### 3. GitHub Repository Configuration

#### 3.1 Automated Repository Variables Setup
Use GitHub CLI to configure repository variables automatically:

```bash
# Get your project information
PROJECT_ID=$(gcloud config get-value project)
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")

# Set GitHub repository variables using CLI
gh variable set WIF_PROVIDER --body "projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/providers/github-provider"
gh variable set WIF_SERVICE_ACCOUNT --body "github-actions@${PROJECT_ID}.iam.gserviceaccount.com"
gh variable set GCP_PROJECT_ID --body "$PROJECT_ID"
gh variable set TF_STATE_BUCKET --body "${PROJECT_ID}-terraform-state"

# Verify variables are set
gh variable list
```

**Alternative: Manual Configuration**  
If you prefer manual setup via GitHub UI (Settings → Secrets and variables → Actions → Variables):

```
WIF_PROVIDER: projects/YOUR_PROJECT_NUMBER/locations/global/workloadIdentityPools/github-pool/providers/github-provider
WIF_SERVICE_ACCOUNT: github-actions@your-project-id.iam.gserviceaccount.com  
GCP_PROJECT_ID: your-project-id
TF_STATE_BUCKET: your-project-id-terraform-state
```

#### 3.2 Repository Secrets Setup
The GitHub token is required for the release workflow to create draft branches:

```bash
# Set GitHub token for draft branch creation in release workflow
gh secret set X_GITHUB_TOKEN --body "ghp_your_github_token_for_releases"
```

**Token Permissions Required:**
- `repo` (Full control of private repositories)
- `workflow` (Update GitHub Action workflows)

### 4. SSH Key Setup for Deployment

#### 4.1 Generate Deployment SSH Key
```bash
# Generate SSH key for deployment
ssh-keygen -t ed25519 -f ~/.ssh/crn-flix-deploy -N ""

# Copy public key to target server
ssh-copy-id -i ~/.ssh/crn-flix-deploy.pub user@your-server.com
```

#### 4.2 Add Private Key to Secret Manager
Include the private key content in your environment secrets under `docker_ssh_key` (Terraform will handle SSH authentication to Docker daemon).

---

## 🔄 Workflow Details

### 1. Validation Workflow (`validate.yml`)

**Triggers:**
- Pull requests to `main`
- Manual dispatch

**Process:**
1. **Change Detection** - Identifies modified components
2. **Component Validation** - Matrix validation of changed components
3. **Infrastructure Validation** - Terraform validation if infrastructure changed
4. **Root Validation** - Meta-project validation if root files changed

**Features:**
- Conditional execution based on changes
- Docker builds with caching
- Linting and testing for Node.js components
- PR comment with validation results

### 2. Release Workflow (`release.yaml`)

**Triggers:**
- Push to `main` branch

**Process:**
1. **Change Detection** - Identifies components requiring release
2. **Semantic Release** - Creates version tags and changelogs
3. **Component Publishing** - Builds and tags Docker images
4. **Version Synchronization** - Updates all component versions
5. **Draft Branch Creation** - Creates next development iteration
6. **Deployment Trigger** - Automatically triggers deployment

**Features:**
- Hybrid versioning (global + component)
- Semantic versioning with conventional commits
- Multi-platform Docker builds (AMD64/ARM64)
- Automatic deployment triggering

### 3. Deployment Workflow (`deploy.yml`)

**Triggers:**
- Push to `main` branch (automatic)
- Manual dispatch with parameters

**Process:**
1. **Deployment Preparation** - Determines components, version, and environment
2. **Component Building** - Matrix builds of Docker images
3. **Infrastructure Deployment** - Terraform apply with environment config
4. **Health Checks** - Validates deployment success
5. **Summary Report** - Provides deployment status

**Features:**
- Multi-environment support (local/staging/production)
- Component-selective deployment
- GCP Secret Manager integration
- Remote Docker builds for ARM64 targets
- Comprehensive health monitoring

---

## 🎛️ Configuration Management

### Environment-Specific Configuration

**Local Development:**
- Uses Terraform variables file (`local.tfvars`) instead of GCP Secret Manager
- `docker_host = "unix:///var/run/docker.sock"` (Unix socket, no SSH)
- No `docker_ssh_key` needed

**Production/Staging:**
- Configuration stored in GCP Secret Manager follows Terraform input variable structure
- `docker_host = "ssh://user@host"` (SSH connection)
- `docker_ssh_key` required for authentication

### Version Management

**Global Version Sync:**
```bash
# Synchronize versions across components
npm run version:sync

# Check version consistency
npm run version:check

# Build specific components
npm run docker:build api database
```

**Component Versioning:**
- Global version in root `package.json`
- Component versions in `components/*/package.json`
- Version manifest in `terraform/versions.json`
- Automatic synchronization via scripts

---

## 🚀 Deployment Process

### Automatic Deployment (Production)

1. **Feature Development** → Create feature branch
2. **Pull Request** → Create PR to `main` → `validate.yml` runs validation
3. **Code Review & Merge** → PR merged to `main`
4. **Release Workflow** → `release.yaml` creates semantic release automatically
5. **Component Publishing** → Builds and tags Docker images
6. **Deployment Trigger** → `deploy.yml` automatically deploys to production
7. **Health Verification** → Validates deployment success

### Manual Deployment

```bash
# Trigger manual deployment via GitHub Actions
# Go to Actions → Deploy Components → Run workflow
# Select environment, version, and components
```

### Local Development Deployment

```bash
# Setup local environment
cd terraform
terraform init
terraform apply -var-file="local.tfvars"

# Cleanup
terraform destroy -var-file="local.tfvars"
```

---

## 🔍 Monitoring & Troubleshooting

### Infrastructure Health

**Terraform State:**
```bash
# Check Terraform state
terraform state list
terraform state show module.api.docker_container.api
```

### Common Issues

**Workload Identity Setup:**
```bash
# Verify WIF configuration
gcloud iam workload-identity-pools describe github-pool --location=global

# Test service account impersonation
gcloud auth login --brief --cred-file=<(gcloud iam service-accounts generate-access-token SA_EMAIL)
```

**Secret Manager Access:**
```bash
# Test secret access
gcloud secrets versions access latest --secret="crn-flix-production"

# List all secrets
gcloud secrets list
```

**Terraform State Issues:**
```bash
# Import existing resources
terraform import docker_container.api container-id

# Force unlock state
terraform force-unlock LOCK_ID
```

### Debug Mode

**Enable verbose logging:**
```bash
# Terraform debugging
export TF_LOG=DEBUG

# Docker debugging
export DOCKER_BUILDKIT_DEBUG=1
```

---

## 🔐 Security Best Practices

### Access Control
- Workload Identity Federation (no long-lived service account keys)
- Principle of least privilege for IAM roles
- Environment-specific secret isolation

### Secret Management
- All sensitive data in GCP Secret Manager
- Environment-specific secret separation
- Regular secret rotation
- No secrets in code or GitHub

### Infrastructure Security
- Terraform state in encrypted GCS bucket
- Infrastructure as Code for auditability

---

## 📈 Performance Optimization

### Build Performance
- Docker layer caching with GitHub Actions cache
- Parallel component builds via matrix strategy
- Conditional builds based on changes

### Deployment Performance
- Terraform plan caching
- Matrix-based parallel execution

---

## 🔄 Updates & Migrations

**Adding New Components:**
1. Create component in `components/` directory
2. Add `package.json` with proper naming (`@crn-flix/component-name`)
3. Create `Dockerfile` if needed
4. CI/CD automatically detects and includes in workflows

**Environment Changes:**
1. Update secret in Secret Manager
2. Trigger deployment via GitHub Actions
3. Verify changes via health checks

This guide provides a complete setup and operational reference for the CRN-Flix CI/CD system. The architecture is designed for scalability, security, and maintainability across multiple environments.