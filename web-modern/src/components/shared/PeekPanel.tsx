/**
 * PeekPanel — right-rail slide-over for record-level detail.
 *
 * Phase 10.4 shared primitive. triage-inbox and ask-ai (Phase
 * 10.5 W2 and W3) compose this; period-close-checklist does NOT
 * (the close wizard lives on one screen, no right-rail needed).
 *
 * This file exists so the shared/index.ts barrel resolves.
 * The real implementation lands with the workers that use it.
 */
import { type ReactNode } from "react";

export interface PeekPanelProps {
  /** Whether the panel is open. */
  open: boolean;
  /** Called when the user wants to close. */
  onClose: () => void;
  /** Panel content. */
  children: ReactNode;
  /** Optional title for the header. */
  title?: ReactNode;
  /** Optional className override. */
  className?: string;
  /** Test id passthrough. */
  testId?: string;
}

/**
 * Minimal stub. Renders nothing visible until the real
 * implementation lands. Keeps the shared barrel honest.
 */
export function PeekPanel(_props: PeekPanelProps): ReactNode {
  return null;
}
