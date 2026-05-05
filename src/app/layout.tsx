import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { QueryProvider } from "@/components/query-provider";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { Sidebar } from "@/components/nav/sidebar";
import { Topbar } from "@/components/nav/topbar";
import "./globals.css";

export const metadata: Metadata = {
  title: "vmui — multi-cloud VM control",
  description: "A beautiful interface to manage virtual machines across cloud providers.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0e16" },
  ],
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
                    <Topbar />
                    <main className="flex-1 px-6 pb-12 pt-4 lg:px-10">{children}</main>
                  </div>
                </div>
                <Toaster position="bottom-right" theme="system" richColors closeButton />
              </ConfirmProvider>
            </TooltipProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
