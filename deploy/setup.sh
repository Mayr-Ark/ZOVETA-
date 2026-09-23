#!/usr/bin/env bash
# Zeveto bot — one-shot setup for a fresh Ubuntu 22.04/24.04 ARM VM (Oracle Always Free).
# Run as root ON the server, with the zeveto-<date>.tar.gz uploaded next to this script:
#   bash setup.sh zeveto-<date>.tar.gz
set -euo pipefail

TARBALL="${1:?Usage: bash setup.sh zeveto-<date>.tar.gz}"
APP_DIR=/opt/zeveto
SERVICE_USER=zeveto

[[ $EUID -eq 0 ]] || { echo "run as root (sudo bash setup.sh ...)"; exit 1; }
[[ -f "$TARBALL" ]] || { echo "tarball not found: $TARBALL"; exit 1; }

echo "==> base packages"
apt-get update -qq
apt-get install -y -qq curl ca-certificates ufw

echo "==> Node 22 (ARM64)"
if ! command -v node >/dev/null || [[ "$(node -v | cut -c2- | cut -d. -f1)" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
node -v

echo "==> app user + directory"
id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$SERVICE_USER"
mkdir -p "$APP_DIR"
tar -xzf "$TARBALL" -C "$APP_DIR" --strip-components=1
mkdir -p "$APP_DIR/auth"
cd "$APP_DIR"
npm ci --omit=dev

echo "==> env file"
if [[ ! -f "$APP_DIR/.env" ]]; then
  cp "$APP_DIR/deploy/env.example" "$APP_DIR/.env"
  echo "  >>> NOW EDIT $APP_DIR/.env (real keys), then: chmod 600 $APP_DIR/.env"
fi

echo "==> systemd service"
cp "$APP_DIR/deploy/zeveto.service" /etc/systemd/system/zeveto.service
systemctl daemon-reload
systemctl enable zeveto

echo "==> firewall (SSH + bot port only)"
ufw allow OpenSSH
ufw allow 8080/tcp
ufw --force enable

echo "==> fix ownership"
chown -R "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR"

cat <<'EOF'

Setup done. Remaining manual steps:
  1. nano /opt/zeveto/.env     # fill real keys, then chmod 600 /opt/zeveto/.env
  2. OCI console: the instance is behind a VIRTUAL CLOUD NETWORK security list too —
     open inbound TCP 8080 there (VCN > Security Lists > Add Ingress Rule).
  3. systemctl start zeveto && journalctl -u zeveto -f
  4. Onboarding pairing code comes from the admin API on port 8080.
EOF
