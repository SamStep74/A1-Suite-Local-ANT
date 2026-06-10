/**
 * cn() — class-name composer (clsx + tailwind-merge).
 *
 * The contract: it joins className fragments and resolves Tailwind
 * utility conflicts so density / theme / variant props don't produce
 * duplicates like `p-2 p-4`.
 */
import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("joins multiple string arguments with a space", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("returns an empty string for no arguments", () => {
    expect(cn()).toBe("");
  });

  it("filters out falsy values (false, null, undefined, 0, empty string)", () => {
    expect(cn("a", false, null, undefined, 0, "", "b")).toBe("a b");
  });

  it("flattens array inputs into the final className", () => {
    expect(cn(["a", "b"], "c")).toBe("a b c");
  });

  it("supports nested arrays", () => {
    expect(cn(["a", ["b", "c"]], "d")).toBe("a b c d");
  });

  it("includes keys whose object value is truthy and omits falsy ones", () => {
    expect(cn({ foo: true, bar: false, baz: 1, qux: 0 })).toBe("foo baz");
  });

  it("mixes strings, arrays, and objects in one call", () => {
    expect(cn("base", ["a", "b"], { active: true, hidden: false })).toBe(
      "base a b active",
    );
  });

  it("resolves Tailwind padding conflicts (last-wins)", () => {
    expect(cn("p-4", "p-2")).toBe("p-2");
  });

  it("resolves Tailwind margin-x conflicts", () => {
    expect(cn("mx-4", "mx-2")).toBe("mx-2");
  });

  it("resolves Tailwind text-color conflicts", () => {
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("keeps non-conflicting Tailwind utilities intact", () => {
    expect(cn("p-4", "mt-2", "font-bold")).toBe("p-4 mt-2 font-bold");
  });

  it("resolves variant conflicts (hover, focus) — later wins", () => {
    expect(cn("hover:p-4", "hover:p-2")).toBe("hover:p-2");
  });

  it("a later utility can override an earlier conflicting one even when surrounded by others", () => {
    expect(cn("p-4 text-sm", "mt-2", "p-2")).toBe("text-sm mt-2 p-2");
  });

  it("returns a string type", () => {
    expect(typeof cn("a", { b: true })).toBe("string");
  });
});
