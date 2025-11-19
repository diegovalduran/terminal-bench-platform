# Deployment Guide - EC2 Worker Service

This guide walks you through deploying the Terminal-Bench Platform worker service to an EC2 instance.

## Prerequisites

- AWS EC2 instance (recommended: x1e.8xlarge or larger for production)
- SSH access to the EC2 instance
- AWS credentials (for S3 access)
- Database connection string (Neon PostgreSQL)
- OpenAI API key (optional, for Terminus 2 agent)

## Quick Setup

### 1. Launch EC2 Instance

- **Instance Type**: x1e.8xlarge (32 vCPUs, 976 GB RAM) or larger
- **OS**: Ubuntu 22.04 LTS or later
- **Storage**: 100GB+ EBS volume
- **Security Group**: Allow SSH (port 22) from your IP

### 2. SSH into EC2

```bash
ssh -i your-key.pem ubuntu@your-ec2-ip
```

### 3. Run Setup Script

The setup script automates all installation steps:

```bash
# Clone the repository (if not already cloned)
git clone https://github.com/diegovalduran/terminal-bench-platform.git
cd terminal-bench-platform

# Make setup script executable
chmod +x setup-ec2.sh

# Run the setup script
./setup-ec2.sh
```

The script will:
- ✅ Update system packages
- ✅ Install Node.js 20
- ✅ Install Docker
- ✅ Install PM2
- ✅ Clone/update repository
- ✅ Set up Harbor in Python virtual environment
- ✅ Install worker dependencies
- ✅ Build the worker
- ✅ Create environment file template

**Note**: After Docker installation, you may need to log out and back in for Docker group changes to take effect.

### 4. Configure Environment Variables

Edit the environment file:

```bash
cd ~/terminal-bench-platform/worker
nano .env.local
```

Fill in the required values:

```bash
# Database Configuration
DATABASE_URL=postgresql://user:password@host:5432/database?sslmode=require

# S3 Configuration
S3_BUCKET=your-bucket-name
S3_REGION=us-west-2
S3_ACCESS_KEY_ID=your-access-key-id
S3_SECRET_ACCESS_KEY=your-secret-access-key

# OpenAI Configuration (Optional - for Terminus 2 agent)
OPENAI_API_KEY=your-openai-api-key
HARBOR_MODEL=gpt-5-mini

# Worker Configuration (Optional - all have defaults)
# WORKER_POLL_INTERVAL_MS=5000  # Default: 5000ms (5 seconds)
# MAX_CONCURRENT_ATTEMPTS_PER_JOB=10  # Default: 10 (or 5 for cheaper models)
# ATTEMPT_STAGGER_DELAY_MS=2000  # Default: 2000ms (2 seconds)
# HARBOR_TIMEOUT_MS=1800000  # Default: 1800000ms (30 minutes)
```

### 5. Start the Worker

```bash
cd ~/terminal-bench-platform/worker
pm2 start ecosystem.config.cjs
```

### 6. Enable PM2 on Boot

Run the command shown at the end of the setup script (it will look like):

```bash
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u ubuntu --hp /home/ubuntu
```

Then save the PM2 process list:

```bash
pm2 save
```

### 7. Verify Worker is Running

```bash
# Check status
pm2 status

# View logs
pm2 logs terminal-bench-worker

# Monitor resources
pm2 monit
```

## Manual Setup (Alternative)

If you prefer to set up manually or the script fails, follow these steps:

### 1. Install System Dependencies

```bash
sudo apt-get update
sudo apt-get install -y curl git build-essential python3.12 python3.12-venv python3-pip
```

### 2. Install Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 3. Install Docker

```bash
# Add Docker's official GPG key
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Set up repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Add user to docker group
sudo usermod -aG docker $USER
# Log out and back in for this to take effect
```

### 4. Install PM2

```bash
sudo npm install -g pm2
```

### 5. Clone Repository

```bash
cd ~
git clone https://github.com/diegovalduran/terminal-bench-platform.git
cd terminal-bench-platform
```

### 6. Set Up Harbor

```bash
cd harbor
python3.12 -m venv venv
source venv/bin/activate
pip install --upgrade pip setuptools wheel
pip install -e .
deactivate
```

### 7. Install Worker Dependencies

```bash
cd ~/terminal-bench-platform/worker
npm install
npm run build
```

### 8. Configure Environment

Create `worker/.env.local` with your configuration (see step 4 above).

### 9. Start Worker

```bash
cd ~/terminal-bench-platform/worker
pm2 start ecosystem.config.js
pm2 save
```

## Monitoring and Maintenance

### View Logs

```bash
# Real-time logs
pm2 logs terminal-bench-worker

# Last 100 lines
pm2 logs terminal-bench-worker --lines 100

# Error logs only
pm2 logs terminal-bench-worker --err
```

### Restart Worker

```bash
pm2 restart terminal-bench-worker
```

### Stop Worker

```bash
pm2 stop terminal-bench-worker
```

### Update Worker

```bash
cd ~/terminal-bench-platform
git pull
cd worker
npm install
npm run build
pm2 restart terminal-bench-worker
```

### Check Worker Status

```bash
pm2 status
pm2 monit
```

## Troubleshooting

### Worker Not Processing Jobs

1. Check if worker is running: `pm2 status`
2. Check logs: `pm2 logs terminal-bench-worker`
3. Verify database connection in logs
4. Verify environment variables are set correctly

### Docker Permission Denied

If you get "permission denied" errors with Docker:

```bash
# Add user to docker group (if not already done)
sudo usermod -aG docker $USER

# Log out and back in, or run:
newgrp docker

# Verify
docker ps
```

### Harbor Not Found

If `harbor` command is not found:

```bash
cd ~/terminal-bench-platform/harbor
source venv/bin/activate
harbor --version
```

Make sure you're in the virtual environment when running Harbor.

### High Memory Usage

If the worker uses too much memory:

1. Reduce `MAX_CONCURRENT_ATTEMPTS_PER_JOB` in `.env.local`
2. PM2 will auto-restart if memory exceeds 2GB (configured in `ecosystem.config.cjs`)

### Rate Limit Errors

If you see OpenAI rate limit errors:

1. Increase `ATTEMPT_STAGGER_DELAY_MS` (e.g., 5000ms = 5 seconds)
2. Reduce `MAX_CONCURRENT_ATTEMPTS_PER_JOB` (e.g., 3-5)
3. Consider upgrading OpenAI account tier

## Security Considerations

1. **Environment Variables**: Never commit `.env.local` to git
2. **SSH Keys**: Use key-based authentication, disable password auth
3. **Firewall**: Only allow SSH from trusted IPs
4. **S3 Credentials**: Use IAM roles instead of access keys when possible
5. **Database**: Use SSL connections (`sslmode=require`)

## Cost Optimization

For a 2-day trial:

- Use **spot instances** for significant cost savings (60-90% off)
- Use **x1e.8xlarge** spot instance: ~$0.75-1.00/hour = $36-48 for 48 hours
- Monitor usage and shut down when not needed

## Next Steps

After deployment:

1. Test with a simple job from the frontend
2. Monitor logs for any errors
3. Verify jobs are being processed
4. Check S3 for uploaded artifacts
5. Monitor EC2 instance metrics (CPU, memory, network)

