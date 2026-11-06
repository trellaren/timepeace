import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import superjson from "superjson";
import type { AppRouter, RouterInputs, RouterOutputs } from "@timepeace/api";

export type { AppRouter, RouterInputs, RouterOutputs };

export interface ClientOptions {
  baseUrl: string;
  getToken: () => string | null | Promise<string | null>;
  onUnauthorized?: () => void;
}

export function makeTrpcClient(opts: ClientOptions) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${opts.baseUrl}/trpc`,
        transformer: superjson,
        async headers() {
          const token = await opts.getToken();
          return token ? { authorization: `Bearer ${token}` } : {};
        },
        async fetch(url, init) {
          const res = await fetch(url, init);
          if (res.status === 401) opts.onUnauthorized?.();
          return res;
        },
      }),
    ],
  });
}

export type TrpcClient = ReturnType<typeof makeTrpcClient>;

export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();

export function errorMessage(err: unknown): string {
  if (err instanceof TRPCClientError) {
    const zod = (err.data as { zodError?: { fieldErrors?: Record<string, string[]> } } | undefined)?.zodError;
    const first = zod?.fieldErrors && Object.entries(zod.fieldErrors)[0];
    if (first) return `${first[0]}: ${first[1]?.[0]}`;
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
