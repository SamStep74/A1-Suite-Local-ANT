/**
 * Kbd — keyboard-shortcut hint chip. Used in Topbar (⌘K) and command palette.
 */
import type { ReactNode } from "react";
import { cn } from "../../lib/utils/cn";

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "rounded border border-[var(--color-line)] bg-[var(--color-canvas)] px-1.5 py-0.5",
        "font-mono text-[10px] text-[var(--color-muted)]",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
