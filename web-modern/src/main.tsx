/**
 * SPA entry — replaces the virtual entry TanStack Start provided at
 * runtime in SSR mode. After the D1 flip, `vite build` emits a
 * static SPA; this file is the script tag's target.
 *
 * Responsibilities:
 *   1. Build a single router instance from the route tree.
 *   2. Mount it into `#root` in index.html.
 *
 * The SPA-shell regression sentinel (`data-spa-hydrated` on the
 * <html> element) is set by an inline script in index.html, not
 * here. Doing it inline decouples the signal from the React tree
 * committing, which depends on the whole module graph compiling.
 * See the comment in index.html for the full rationale.
 *
 * The `getRouter` factory lives in `./router.tsx` (the canonical
 * router factory for both server and client) — we re-use it here
 * so the route tree and default options stay in one place.
 *
 * Phase 10.3: I18nProvider wraps the router. The provider must be
 * ABOVE the RouterProvider (it sets the Lingui React context that
 * <Trans> and useLingui() read from) but BELOW any other context
 * providers so error boundaries / theme providers etc. can read
 * the i18n locale if they ever need to.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";
import { I18nProvider } from "./i18n/I18nProvider";
import { registerDispatchServiceWorker } from "./lib/pwa/dispatch-service-worker";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error(
    "[main.tsx] mount point #root missing from index.html — " +
      "the SPA shell is broken.",
  );
}

const router = getRouter();

void registerDispatchServiceWorker();

createRoot(rootEl).render(
  <StrictMode>
    <I18nProvider>
      <RouterProvider router={router} />
    </I18nProvider>
  </StrictMode>,
);
