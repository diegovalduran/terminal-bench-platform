#!/bin/bash
# EC2 Production Setup Script for Terminal-Bench Platform
# This script sets up everything needed to run the worker service on EC2
# Run this once after launching your EC2 instance

set -e  # Exit on error

echo "=========================================="
echo "Terminal-Bench Platform - EC2 Setup"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
REPO_URL="https://github.com/diegovalduran/terminal-bench-platform.git"
PROJECT_DIR="$HOME/terminal-bench-platform"
HARBOR_VENV="$PROJECT_DIR/harbor/venv"
NODE_VERSION="20"

# Function to print status
print_status() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

# Check if running as root (we don't want that)
if [ "$EUID" -eq 0 ]; then 
    print_error "Please do not run this script as root. Run as a regular user (e.g., ubuntu)."
    exit 1
fi

echo "Step 1: Updating system packages..."
sudo apt-get update -qq
sudo apt-get upgrade -y -qq
print_status "System packages updated"

echo ""
echo "Step 2: Installing system dependencies..."
sudo apt-get install -y -qq \
    curl \
    git \
    build-essential \
    python3.12 \
    python3.12-venv \
    python3-pip \
    ca-certificates \
    gnupg \
    lsb-release \
    > /dev/null 2>&1
print_status "System dependencies installed"

echo ""
echo "Step 3: Installing Node.js ${NODE_VERSION}..."
if ! command -v node &> /dev/null || [ "$(node -v | cut -d'v' -f2 | cut -d'.' -f1)" != "$NODE_VERSION" ]; then
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash - > /dev/null 2>&1
    sudo apt-get install -y -qq nodejs > /dev/null 2>&1
    print_status "Node.js ${NODE_VERSION} installed"
else
    print_status "Node.js ${NODE_VERSION} already installed"
fi

# Verify Node.js installation
NODE_VER=$(node -v)
NPM_VER=$(npm -v)
echo "  Node.js version: $NODE_VER"
echo "  npm version: $NPM_VER"

echo ""
echo "Step 4: Installing Docker..."
if ! command -v docker &> /dev/null; then
    # Remove old versions
    sudo apt-get remove -y -qq docker docker-engine docker.io containerd runc 2>/dev/null || true
    
    # Add Docker's official GPG key
    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    sudo chmod a+r /etc/apt/keyrings/docker.gpg
    
    # Set up repository
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    
    # Install Docker
    sudo apt-get update -qq
    sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin > /dev/null 2>&1
    
    # Add current user to docker group (to run docker without sudo)
    sudo usermod -aG docker $USER
    print_status "Docker installed"
    print_warning "You may need to log out and back in for Docker group changes to take effect"
else
    print_status "Docker already installed"
fi

# Verify Docker installation
DOCKER_VER=$(docker --version)
echo "  Docker version: $DOCKER_VER"

echo ""
echo "Step 5: Installing PM2 globally..."
if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2 > /dev/null 2>&1
    print_status "PM2 installed"
else
    print_status "PM2 already installed"
fi

PM2_VER=$(pm2 -v)
echo "  PM2 version: $PM2_VER"

echo ""
echo "Step 6: Cloning/updating repository..."
if [ -d "$PROJECT_DIR" ]; then
    echo "  Repository exists, updating..."
    cd "$PROJECT_DIR"
    git fetch origin > /dev/null 2>&1 || print_warning "Could not fetch from origin (may not be a git repo)"
    print_status "Repository directory exists"
else
    echo "  Cloning repository..."
    git clone "$REPO_URL" "$PROJECT_DIR" > /dev/null 2>&1
    print_status "Repository cloned"
fi

cd "$PROJECT_DIR"

echo ""
echo "Step 7: Setting up Harbor (Python virtual environment)..."
if [ ! -d "$HARBOR_VENV" ]; then
    echo "  Creating Python virtual environment..."
    cd harbor
    python3.12 -m venv venv
    source venv/bin/activate
    
    echo "  Installing Harbor dependencies..."
    pip install --upgrade pip setuptools wheel > /dev/null 2>&1
    pip install -e . > /dev/null 2>&1
    
    deactivate
    print_status "Harbor installed in virtual environment"
else
    print_status "Harbor virtual environment already exists"
    cd harbor
    source venv/bin/activate
    # Update Harbor if needed
    pip install --upgrade pip setuptools wheel > /dev/null 2>&1
    pip install -e . > /dev/null 2>&1
    deactivate
    print_status "Harbor updated"
fi

# Verify Harbor installation
cd "$PROJECT_DIR/harbor"
source venv/bin/activate
HARBOR_VER=$(harbor --version 2>/dev/null || echo "installed")
deactivate
echo "  Harbor: $HARBOR_VER"

echo ""
echo "Step 8: Installing worker dependencies..."
cd "$PROJECT_DIR/worker"
if [ ! -d "node_modules" ]; then
    npm install > /dev/null 2>&1
    print_status "Worker dependencies installed"
else
    npm install > /dev/null 2>&1
    print_status "Worker dependencies updated"
fi

echo ""
echo "Step 9: Building worker..."
npm run build > /dev/null 2>&1
print_status "Worker built successfully"

echo ""
echo "Step 10: Creating environment file template..."
cd "$PROJECT_DIR/worker"
if [ ! -f ".env.local" ]; then
    cat > .env.local << 'EOF'
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

# Worker Configuration
WORKER_POLL_INTERVAL_MS=5000
MAX_CONCURRENT_ATTEMPTS_PER_JOB=10
ATTEMPT_STAGGER_DELAY_MS=2000
HARBOR_TIMEOUT_MS=1800000
EOF
    print_status "Environment file template created at worker/.env.local"
    print_warning "Please edit worker/.env.local and fill in your actual values"
else
    print_status "Environment file already exists"
    print_warning "Please verify worker/.env.local has all required values"
fi

echo ""
echo "Step 11: Creating logs directory..."
mkdir -p "$PROJECT_DIR/worker/logs"
print_status "Logs directory created"

echo ""
echo "Step 12: Setting up PM2 startup script..."
# Generate PM2 startup script
STARTUP_CMD=$(pm2 startup systemd -u $USER --hp $HOME 2>&1 | grep "sudo" || echo "")
if [ ! -z "$STARTUP_CMD" ]; then
    echo "  Run this command to enable PM2 on boot:"
    echo "  $STARTUP_CMD"
    print_warning "You need to run the PM2 startup command manually (shown above)"
else
    print_status "PM2 startup already configured"
fi

echo ""
echo "=========================================="
echo "Setup Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo ""
echo "1. Edit environment variables:"
echo "   nano $PROJECT_DIR/worker/.env.local"
echo ""
echo "2. Start the worker with PM2:"
echo "   cd $PROJECT_DIR/worker"
echo "   pm2 start ecosystem.config.js"
echo ""
echo "3. Enable PM2 on boot (run the command shown above):"
echo "   (This ensures the worker restarts if the server reboots)"
echo ""
echo "4. Monitor the worker:"
echo "   pm2 status              # Check status"
echo "   pm2 logs terminal-bench-worker  # View logs"
echo "   pm2 monit              # Monitor resources"
echo ""
echo "5. Useful PM2 commands:"
echo "   pm2 restart terminal-bench-worker  # Restart worker"
echo "   pm2 stop terminal-bench-worker     # Stop worker"
echo "   pm2 delete terminal-bench-worker   # Remove from PM2"
echo ""
echo "=========================================="

