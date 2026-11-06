"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { errorMessage, useTRPC } from "@timepeace/api-client";
import { MIN_PASSWORD_LENGTH, ROLE_LABELS } from "@timepeace/shared";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Button, ErrorText, Input, Loading } from "@/components/ui";
import { saveSession } from "@/lib/session";

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-line bg-surface p-6">
        <h1 className="text-xl font-bold text-accent-ink">timepeace</h1>
        {children}
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const trpc = useTRPC();
  const preview = useQuery({ ...trpc.invites.preview.queryOptions({ token }), retry: false });
  const accept = useMutation(trpc.invites.accept.mutationOptions());
  const [name, setName] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [doneAsWorker, setDoneAsWorker] = useState<string | null>(null);

  if (preview.isLoading) return <Frame><Loading /></Frame>;
  const p = preview.data;

  if (doneAsWorker) {
    return (
      <Frame>
        <p className="text-sm">
          You&apos;re in, <strong>{doneAsWorker}</strong>. Your crew uses the <strong>Timepeace app</strong> to clock in, run tasks and log expenses. Open it on your phone and sign in with
          this email and the password you just set.
        </p>
        <Button className="w-full" variant="secondary" onClick={() => router.replace("/")}>
          Continue on the web
        </Button>
      </Frame>
    );
  }

  if (!p || p.status === "INVALID") {
    return (
      <Frame>
        <p className="text-sm text-ink-2">This invite link isn&apos;t valid anymore. It may have been used already, replaced by a newer link, or cancelled.</p>
        <p className="text-sm text-muted">Ask whoever invited you for a new link, or <Link className="text-accent-ink underline" href="/login">sign in</Link> if you already joined.</p>
      </Frame>
    );
  }
  if (p.status === "EXPIRED") {
    return (
      <Frame>
        <p className="text-sm text-ink-2">
          This invite to <strong>{p.orgName}</strong> has expired. Ask {p.inviterName} to send a new link.
        </p>
      </Frame>
    );
  }

  const newAccount = !p.existingAccount;
  return (
    <Frame>
      <p className="text-sm text-ink-2">
        <strong>{p.inviterName}</strong> invited you to join <strong>{p.orgName}</strong> as {ROLE_LABELS[p.role].toLowerCase()}.
      </p>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          if (newAccount && password !== confirm) return setErr("Passwords don't match");
          try {
            const s = await accept.mutateAsync({ token, password, ...(newAccount ? { name: (name ?? p.name).trim() } : {}) });
            saveSession(s);
            if (s.role === "WORKER") setDoneAsWorker(s.user.name);
            else router.replace("/");
          } catch (x) {
            setErr(errorMessage(x));
          }
        }}
      >
        <Input label="Email" value={p.email} readOnly disabled />
        {newAccount ? (
          <>
            <Input label="Your name" value={name ?? p.name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
            <Input label={`Choose a password (${MIN_PASSWORD_LENGTH}+ characters)`} type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} value={password} onChange={(e) => setPassword(e.target.value)} required />
            <Input label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </>
        ) : (
          <>
            <p className="text-xs text-muted">You already have a Timepeace account with this email. Enter its password to add {p.orgName}.</p>
            <Input label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </>
        )}
        <ErrorText error={err} />
        <Button type="submit" className="w-full" disabled={accept.isPending}>
          {accept.isPending ? "Joining…" : `Join ${p.orgName}`}
        </Button>
      </form>
    </Frame>
  );
}
