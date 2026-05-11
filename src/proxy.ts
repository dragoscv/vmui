import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PREFIXES = [
  "/sign-in",
  "/sign-up",
  "/api/events",
  "/api/v1",
  "/_next",
  "/icons",
  "/favicon",
  "/manifest.webmanifest",
  "/sw.js",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();
  const session = req.cookies.get("vmui_session");
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/sign-in";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
