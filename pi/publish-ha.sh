#!/usr/bin/env bash
# Serve Home Assistant at https://home.dragoscatalin.ro from the Pi.
#   Caddy :443 (LAN IP) -> HA :80. Certificate: Let's Encrypt via lego, DNS-01 on Vercel.
#   The A record points at the LAN IP so the Nest Hub (LAN only) can cast; the
#   Pi advertises 192.168.100.0/24 as a Tailscale subnet route so the phone
#   reaches the same name when away.
# Env (passed by scripts/pi-publish-ha.ps1): VERCEL_API_TOKEN, VERCEL_TEAM_ID, LE_EMAIL,
#   DOMAIN (default home.dragoscatalin.ro), LAN_IP (default 192.168.100.232), TS_AUTHKEY (optional)
set -euo pipefail
DOMAIN="${DOMAIN:-home.dragoscatalin.ro}"
LAN_IP="${LAN_IP:-192.168.100.232}"
: "${VERCEL_API_TOKEN:?}" "${LE_EMAIL:?}"
STATE=/srv/homepi/publish
sudo mkdir -p "$STATE" && sudo chown "$USER" "$STATE"

# ---- tailscale (subnet router) ----
if ! tailscale status >/dev/null 2>&1 || tailscale status 2>&1 | grep -q "Logged out"; then
  echo "tailscale: joining"
  sudo tailscale up --hostname homepi --advertise-routes=192.168.100.0/24 --ssh ${TS_AUTHKEY:+--auth-key="$TS_AUTHKEY"}
else
  sudo tailscale set --advertise-routes=192.168.100.0/24 --hostname homepi || true
fi
echo 1 | sudo tee /proc/sys/net/ipv4/ip_forward >/dev/null
echo 'net.ipv4.ip_forward=1' | sudo tee /etc/sysctl.d/99-tailscale.conf >/dev/null

# ---- lego ----
if ! command -v lego >/dev/null; then
  V=$(curl -fsSL https://api.github.com/repos/go-acme/lego/releases/latest | grep -oE '"tag_name": *"v[^"]+"' | grep -oE 'v[0-9.]+')
  curl -fsSL "https://github.com/go-acme/lego/releases/download/${V}/lego_${V}_linux_arm64.tar.gz" | sudo tar -xz -C /usr/local/bin lego
fi
cd "$STATE"
export VERCEL_API_TOKEN VERCEL_TEAM_ID="${VERCEL_TEAM_ID:-}"
lego run --accept-tos --email "$LE_EMAIL" --dns vercel --dns.propagation.wait 60s -d "$DOMAIN" --renew-days 30 --no-random-sleep 2>&1 | tail -3
CRT="$STATE/.lego/certificates/$DOMAIN.crt"; KEY="$STATE/.lego/certificates/$DOMAIN.key"
test -f "$CRT"

# ---- caddy ----
if ! command -v caddy >/dev/null; then
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl >/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -qq && sudo apt-get install -y caddy >/dev/null
fi
sudo cp "$CRT" /etc/caddy/ha.crt && sudo cp "$KEY" /etc/caddy/ha.key && sudo chown caddy:caddy /etc/caddy/ha.* && sudo chmod 600 /etc/caddy/ha.key
sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
{
	auto_https off
	admin localhost:2019
}

https://$DOMAIN {
	bind $LAN_IP
	tls /etc/caddy/ha.crt /etc/caddy/ha.key
	encode zstd gzip
	reverse_proxy 127.0.0.1:80 {
		header_up X-Forwarded-Proto https
		header_up X-Real-IP {remote_host}
		flush_interval -1
	}
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options nosniff
	}
	log {
		output file /var/log/caddy/ha-access.log {
			roll_size 10mb
			roll_keep 3
		}
	}
}
EOF
sudo mkdir -p /var/log/caddy && sudo chown caddy:caddy /var/log/caddy
sudo systemctl enable --now caddy >/dev/null
sudo systemctl reload caddy || sudo systemctl restart caddy

# ---- renewal: daily lego run + copy + reload ----
sudo tee /usr/local/bin/ha-cert-renew >/dev/null <<EOF
#!/usr/bin/env bash
set -e
cd $STATE
export VERCEL_API_TOKEN='$VERCEL_API_TOKEN' VERCEL_TEAM_ID='${VERCEL_TEAM_ID:-}'
lego run --accept-tos --email '$LE_EMAIL' --dns vercel --dns.propagation.wait 60s -d '$DOMAIN' --renew-days 30 >/dev/null 2>&1 || exit 0
cp '$CRT' /etc/caddy/ha.crt; cp '$KEY' /etc/caddy/ha.key; chown caddy:caddy /etc/caddy/ha.*; chmod 600 /etc/caddy/ha.key
systemctl reload caddy
EOF
sudo chmod 700 /usr/local/bin/ha-cert-renew
echo '30 4 * * * root /usr/local/bin/ha-cert-renew' | sudo tee /etc/cron.d/ha-cert-renew >/dev/null

# ---- HA: trust the proxy (needed or HA rejects X-Forwarded-For with 400) ----
CFG=/srv/homepi/ha/configuration.yaml
if ! grep -q "^http:" "$CFG"; then
  printf '\nhttp:\n  use_x_forwarded_for: true\n  trusted_proxies:\n    - 127.0.0.1\n    - ::1\n' | sudo tee -a "$CFG" >/dev/null
  echo "ha: http: block added (restart needed)"
fi
echo "done: https://$DOMAIN -> 127.0.0.1:80"
