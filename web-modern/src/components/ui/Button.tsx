/**
 * Button — kibo-ui/shadcn-compatible primitive. Vendored locally for Phase 0
 * so we can ship without committing to kibo-ui's full catalog. Phase 0.7
 * E2E exercises the variants "primary", "ghost", "outline".
 *
 * Per the plan: "calm enterprise AI" — no gradients, no glow, sharp focus ring.
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/utils/cn";

type Variant = "primary" | "secondary" | "ghost" | "outline" | "danger";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-[var(--color-brand)] text-white hover:bg-[color-mix(in_srgb,var(--color-brand)_88%,white)] disabled:opacity-50",
  secondary:
    "bg-[var(--color-surface-soft)] text-[var(--color-ink)] hover:bg-[color-mix(in_srgb,var(--color-surface-soft)_85%,var(--color-line))] disabled:opacity-50",
  ghost:
    "bg-transparent text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)] disabled:opacity-50",
  outline:
    "border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)] disabled:opacity-50",
  danger:
    "bg-[var(--color-ruby)] text-white hover:bg-[color-mix(in_srgb,var(--color-ruby)_88%,black)] disabled:opacity-50",
};

const SIZE: Record<Size, string> = {
  sm: "h-7 px-2 text-[var(--text-sm)] gap-1",
  md: "h-8 px-3 text-[var(--text-base)] gap-1.5",
  lg: "h-10 px-4 text-[var(--text-md)] gap-2",
  icon: "h-8 w-8 p-0",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    leadingIcon,
    trailingIcon,
    loading,
    className,
    children,
    disabled,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center rounded-[var(--radius-md)] font-medium",
        "transition-colors disabled:cursor-not-allowed",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {leadingIcon}
      {children}
      {trailingIcon}
    </button>
  );
});
