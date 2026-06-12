/**
 * Type declarations for compiled Lingui catalogs.
 *
 * `lingui compile` produces a CJS file per locale:
 *
 *   module.exports = { messages: JSON.parse("…") };
 *
 * Vite's CJS-interop wraps that as `{ default: { messages: {…} } }`,
 * but our `CATALOG_LOADERS` use a static `import()` so the module
 * shape at runtime is `{ messages: Record<string, string> }`.
 *
 * This shim tells TypeScript the exact runtime shape without
 * requiring the generated catalogs to ship their own .d.ts files.
 */
declare module "@/locales/*/messages" {
  const messages: Record<string, string>;
  export { messages };
}
