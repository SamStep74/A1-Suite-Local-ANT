/**
 * /login/mfa — second-factor challenge. Placeholder for Phase 0.7.
 *
 * In Phase 0 the server's /api/login returns { mfaRequired: true } and the
 * client navigates here. Phase 1 wires the actual TOTP / SMS challenge form
 * that posts to /api/mfa/verify and on success navigates to /app.
 */
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, KeyRound } from "lucide-react";
import { Button } from "../components/ui/Button";
import { postJson, ApiError } from "../lib/api/client";
import { MfaChallengeSchema } from "../lib/api/schemas";
import { getToken } from "../lib/api/auth-token";
import { cn } from "../lib/utils/cn";

export const Route = createFileRoute("/login/mfa")({
  beforeLoad: () => {
    // If a Bearer token is already in sessionStorage, the user is signed
    // in on this surface — bounce to /app. (The MFA flow only runs in
    // browsers that did NOT get a token from /api/login.)
    if (getToken()) {
      throw redirect({ to: "/app" });
    }
  },
  component: MfaScreen,
});

function MfaScreen() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await postJson("/api/mfa/verify", { code }, MfaChallengeSchema);
      window.location.assign("/app");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError("Wrong code.");
      else setError("Verification failed. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      id="main"
      className={cn(
        "flex min-h-screen items-center justify-center",
        "bg-gradient-to-br from-[var(--color-brand)] via-[var(--color-brand)] to-[var(--color-teal)]",
        "p-4",
      )}
    >
      <div className="w-[min(400px,100%)] rounded-[var(--radius-xl)] bg-[var(--color-surface)] p-8 shadow-[var(--shadow-2)]">
        <header className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-brand)] text-white">
            <KeyRound className="size-6" />
          </div>
          <h1 className="text-[var(--text-xl)] font-semibold text-[var(--color-ink)]">
            Two-factor code
          </h1>
          <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
            Enter the 6-digit code from your authenticator.
          </p>
        </header>

        <form onSubmit={onSubmit} className="space-y-3" noValidate>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className={cn(
              "w-full rounded-[var(--radius-md)] border border-[var(--color-line)]",
              "bg-[var(--color-surface)] px-3 text-center text-[var(--text-lg)] font-mono tracking-[0.4em]",
              "h-11 text-[var(--color-ink)] focus-visible:border-[var(--color-brand)]",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
            )}
            aria-label="Six-digit authentication code"
          />

          {error && (
            <p className="text-center text-[var(--text-sm)] text-[var(--color-ruby)]">{error}</p>
          )}

          <Button
            type="submit"
            loading={loading}
            disabled={loading || code.length !== 6}
            className="w-full"
            size="lg"
          >
            Verify
          </Button>

          <Link
            to="/login"
            className="flex items-center justify-center gap-1 pt-1 text-[var(--text-xs)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
          >
            <ArrowLeft className="size-3" /> Back to sign in
          </Link>
        </form>
      </div>
    </main>
  );
}
