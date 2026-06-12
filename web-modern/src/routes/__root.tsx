/**
 * Root route — wraps every page with the QueryClient, Toaster, and the
 * global stylesheet. The plan §3.3 mandate: a11y skip-to-content, color-scheme
 * driven by [data-theme], density driven by [data-density].
 *
 * CRITICAL: importing "./styles/globals.css" here is the *only* thing that
 * wires Tailwind v4 into the build. Without it, no utilities generate and
 * the app renders unstyled (code-reviewer finding #22).
 *
 * Theme and density are NOT mounted as providers here — they expose
 * `useTheme()` / `useDensity()` hooks that mutate `<html>` via useEffect
 * (see lib/theme/ThemeProvider.tsx, lib/density/DensityProvider.tsx). The
 * `<html data-theme="light" data-density="comfortable">` defaults below
 * are SSR-only; the client takes over from `localStorage` on first paint.
 *
 * The QueryClient IS a real provider — every page that uses `useQuery`
 * needs it above in the tree. See lib/api/queryClient.ts for the defaults.
 */
import { Link, Outlet, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { Toaster } from "../components/feedback/Toaster";
import { ErrorBoundary } from "../components/feedback/ErrorBoundary";
import { Skeleton } from "../components/feedback/Skeleton";
import { queryClient } from "../lib/api/queryClient";
import "../styles/globals.css";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "color-scheme", content: "light dark" },
      { title: "A1 Suite — ANT ERP" },
      {
        name: "description",
        content:
          "Sovereign, self-hostable Armenian business operating system with Zoho One functional parity and an agentic workspace.",
      },
    ],
  }),
  component: RootComponent,
  // R7 closure: a friendly fallback for any unhandled throw, suspended
  // promise, or unmatched route. Per plan §6 — never let a route
  // blank the page. The `error` is narrowed to `Error` in our wrapper
  // so the boundary can render `error.message` without leaking the
  // stack. `reset` is TanStack Router's retry function.
  errorComponent: ErrorBoundaryRoot,
  pendingComponent: Skeleton,
  notFoundComponent: NotFoundRoot,
});

/** Root error boundary — wraps the shared `ErrorBoundary` so we keep
 *  one source of truth for the error UI. */
function ErrorBoundaryRoot(props: {
  error: Error;
  reset: () => void;
}) {
  return <ErrorBoundary error={props.error} reset={props.reset} />;
}

/** Root 404 — Armenian + en copy, link back to the app shell. */
function NotFoundRoot() {
  return (
    <div
      role="alert"
      lang="hy"
      className="min-h-[60vh] flex flex-col items-center justify-center p-8 text-center"
    >
      <h1 className="text-3xl font-semibold text-stone-900 dark:text-stone-100 mb-2">
        Չի գտնվել
      </h1>
      <p className="text-stone-600 dark:text-stone-400 mb-6">
        Page not found.
      </p>
      <Link
        to="/"
        className="px-4 py-2 rounded-[var(--radius-md)] bg-stone-900 text-white text-sm font-semibold hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
      >
        Գնալ գլխավոր
        <span className="sr-only"> (Go to home)</span>
      </Link>
    </div>
  );
}

function RootComponent() {
  return (
    <RootDocument>
      <QueryClientProvider client={queryClient}>
        <a className="skip-to-content" href="#main">
          Skip to main content
        </a>
        <Outlet />
        <Toaster />
      </QueryClientProvider>
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="hy" data-theme="light" data-density="comfortable">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
