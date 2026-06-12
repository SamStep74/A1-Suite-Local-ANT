/**
 * Barrel for the deploy subfolder. Re-exports the escape-hatch component(s)
 * so callers import from `@/lib/deploy` rather than the leaf file.
 *
 * If Phase 8.12 retires the legacy build and `LegacyLink` is removed, this
 * barrel goes too — callers don't have to be updated.
 */
export { LegacyLink } from "./LegacyLink";
