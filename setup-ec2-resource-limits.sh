#!/bin/bash
# Setup system limits for high-concurrency Docker containers
# This is a safety net - test first, then apply if you see errors

echo "🔧 Configuring system resource limits for high concurrency..."

# Quick + dirty: Set for current session (immediate effect)
ulimit -n 65536 2>/dev/null || echo "⚠️  Could not set nofile limit (may need sudo)"
ulimit -u 32768 2>/dev/null || echo "⚠️  Could not set nproc limit (may need sudo)"

# More permanent: Update /etc/security/limits.conf
echo ""
echo "📝 Updating /etc/security/limits.conf (requires sudo)..."
echo "* soft nofile 65536" | sudo tee -a /etc/security/limits.conf > /dev/null
echo "* hard nofile 65536" | sudo tee -a /etc/security/limits.conf > /dev/null
echo "root soft nofile 65536" | sudo tee -a /etc/security/limits.conf > /dev/null
echo "root hard nofile 65536" | sudo tee -a /etc/security/limits.conf > /dev/null

echo "* soft nproc 32768" | sudo tee -a /etc/security/limits.conf > /dev/null
echo "* hard nproc 32768" | sudo tee -a /etc/security/limits.conf > /dev/null
echo "root soft nproc 32768" | sudo tee -a /etc/security/limits.conf > /dev/null
echo "root hard nproc 32768" | sudo tee -a /etc/security/limits.conf > /dev/null

echo ""
echo "✅ System limits updated in /etc/security/limits.conf"
echo ""
echo "⚠️  Note: These limits apply to new sessions. For current session, run:"
echo "   ulimit -n 65536"
echo "   ulimit -u 32768"
echo ""
echo "📋 Optional: For Docker daemon (if you see errors), create:"
echo "   /etc/systemd/system/docker.service.d/override.conf"
echo "   with:"
echo "   [Service]"
echo "   LimitNOFILE=65536"
echo "   LimitNPROC=32768"
echo ""
echo "   Then: sudo systemctl daemon-reload && sudo systemctl restart docker"

