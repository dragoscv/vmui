import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PREFIXES = [
  "/sign-in",
  "/sign-up",
  "/api/events",
  "/api/v1",
  "/api/esp",   // ESP32 display: token-authenticated, no session cookie
  "/api/turzx", // Turzx desk screen renderer: same shared token
  "/api/display", // Nest Hub kiosk API: token-authenticated (?k=), the Hub cannot log in
  "/api/desktop", // Tauri desktop app: same shared token
  "/display", // Nest Hub kiosk page: gated by ?k= inside the page
  "/api/copilot", // agent-harness hooks -> physical signals: same shared token
  "/api/nutrition", // codai phone assistant posts meals: same shared token (espAuthorized)
  "/api/pc/wake",   // Wake-on-LAN from HA / phone / desk button: same shared token
  "/api/mcp", // MCP action server for codai phone/desktop: bearer vmui_* operator key
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
  if (pathname === "/display") {
    // the root layout reads this to skip the app shell (sidebar, palette, SW…) on the Nest Hub
    const h = new Headers(req.headers);
    h.set("x-vmui-kiosk", "1");
    return NextResponse.next({ request: { headers: h } });
  }
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
