"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCProvider, makeTrpcClient } from "@timepeace/api-client";
import { useState, type ReactNode } from "react";
import { clearSession, getToken } from "./session";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function TrpcProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true } } }),
  );
  const [trpcClient] = useState(() =>
    makeTrpcClient({
      baseUrl: API_URL,
      getToken,
      onUnauthorized: () => {
        clearSession();
        if (!location.pathname.startsWith("/login")) location.href = "/login";
      },
    }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}

/** Authenticated file download (payroll CSV/PDF). */
export async function downloadFile(path: string, filename: string) {
  const res = await fetch(`${API_URL}${path}`, { headers: { authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = res.headers.get("content-disposition")?.match(/filename="(.+)"/)?.[1] ?? filename;
  a.click();
  URL.revokeObjectURL(url);
}
