import type { Role } from "@timepeace/shared";
import * as SecureStore from "expo-secure-store";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { adoptUntaggedOutbox, kv } from "./db";

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
  if (cached) await adoptUntaggedOutbox(cached.user);
  return cached;
}

export const getToken = () => cached?.token ?? null;

/**
 * Called by the API client when the server rejects our token (access turned off, or the session
 * expired). Registered by SessionProvider; a no-op when nobody is signed in, so a wrong password
 * on the sign-in screen (also a 401) doesn't trigger it.
 */
let onRevoked: (() => void) | null = null;
export function sessionRevoked() {
  if (cached) onRevoked?.();
}

interface Ctx {
  session: Session | null | undefined;
  /** Why the app signed out on its own, shown on the sign-in screen. */
  notice: string | null;
  signIn: (s: Session) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<Ctx>(null as never);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const endingRef = useRef(false);

  useEffect(() => {
    loadSession().then(setSession);
  }, []);

  // Unsynced changes stay in the outbox (tagged with the worker) and upload after the next sign-in.
  const end = async () => {
    await SecureStore.deleteItemAsync(KEY);
    await kv.clearCache();
    cached = null;
    setSession(null);
  };

  useEffect(() => {
    onRevoked = () => {
      if (endingRef.current) return;
      endingRef.current = true;
      setNotice("You've been signed out. Your access was turned off or your sign-in expired. Sign in again, or ask your manager if you can't.");
      end().finally(() => (endingRef.current = false));
    };
    return () => {
      onRevoked = null;
    };
  }, []);

  const value: Ctx = {
    session,
    notice,
    async signIn(s) {
      await SecureStore.setItemAsync(KEY, JSON.stringify(s));
      cached = s;
      setNotice(null);
      setSession(s);
    },
    async signOut() {
      setNotice(null);
      await end();
    },
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
