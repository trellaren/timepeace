import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/ThemeProvider";
import { themeBootScript, themeCss } from "@/lib/theme";
import { TrpcProviders } from "@/lib/trpc";
import "./globals.css";

export const metadata: Metadata = {
  title: "Timepeace",
  description: "Project management, time tracking and job costing for builders",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The boot script sets data-theme before React hydrates, so the attribute is expected to differ.
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeCss() }} />
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="antialiased">
        <ThemeProvider>
          <TrpcProviders>{children}</TrpcProviders>
        </ThemeProvider>
      </body>
    </html>
  );
}
