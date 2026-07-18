#!/usr/bin/env bash
# One-shot setup for the ticket-sniper backend on a fresh Oracle Cloud
# Ubuntu 22.04/24.04 ARM (Ampere A1) Always Free VM.
# Run as: bash deploy-oracle.sh
set -e

echo "==> [1/7] System update + build deps"
sudo apt-get update -y
sudo apt-get install -y curl git ufw

echo "==> [2/7] Install Node.js 22 (ARM64)"
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "==> [3/7] Install Playwright system dependencies + Chromium"
cd "$HOME/ticket-sniper"
npm install --omit=dev
sudo npx playwright install-deps chromium
npx playwright install chromium

echo "==> [4/7] Open firewall for port 3000 (Oracle iptables + ufw)"
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3000 -j ACCEPT || true
sudo netfilter-persistent save 2>/dev/null || sudo apt-get install -y iptables-persistent
sudo ufw allow 3000/tcp 2>/dev/null || true

echo "==> [5/7] Install systemd service (auto-start on boot, auto-restart)"
sudo tee /etc/systemd/system/ticket-sniper.service > /dev/null << UNIT
[Unit]
Description=Ticket Sniper Backend
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$HOME/ticket-sniper
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
UNIT

echo "==> [6/7] Enable + start service"
sudo systemctl daemon-reload
sudo systemctl enable ticket-sniper
sudo systemctl restart ticket-sniper
sleep 5

echo "==> [7/7] Health check"
curl -s http://localhost:3000/api/health && echo "" && echo "BACKEND IS LIVE"
echo ""
echo "Public URL will be:  http://<YOUR_VM_PUBLIC_IP>:3000"
echo "Check logs with:     sudo journalctl -u ticket-sniper -f"
