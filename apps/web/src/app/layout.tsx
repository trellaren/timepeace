import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TrpcProviders } from "@/lib/trpc";
import "./globals.css";

export const metadata: Metadata = {
  title: "Timepeace",
  description: "Project management, time tracking and job costing for builders",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <TrpcProviders>{children}</TrpcProviders>
      </body>
    </html>
  );
}
