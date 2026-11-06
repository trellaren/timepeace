"use client";

import { useMutation } from "@tanstack/react-query";
import { errorMessage, useTRPC } from "@timepeace/api-client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ThemePicker } from "@/components/ThemeProvider";
import { Button, ErrorText, Input } from "@/components/ui";
import { saveSession } from "@/lib/session";
import { API_URL } from "@/lib/trpc";

export default function LoginPage() {
  const trpc = useTRPC();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const login = useMutation(trpc.auth.login.mutationOptions());

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
      <form
        className="w-full max-w-sm space-y-4 rounded-lg border border-line bg-surface p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          const s = await login.mutateAsync({ email, password }).catch(() => null);
          if (s) {
            saveSession(s);
            router.replace("/");
          }
        }}
      >
        <div>
          <h1 className="text-xl font-bold text-accent-ink">timepeace</h1>
          <p className="text-sm text-muted">Sign in to your company account</p>
        </div>
        <Input label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Input label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <ErrorText error={login.error ? errorMessage(login.error) : null} />
        <Button type="submit" className="w-full" disabled={login.isPending}>
          {login.isPending ? "Signing in…" : "Sign in"}
        </Button>
        {API_URL.includes("localhost") && <p className="text-xs text-faint">Demo: manager@acme.test, hr@acme.test, owner@acme.test · password “timepeace”</p>}
      </form>
      <ThemePicker />
    </div>
  );
}
