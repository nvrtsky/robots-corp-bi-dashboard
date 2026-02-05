#!/bin/bash
# Deploy script for robots-bi.navrotsky.ru

set -e

VPS_USER="root"
VPS_HOST="79.174.77.28"
VPS_PATH="/var/www/robots-bi"

echo "🚀 Deploying to $VPS_HOST..."

# Sync files
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude 'deploy.sh' \
  ./ "$VPS_USER@$VPS_HOST:$VPS_PATH/"

# Install dependencies and restart
ssh "$VPS_USER@$VPS_HOST" << 'EOF'
  cd /var/www/robots-bi
  npm install --production
  pm2 reload ecosystem.config.js --env production || pm2 start ecosystem.config.js --env production
  pm2 save
EOF

echo "✅ Deploy complete!"
echo "🌐 Dashboard: http://robots-bi.navrotsky.ru"
