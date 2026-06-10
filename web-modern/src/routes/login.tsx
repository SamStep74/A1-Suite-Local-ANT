/**
 * Login — Zoho-style centered card on a teal-gradient background.
 *
 * Per the plan §3.2 pattern #1, login is the first place the new "Calm
 * enterprise AI" identity lands — no neon, no glow, no glass. The deep-teal
 * Armenian brand gradient (var(--color-brand) → var(--color-teal)) is the
 * only color block in the entire app.
 *
 * Auth flow: POSTs to /api/login. The Fastify backend (server/app.js:291)
 * sets the `sid` HttpOnly cookie AND returns the `sid` token in the body.
 * The new app uses the body token for `Authorization: Bearer <sid>` on
 * subsequent requests (see client.ts). The legacy Vite app uses the cookie.
 */
import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { Sparkles, AlertCircle } from "lucide-react";
import { Button } from "../components/ui/Button";
import { postJson, ApiError } from "../lib/api/client";
import { LoginResponseSchema } from "../lib/api/schemas";
import { setToken, getToken } from "../lib/api/auth-token";
import { cn } from "../lib/utils/cn";

export const Route = createFileRoute("/login")({
  beforeLoad: () => {
    // If a Bearer token is already in sessionStorage, the user is signed
    // in on this surface — bounce to /app. The legacy Vite app uses the
    // `sid` cookie as its own auth signal; we don't read the cookie here.
    if (getToken()) {
      throw redirect({ to: "/app" });
    }
  },
  component: LoginScreen,
});

function LoginScreen() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // skipAuth: this is the login call — there's no Bearer token yet.
      const res = await postJson(
        "/api/login",
        { email, password },
        LoginResponseSchema,
      );
      if (res.mfaRequired) {
        // MFA path — the sid lives in the /api/login/mfa response, not here.
        navigate({ to: "/login/mfa" });
        return;
      }
      if (res.sid) setToken(res.sid);
      navigate({ to: "/app" });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) setError("Wrong email or password.");
        else if (err.status === 429) setError("Too many attempts. Please wait a minute.");
        else setError(err.message || "Sign in failed.");
      } else {
        setError("Network error. Please try again.");
      }
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
            <Sparkles className="size-6" />
          </div>
          <h1 className="text-[var(--text-xl)] font-semibold text-[var(--color-ink)]">
            A1 Suite ANT
          </h1>
          <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
            Sign in to your workspace
          </p>
        </header>

        <form onSubmit={onSubmit} className="space-y-3" noValidate>
          <Field
            label="Email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={setEmail}
            required
          />
          <Field
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={setPassword}
            required
          />

          {error && (
            <div
              role="alert"
              className={cn(
                "flex items-start gap-2 rounded-[var(--radius-md)]",
                "border border-[color-mix(in_srgb,var(--color-ruby)_30%,transparent)]",
                "bg-[color-mix(in_srgb,var(--color-ruby)_8%,var(--color-surface))] p-2.5",
                "text-[var(--text-sm)] text-[var(--color-ruby)]",
              )}
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button
            type="submit"
            loading={loading}
            disabled={loading || !email || !password}
            className="w-full"
            size="lg"
          >
            Sign in
          </Button>

          <p className="pt-2 text-center text-[var(--text-xs)] text-[var(--color-muted)]">
            Self-hosted? Set your backend URL in <code>.env</code>.
          </p>
        </form>
      </div>
    </main>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  autoComplete,
  required,
}: {
  label: string;
  type: "email" | "password";
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
        {label}
      </span>
      <input
        type={type}
        autoComplete={autoComplete}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "w-full rounded-[var(--radius-md)] border border-[var(--color-line)]",
          "bg-[var(--color-surface)] px-3 text-[var(--text-base)] text-[var(--color-ink)]",
          "placeholder:text-[var(--color-muted)] h-9",
          "focus-visible:border-[var(--color-brand)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
        )}
      />
    </label>
  );
}
