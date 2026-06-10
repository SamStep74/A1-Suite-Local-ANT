/**
 * Root route — wraps every page with theme/density providers, Toaster, and the
 * global stylesheet. The plan §3.3 mandate: a11y skip-to-content, color-scheme
 * driven by [data-theme], density driven by [data-density].
 *
 * CRITICAL: importing "./styles/globals.css" here is the *only* thing that
 * wires Tailwind v4 into the build. Without it, no utilities generate and
 * the app renders unstyled (code-reviewer finding #22).
 */
import { Outlet, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Toaster } from "../components/feedback/Toaster";
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
});

function RootComponent() {
  return (
    <RootDocument>
      <a className="skip-to-content" href="#main">
        Skip to main content
      </a>
      <Outlet />
      <Toaster />
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
