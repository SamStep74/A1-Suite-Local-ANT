/**
 * Single TanStack QueryClient for the new app.
 *
 * One instance, created at module load, so React Query's cache survives
 * SSR hydration. SSR rendering can dehydrate via `dehydrate(queryClient)`
 * and rehydrate on the client without resetting state.
 *
 * Defaults chosen for an ERP work surface (not a marketing site):
 *   - staleTime 30s: data on Today / Desk list shouldn't be re-fetched
 *     on every focus, but a 30s window keeps the "Completed today"
 *     counter fresh without thrashing the network.
 *   - gcTime 5min: cases / approvals cached long enough for back-button
 *     navigation to feel instant.
 *   - retry 1: we have curl + browser E2E covering failure modes; we
 *     want transient network blips to retry once, not three times.
 *   - refetchOnWindowFocus: true — the user is going to come back from
 *     typing in another tab and want fresh data.
 */
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: 0,
    },
  },
});
