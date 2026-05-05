import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  reactCompiler: true,
  serverExternalPackages: ["better-sqlite3"],
};

export default config;
