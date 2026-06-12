/**
 * ErrorBoundary — friendly error UI for the root `errorComponent`.
 *
 * Per plan §6 R7 closure: every unhandled throw in a route should
 * land on this UI rather than blank the page. We deliberately strip
 * the stack trace and render ONLY `error.message` — a stack leak
 * would expose internal class names, file paths, and possibly user
 * data in the rendered output (OWASP A04:2021 — Insecure Design).
 *
 * Props mirror TanStack Router's `errorComponent` signature
 * ({ error, reset }), so this is a drop-in for the root route.
 */
import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";

export interface ErrorBoundaryProps {
  /** The thrown value. We narrow to Error via duck-typing — TanStack
   *  Router's type is `unknown` at the type-system level but is
   *  always an Error at runtime. */
  error?: Error | unknown;
  /** TanStack Router's reset fn — retries the loader/component that
   *  threw. We pass it through to the "Try again" button. */
  reset?: () => void;
}

/** Narrow `unknown` to a string message without leaking the stack. */
function getErrorMessage(error: ErrorBoundaryProps["error"]): string | null {
  if (error == null) return null;
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return "Unknown error";
}

export function ErrorBoundary({ error, reset }: ErrorBoundaryProps) {
  const message = getErrorMessage(error);

  return (
    <div
      role="alert"
      lang="hy"
      className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 p-8 text-center"
    >
      <AlertTriangle
        className="size-10 text-amber-500"
        aria-hidden
      />
      <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
        Սխալ է տեղի ունեցել
      </h1>
      <p className="text-sm text-stone-600 dark:text-stone-400">
        Something went wrong.
      </p>

      {message != null && message.length > 0 ? (
        <pre
          data-testid="error-message"
          className="max-w-full overflow-x-auto whitespace-pre-wrap rounded border border-stone-200 bg-stone-50 px-3 py-2 text-left font-mono text-xs text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300"
        >
          {message}
        </pre>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        {reset ? (
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center justify-center rounded-[var(--radius-md)] bg-stone-900 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
          >
            Փորձել կրկին
            <span className="sr-only"> (Try again)</span>
          </button>
        ) : null}
        <Link
          to="/"
          className="inline-flex items-center justify-center rounded-[var(--radius-md)] border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-900 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800"
        >
          Գնալ գլխավոր
          <span className="sr-only"> (Go to home)</span>
        </Link>
      </div>
    </div>
  );
}

export default ErrorBoundary;
