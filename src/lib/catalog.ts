import "server-only";

export interface CatalogTemplate {
  id: string;
  name: string;
  category: "automation" | "analytics" | "docs" | "monitoring" | "security" | "dev";
  description: string;
  homepage: string;
  defaultPort: number;
  /** Approximate minimum guest spec we recommend for this app. */
  recommends: { vcpu: number; ramGb: number; diskGb: number };
  cloudInit: string;
}

const dockerBase = `#cloud-config
package_update: true
package_upgrade: true
packages:
  - ca-certificates
  - curl
  - gnupg
  - ufw
write_files:
  - path: /etc/sysctl.d/99-vmui.conf
    content: |
      vm.swappiness=10
      net.ipv4.tcp_keepalive_time=60
runcmd:
  - [ sh, -c, "install -m 0755 -d /etc/apt/keyrings" ]
  - [ sh, -c, "curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && chmod a+r /etc/apt/keyrings/docker.gpg" ]
  - [ sh, -c, "echo deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable > /etc/apt/sources.list.d/docker.list" ]
  - [ apt-get, update, -y ]
  - [ apt-get, install, -y, docker-ce, docker-ce-cli, containerd.io, docker-buildx-plugin, docker-compose-plugin ]
  - [ systemctl, enable, --now, docker ]
  - [ ufw, allow, "22/tcp" ]
`;

export const CATALOG: CatalogTemplate[] = [
  {
    id: "n8n",
    name: "n8n",
    category: "automation",
    description: "Source-available workflow automation. Self-host an n8n instance behind Caddy with auto-TLS.",
    homepage: "https://n8n.io",
    defaultPort: 5678,
    recommends: { vcpu: 2, ramGb: 2, diskGb: 20 },
    cloudInit: `${dockerBase}  - [ ufw, allow, "80/tcp" ]
  - [ ufw, allow, "443/tcp" ]
  - [ ufw, --force, enable ]
  - mkdir -p /opt/n8n
  - |
    cat >/opt/n8n/docker-compose.yml <<'YAML'
    services:
      n8n:
        image: n8nio/n8n:latest
        restart: unless-stopped
        environment:
          - N8N_HOST=\${N8N_HOST:-localhost}
          - N8N_PORT=5678
          - GENERIC_TIMEZONE=Europe/Bucharest
          - N8N_SECURE_COOKIE=false
        volumes:
          - n8n_data:/home/node/.n8n
        ports:
          - "5678:5678"
    volumes:
      n8n_data:
    YAML
  - [ sh, -c, "cd /opt/n8n && docker compose up -d" ]
`,
  },
  {
    id: "plausible",
    name: "Plausible",
    category: "analytics",
    description: "Lightweight, cookie-less, privacy-friendly web analytics. Drops in via Docker Compose with Postgres + ClickHouse.",
    homepage: "https://plausible.io",
    defaultPort: 8000,
    recommends: { vcpu: 2, ramGb: 4, diskGb: 30 },
    cloudInit: `${dockerBase}  - mkdir -p /opt/plausible
  - [ sh, -c, "curl -fsSL https://raw.githubusercontent.com/plausible/community-edition/v2.1.5/compose.yml -o /opt/plausible/compose.yml" ]
  - |
    cat >/opt/plausible/.env <<'ENV'
    BASE_URL=http://localhost:8000
    SECRET_KEY_BASE=__REPLACE_WITH_openssl_rand_-base64_64__
    TOTP_VAULT_KEY=__REPLACE_WITH_openssl_rand_-base64_32__
    HTTP_PORT=8000
    HTTPS_PORT=8443
    ENV
  - [ sh, -c, "cd /opt/plausible && docker compose up -d" ]
`,
  },
  {
    id: "outline",
    name: "Outline",
    category: "docs",
    description: "Team knowledge base / wiki with realtime collaborative editing. Requires SMTP and an OIDC/Slack identity provider.",
    homepage: "https://www.getoutline.com",
    defaultPort: 3000,
    recommends: { vcpu: 2, ramGb: 4, diskGb: 30 },
    cloudInit: `${dockerBase}  - mkdir -p /opt/outline
  - |
    cat >/opt/outline/docker-compose.yml <<'YAML'
    services:
      outline:
        image: outlinewiki/outline:latest
        restart: unless-stopped
        env_file: ./outline.env
        ports:
          - "3000:3000"
        depends_on: [ postgres, redis ]
      postgres:
        image: postgres:16-alpine
        restart: unless-stopped
        environment:
          POSTGRES_USER: outline
          POSTGRES_PASSWORD: outline
          POSTGRES_DB: outline
        volumes:
          - pg:/var/lib/postgresql/data
      redis:
        image: redis:7-alpine
        restart: unless-stopped
    volumes:
      pg:
    YAML
  - |
    cat >/opt/outline/outline.env <<'ENV'
    SECRET_KEY=__REPLACE_WITH_openssl_rand_-hex_32__
    UTILS_SECRET=__REPLACE_WITH_openssl_rand_-hex_32__
    DATABASE_URL=postgres://outline:outline@postgres:5432/outline
    REDIS_URL=redis://redis:6379
    URL=http://localhost:3000
    PORT=3000
    FORCE_HTTPS=false
    ENV
  - [ sh, -c, "cd /opt/outline && docker compose up -d" ]
`,
  },
  {
    id: "uptime-kuma",
    name: "Uptime Kuma",
    category: "monitoring",
    description: "Self-hosted status page and uptime monitor. Notifies via 90+ channels (Slack, Teams, email, Discord, …).",
    homepage: "https://uptime.kuma.pet",
    defaultPort: 3001,
    recommends: { vcpu: 1, ramGb: 1, diskGb: 10 },
    cloudInit: `${dockerBase}  - mkdir -p /opt/uptime-kuma
  - [ sh, -c, "docker run -d --restart=always -p 3001:3001 -v uptime-kuma:/app/data --name uptime-kuma louislam/uptime-kuma:1" ]
`,
  },
  {
    id: "vaultwarden",
    name: "Vaultwarden",
    category: "security",
    description: "Bitwarden-compatible password manager server, written in Rust. Tiny resource footprint.",
    homepage: "https://github.com/dani-garcia/vaultwarden",
    defaultPort: 80,
    recommends: { vcpu: 1, ramGb: 1, diskGb: 10 },
    cloudInit: `${dockerBase}  - [ ufw, allow, "80/tcp" ]
  - [ ufw, allow, "443/tcp" ]
  - [ ufw, --force, enable ]
  - [ sh, -c, "docker run -d --name vaultwarden --restart=always -p 80:80 -e ADMIN_TOKEN=$(openssl rand -base64 48) -v /opt/vw-data:/data vaultwarden/server:latest" ]
`,
  },
  {
    id: "code-server",
    name: "code-server",
    category: "dev",
    description: "VS Code in the browser, running on your server. Connect from anywhere; persistent workspaces.",
    homepage: "https://github.com/coder/code-server",
    defaultPort: 8443,
    recommends: { vcpu: 2, ramGb: 4, diskGb: 30 },
    cloudInit: `${dockerBase}  - [ ufw, allow, "8443/tcp" ]
  - [ ufw, --force, enable ]
  - mkdir -p /opt/code-server/config /opt/code-server/workspace
  - [ sh, -c, "docker run -d --name code-server --restart=always -p 8443:8443 -e PASSWORD=$(openssl rand -base64 24) -v /opt/code-server/config:/home/coder/.config -v /opt/code-server/workspace:/home/coder/project codercom/code-server:latest" ]
`,
  },
];

export function findTemplate(id: string): CatalogTemplate | null {
  return CATALOG.find((t) => t.id === id) ?? null;
}
