/**
 * lib/fiscal — public surface for the fiscal-gates feature.
 *
 * Routes should import from this barrel (and only this barrel) so
 * the internal split between `schemas.ts`, `gates.ts`, and
 * `labels.ts` can move without touching consumers.
 */
export * from "./schemas";
export * from "./gates";
export * from "./labels";
