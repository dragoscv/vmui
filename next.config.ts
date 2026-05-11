import type { NextConfig } from "next";

// Local-only binding; no HSTS (no TLS). CSP is deliberately strict — we don't
// load 3rd-party scripts/styles. `'unsafe-inline'` on style-src is needed for
// Tailwind's runtime inline styles and Radix portals.
const SECURITY_HEADERS: Array<{ key: string; value: string }> = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' ws://127.0.0.1:3738 ws://localhost:3738",
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const config: NextConfig = {
  reactStrictMode: true,
  reactCompiler: true,
  serverExternalPackages: ["better-sqlite3", "ssh2", "cpu-features", "ws"],
  experimental: {
    viewTransition: true,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default config;
