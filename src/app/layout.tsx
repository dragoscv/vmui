import { CommandPalette } from "@/components/command-palette";
import { VibeProvider } from "@/components/dashboard/vibe-provider";
import { IncidentBanner } from "@/components/incident-banner";
import { GlobalOverlays } from "@/components/nav/global-overlays";
import { MobileNav } from "@/components/nav/mobile-nav";
import { Sidebar } from "@/components/nav/sidebar";
import { Topbar } from "@/components/nav/topbar";
import { UserMenu } from "@/components/nav/user-menu";
import { PullToRefresh } from "@/components/pwa/pull-to-refresh";
import { QueryProvider } from "@/components/query-provider";
import { RealtimeListener } from "@/components/realtime-listener";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { ThemeProvider } from "@/components/theme-provider";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { VoiceCommander } from "@/components/voice-commander";
import { ensureAlertSchedulerRunning } from "@/lib/alert-engine";
import { ensureAuditRetention } from "@/lib/audit-retention";
import { getCurrentUser } from "@/lib/auth";
import { ensureBackupSchedulerRunning } from "@/lib/backups";
import { ensureComplianceScanRunning } from "@/lib/compliance-scheduler";
import { ensureGitopsSchedulerRunning } from "@/lib/gitops";
import { ensureSchedulerRunning } from "@/lib/scheduler";
import { startWebhookDispatcher } from "@/lib/webhook-dispatcher";
import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { headers } from "next/headers";
import { Toaster } from "sonner";
import "./globals.css";

// Module-load side effects run in every `next build` page-data worker too
// (~30 of them, each opening the SQLite file and starting timers). Only the
// real server should.
if (process.env.NEXT_PHASE !== "phase-production-build") {
  ensureSchedulerRunning();
  ensureAuditRetention();
  startWebhookDispatcher();
  ensureComplianceScanRunning();
  ensureAlertSchedulerRunning();
  ensureGitopsSchedulerRunning();
  ensureBackupSchedulerRunning();
}

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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // /display (Nest Hub kiosk) gets a bare document: no sidebar (which prefetches
  // ~30 routes), no palette / voice / SW / realtime — the Hub has 4 slow cores.
  const locale = await getLocale();
  if ((await headers()).get("x-vmui-kiosk") === "1") {
    return (
      <html lang={locale} className="display-root" suppressHydrationWarning>
        <body>
          <NextIntlClientProvider>{children}</NextIntlClientProvider>
        </body>
      </html>
    );
  }
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var v=localStorage.getItem('vmui:vibe');if(v&&['default','cyberpunk','cockpit','strategy','terminal','minimal','aurora','synthwave'].indexOf(v)>=0){document.documentElement.setAttribute('data-vibe',v);}}catch(e){}})();",
          }}
        />
      </head>
      <body className="min-h-screen antialiased">
        <NextIntlClientProvider>
        <ThemeProvider>
          <VibeProvider>
            <QueryProvider>
              <TooltipProvider delayDuration={300}>
                <ConfirmProvider>
                  <PullToRefresh>
                    <div className="flex min-h-screen">
                      <Sidebar />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <Topbar user={<UserMenuSlot />} />
                        <main className="flex-1 px-4 pb-24 pt-4 sm:px-6 md:pb-12 lg:px-10">
                          <IncidentBanner />
                          {children}
                        </main>
                      </div>
                    </div>
                  </PullToRefresh>
                  <MobileNav />
                  <Toaster position="bottom-right" theme="system" richColors closeButton />
                  <GlobalOverlays />
                  <ServiceWorkerRegister />
                  <CommandPalette />
                  <VoiceCommander />
                  <RealtimeListener />
                </ConfirmProvider>
              </TooltipProvider>
            </QueryProvider>
          </VibeProvider>
        </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

async function UserMenuSlot() {
  try {
    const user = await getCurrentUser();
    if (!user) return null;
    return <UserMenu user={{ email: user.email, displayName: user.displayName, role: user.role }} />;
  } catch {
    return null;
  }
}
