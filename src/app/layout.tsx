import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { QueryProvider } from "@/components/query-provider";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { Sidebar } from "@/components/nav/sidebar";
import { Topbar } from "@/components/nav/topbar";
import { MobileNav } from "@/components/nav/mobile-nav";
import { GlobalOverlays } from "@/components/nav/global-overlays";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { RealtimeListener } from "@/components/realtime-listener";
import { ensureSchedulerRunning } from "@/lib/scheduler";
import { ensureAuditRetention } from "@/lib/audit-retention";
import { startWebhookDispatcher } from "@/lib/webhook-dispatcher";
import { ensureComplianceScanRunning } from "@/lib/compliance-scheduler";
import { getCurrentUser } from "@/lib/auth";
import { UserMenu } from "@/components/nav/user-menu";
import "./globals.css";

ensureSchedulerRunning();
ensureAuditRetention();
startWebhookDispatcher();
ensureComplianceScanRunning();

export const metadata: Metadata = {
  title: "vmui — multi-cloud VM control",
  description: "A beautiful interface to manage virtual machines across cloud providers.",
  manifest: "/manifest.webmanifest",
  applicationName: "vmui",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "vmui",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.svg", type: "image/svg+xml", sizes: "192x192" },
      { url: "/icons/icon-512.svg", type: "image/svg+xml", sizes: "512x512" },
    ],
    apple: "/icons/icon-512.svg",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0e16" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <ThemeProvider>
          <QueryProvider>
            <TooltipProvider delayDuration={300}>
              <ConfirmProvider>
                <div className="flex min-h-screen">
                  <Sidebar />
                  <div className="flex flex-1 flex-col">
                    <div className="relative">
                      <Topbar />
                      <UserMenuSlot />
                    </div>
                    <main className="flex-1 px-4 pb-24 pt-4 sm:px-6 md:pb-12 lg:px-10">{children}</main>
                  </div>
                </div>
                <MobileNav />
                <Toaster position="bottom-right" theme="system" richColors closeButton />
                <GlobalOverlays />
                <ServiceWorkerRegister />
                <RealtimeListener />
              </ConfirmProvider>
            </TooltipProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

async function UserMenuSlot() {
  try {
    const user = await getCurrentUser();
    if (!user) return null;
    return (
      <div className="pointer-events-none absolute right-6 top-0 z-40 flex h-14 items-center lg:right-10">
        <div className="pointer-events-auto">
          <UserMenu user={{ email: user.email, displayName: user.displayName, role: user.role }} />
        </div>
      </div>
    );
  } catch {
    return null;
  }
}
