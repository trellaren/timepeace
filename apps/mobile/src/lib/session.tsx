import type { Role } from "@timepeace/shared";
import * as SecureStore from "expo-secure-store";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { kv } from "./db";

export interface Session {
  token: string;
  user: { id: string; name: string; email: string };
  role: Role;
  org: { id: string; name: string; timezone: string };
}

const KEY = "timepeace.session";
let cached: Session | null = null;

export async function loadSession(): Promise<Session | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  cached = raw ? (JSON.parse(raw) as Session) : null;
  return cached;
}

export const getToken = () => cached?.token ?? null;

interface Ctx {
  session: Session | null | undefined;
  signIn: (s: Session) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<Ctx>(null as never);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    loadSession().then(setSession);
  }, []);
  const value: Ctx = {
    session,
    async signIn(s) {
      await SecureStore.setItemAsync(KEY, JSON.stringify(s));
      cached = s;
      setSession(s);
    },
    async signOut() {
      await SecureStore.deleteItemAsync(KEY);
      await kv.clearAll();
      cached = null;
      setSession(null);
    },
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
