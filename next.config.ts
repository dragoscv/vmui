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
  // Native bindings must never be bundled. The cloud SDKs are pure server
  // code that Turbopack was inlining into one 30 MB server chunk (+160 MB
  // source map) per build; leaving them in node_modules cuts compile time
  // and .next/server by an order of magnitude with no runtime difference.
  serverExternalPackages: [
    "better-sqlite3",
    "ssh2",
    "cpu-features",
    "ws",
    "@aws-sdk/client-cloudwatch",
    "@aws-sdk/client-ec2",
    "@aws-sdk/client-elastic-load-balancing-v2",
    "@aws-sdk/client-pricing",
    "@aws-sdk/client-rds",
    "@aws-sdk/client-route-53",
    "@aws-sdk/client-s3",
    "@aws-sdk/client-sts",
    "@azure/arm-compute",
    "@azure/arm-dns",
    "@azure/arm-network",
    "@azure/arm-resources-subscriptions",
    "@azure/arm-sql",
    "@azure/arm-storage",
    "@azure/identity",
    "@google-cloud/compute",
    "@google-cloud/dns",
    "@google-cloud/storage",
    "google-auth-library",
  ],
  productionBrowserSourceMaps: false,
  // `next build` runs a full tsc pass (measured 30 s of an 84 s build). The
  // same check is `pnpm typecheck` (tsgo, ~2 s) and the build wrapper runs it
  // first, so here it is only duplicated work.
  typescript: { ignoreBuildErrors: true },
  experimental: {
    viewTransition: true,
    serverSourceMaps: false,
    // turbopackFileSystemCacheForBuild measured 2026-09-16: no-op rebuild
    // 31.6 s -> 32.9 s and .next 74 MB -> 212 MB. Not worth it here.
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
