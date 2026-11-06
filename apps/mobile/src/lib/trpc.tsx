import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCProvider, makeTrpcClient } from "@timepeace/api-client";
import { useState, type ReactNode } from "react";
import { API_URL } from "./config";
import { getToken } from "./session";

export const trpcClient = makeTrpcClient({ baseUrl: API_URL, getToken });

export function TrpcProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, networkMode: "offlineFirst" }, mutations: { networkMode: "offlineFirst" } } }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}

export async function uploadReceipt(localUri: string): Promise<string> {
  const name = localUri.split("/").pop() ?? "receipt.jpg";
  const type = name.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
  const body = new FormData();
  // React Native's FormData accepts { uri, name, type } file descriptors.
  body.append("file", { uri: localUri, name, type } as unknown as Blob);
  const res = await fetch(`${API_URL}/files`, { method: "POST", headers: { authorization: `Bearer ${getToken()}` }, body });
  if (!res.ok) throw new Error(`Receipt upload failed (${res.status})`);
  return ((await res.json()) as { id: string }).id;
}
