/**
 * Unit tests for the `ant-lingui-catalogs` Vite plugin's pure
 * extraction logic. The plugin's `load` hook is a thin wrapper
 * around these helpers, so the e2e suite is the integration test
 * for the full pipeline (Vite dev server → browser import).
 */
import { describe, expect, it } from "vitest";
import {
  buildCatalogEsm,
  extractLinguiMessages,
  linguiCatalogs,
} from "./lingui-catalogs";

// `lingui compile` output shape, verbatim (modulo string contents).
// The full file is one line; the inner `JSON.parse("...")` payload
// is the only thing we care about.
const TYPICAL =
  '/*eslint-disable*/module.exports={messages:JSON.parse("' +
  '{"foo":"bar","baz":"qux"}' +
  '")};';

describe("extractLinguiMessages", () => {
  it("parses a typical lingui-compiled catalog", () => {
    expect(extractLinguiMessages(TYPICAL)).toEqual({ foo: "bar", baz: "qux" });
  });

  it("handles an empty messages object", () => {
    const raw = '/*eslint-disable*/module.exports={messages:JSON.parse("{}")};';
    expect(extractLinguiMessages(raw)).toEqual({});
  });

  it("handles messages with escaped quotes inside values", () => {
    // JSON-escaped: input JSON string `{"a":"x\"y"}` after one level
    // of JSON.parse becomes JS string `{"a":"x\"y"}`. The value
    // `"x\"y"` deserializes to the literal text `x"y`.
    const raw =
      '/*eslint-disable*/module.exports={messages:JSON.parse(' +
      '"{\\"a\\":\\"x\\\\\\"y\\"}"' +
      ")};";
    expect(extractLinguiMessages(raw)).toEqual({ a: 'x"y' });
  });

  it("throws when JSON.parse is missing", () => {
    expect(() => extractLinguiMessages("module.exports={};")).toThrow(
      /Could not find `JSON\.parse/,
    );
  });

  it("throws on an unterminated JSON.parse argument", () => {
    // No closing `")` and no closing `;` — the file content
    // simply ends mid-string. `indexOf('")', from)` returns -1.
    const raw = 'module.exports={messages:JSON.parse("{...unterminated';
    expect(() => extractLinguiMessages(raw)).toThrow(/Unterminated/);
  });
});

describe("buildCatalogEsm", () => {
  it("emits a default-export ESM module", () => {
    const esm = buildCatalogEsm(TYPICAL, "hy");
    expect(esm).toMatch(/export default \{ messages: \{/);
    expect(esm).toContain('"foo":"bar"');
    expect(esm).toContain('"baz":"qux"');
  });

  it("includes the locale tag in a header comment", () => {
    const esm = buildCatalogEsm(TYPICAL, "ru");
    expect(esm).toContain("lingui-catalog:ru");
  });

  it("re-emits an empty catalog as `export default { messages: {} };`", () => {
    const raw = '/*eslint-disable*/module.exports={messages:JSON.parse("{}")};';
    const esm = buildCatalogEsm(raw, "hy");
    expect(esm).toContain("export default { messages: {} };");
  });
});

describe("linguiCatalogs() plugin factory", () => {
  it("returns a Vite plugin with the expected name and load hook", () => {
    const plugin = linguiCatalogs();
    expect(plugin.name).toBe("ant-lingui-catalogs");
    expect(typeof plugin.load).toBe("function");
  });

  it("ignores ids that don't match the catalog pattern", () => {
    const plugin = linguiCatalogs();
    // `load` is typed as `(id: string) => ...` in Plugin; the runtime
    // contract is that non-matching ids return `null`.
    const result = (
      plugin as unknown as { load: (id: string) => unknown }
    ).load("/some/other/path.js");
    expect(result).toBeNull();
  });

  it("ignores catalog-like paths with the wrong extension", () => {
    const plugin = linguiCatalogs();
    const result = (
      plugin as unknown as { load: (id: string) => unknown }
    ).load("/src/locales/hy/messages.json");
    expect(result).toBeNull();
  });
});
