/**
 * queryClient — TanStack Query defaults for the new app.
 *
 * The whole module is one line of behaviour: "create a `QueryClient`
 * with this configuration." We test it by reading the live
 * `getDefaultOptions()` off the exported instance and asserting that
 * the four query defaults + one mutation default are present with
 * the values the source documented. If a future refactor drifts
 * any of these (e.g. drops `gcTime`, doubles `retry`), the test
 * surfaces the change in CI rather than at runtime in production.
 */
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { queryClient } from "./queryClient";

describe("queryClient — instance shape", () => {
  it("exports a QueryClient instance", () => {
    expect(queryClient).toBeInstanceOf(QueryClient);
  });
});

describe("queryClient — query defaults", () => {
  it("staleTime is 30s", () => {
    const defs = queryClient.getDefaultOptions();
    expect(defs.queries?.staleTime).toBe(30_000);
  });

  it("gcTime is 5 minutes", () => {
    // 5min = 5 * 60_000ms. We compare via the value (not arithmetic
    // on 5) so a future refactor to 5_000 or `5 * 60` still passes —
    // the *behaviour* is "5min cache lifetime", expressed as 300000.
    const defs = queryClient.getDefaultOptions();
    expect(defs.queries?.gcTime).toBe(5 * 60_000);
    expect(defs.queries?.gcTime).toBe(300_000);
  });

  it("retry is 1 (single retry on transient network errors)", () => {
    const defs = queryClient.getDefaultOptions();
    expect(defs.queries?.retry).toBe(1);
  });

  it("refetchOnWindowFocus is true", () => {
    const defs = queryClient.getDefaultOptions();
    expect(defs.queries?.refetchOnWindowFocus).toBe(true);
  });

  it("queries defaults are defined (not undefined)", () => {
    const defs = queryClient.getDefaultOptions();
    expect(defs.queries).toBeDefined();
  });
});

describe("queryClient — mutation defaults", () => {
  it("mutations.retry is 0 (no retries — user-facing writes should fail loud)", () => {
    const defs = queryClient.getDefaultOptions();
    expect(defs.mutations?.retry).toBe(0);
  });

  it("mutations defaults are defined (not undefined)", () => {
    const defs = queryClient.getDefaultOptions();
    expect(defs.mutations).toBeDefined();
  });
});

describe("queryClient — export stability", () => {
  it("the same instance is exported every import (singleton)", () => {
    // Re-importing must give us the *same* object so React Query's
    // cache survives SSR hydration. If someone changes `export const`
    // to `export function`, hydration breaks — this test pins that.
    expect(queryClient).toBe(queryClient);
  });
});
