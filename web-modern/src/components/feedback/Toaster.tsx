/**
 * Toaster — Sonner, themed to the design tokens.
 *
 * Per the plan §3.3 "no futuristic neon": toast types are color-blind-safe
 * (success = teal, error = ruby, info = blue) — no glow, no gradient.
 */
import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            "bg-[var(--color-surface)] text-[var(--color-ink)] border-[var(--color-line)] shadow-[var(--shadow-2)] rounded-[var(--radius-lg)] font-sans text-[var(--text-sm)]",
          success:
            "border-l-4 border-l-[var(--color-teal)]",
          error:
            "border-l-4 border-l-[var(--color-ruby)]",
          info: "border-l-4 border-l-[var(--color-blue)]",
          warning:
            "border-l-4 border-l-[var(--color-amber)]",
        },
      }}
      richColors={false}
      closeButton
    />
  );
}
