/**
 * Root index — redirects to the Today feed (/app) which then enforces auth
 * and bounces to /login if the session cookie is missing.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/app" });
  },
});
