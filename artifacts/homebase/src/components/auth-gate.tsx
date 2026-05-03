import { FormEvent, ReactNode, useEffect, useState } from "react";
import { LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiUrl } from "@/lib/api-base";

type SessionResponse = {
  authRequired: boolean;
  authenticated: boolean;
};

async function requestSession(): Promise<SessionResponse> {
  const response = await fetch(apiUrl("/api/auth/session"), {
    credentials: "include",
    headers: { accept: "application/json" },
  });

  if (!response.ok) throw new Error("Unable to check session");
  return response.json() as Promise<SessionResponse>;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [accessCode, setAccessCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    requestSession()
      .then((nextSession) => {
        if (!cancelled) setSession(nextSession);
      })
      .catch(() => {
        if (!cancelled) setError("Homebase API is not reachable.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch(apiUrl("/api/auth/login"), {
        method: "POST",
        credentials: "include",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({ accessCode }),
      });

      if (!response.ok) {
        setError(response.status === 429 ? "Too many attempts. Try again shortly." : "Invalid access code.");
        return;
      }

      setAccessCode("");
      setSession({ authRequired: true, authenticated: true });
    } catch {
      setError("Homebase API is not reachable.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-[100dvh] grid place-items-center bg-background px-4 text-sm text-muted-foreground">
        Loading Homebase
      </div>
    );
  }

  if (!session?.authRequired || session.authenticated) {
    return <>{children}</>;
  }

  return (
    <main className="min-h-[100dvh] grid place-items-center bg-background px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-sm"
      >
        <div className="mb-5 flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-md bg-primary/10 text-primary">
            <LockKeyhole className="size-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Homebase</h1>
            <p className="text-sm text-muted-foreground">Access code required</p>
          </div>
        </div>

        <label className="mb-2 block text-sm font-medium text-foreground" htmlFor="access-code">
          Access code
        </label>
        <Input
          id="access-code"
          autoComplete="current-password"
          autoFocus
          type="password"
          value={accessCode}
          onChange={(event) => setAccessCode(event.target.value)}
        />

        {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

        <Button className="mt-5 w-full" disabled={submitting || accessCode.length === 0} type="submit">
          {submitting ? "Signing in" : "Sign in"}
        </Button>
      </form>
    </main>
  );
}
