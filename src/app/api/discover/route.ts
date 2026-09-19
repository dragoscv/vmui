import { NextResponse } from "next/server";
import { hostname } from "node:os";

export const dynamic = "force-dynamic";

/** Unauthenticated identity card for autodiscovery (mDNS _vmui._tcp → this). Nothing sensitive. */
export function GET() {
  return NextResponse.json({ app: "vmui", host: hostname(), version: process.env.npm_package_version ?? "", pair: "/api/devices/pair" }, { headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
}
