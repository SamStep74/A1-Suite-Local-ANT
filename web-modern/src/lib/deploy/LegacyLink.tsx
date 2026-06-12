/**
 * LegacyLink — Phase 10.1 escape hatch.
 *
 * A small link component that points at the legacy `web/` build, which the
 * Fastify backend now serves at `/legacy/*` (see `server/app.js`,
 * `registerStatic`). Opens in a new tab so the operator's web-modern session
 * (and any open route tree state) is preserved.
 *
 * Why a separate component, not a raw `<a>`:
 *   - The "/legacy" prefix is a deployment detail; centralizing it here means
 *     callers don't hardcode the path. If Phase 8.12 retires the legacy build
 *     and the mount goes away, callers don't need to be updated — only this
 *     file's `href` template does.
 *   - The `target="_blank"` + `rel="noopener noreferrer"` pair is non-obvious
 *     security boilerplate (the `noopener` prevents the new tab from poking
 *     `window.opener` on the SPA; `noreferrer` strips the Referer header).
 *     Hiding it behind a component prevents the next person from forgetting
 *     one of them.
 *   - The `↗` glyph is the universally recognized "external link" hint, so
 *     the rendered link is self-describing without a separate tooltip.
 *
 * The link uses a *path* (not a full URL) because both apps are reverse-
 * proxied or host-aliased to the same origin in deployment. The cookie and
 * Authorization header are sent automatically by the browser, so the
 * legacy SPA inherits the operator's web-modern session — no re-login.
 */
import * as React from "react";

interface LegacyLinkProps {
  /** Path within the legacy build, e.g. "/", "/inventory", "/crm/deals". */
  to: string;
  /** Link text. */
  children: React.ReactNode;
  /** Optional Tailwind classes; defaults to a muted, small, underlined style. */
  className?: string;
}

const DEFAULT_CLASS = "text-xs text-stone-500 hover:text-stone-700 underline";

export function LegacyLink({ to, children, className }: LegacyLinkProps) {
  return (
    <a
      href={`/legacy${to}`}
      target="_blank"
      rel="noopener noreferrer"
      className={className ?? DEFAULT_CLASS}
    >
      {children} ↗
    </a>
  );
}
