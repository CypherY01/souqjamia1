import { describe, expect, it } from "vitest";
import { messages } from "@souq/i18n";

// The Arabic edition of v3 carried hidden U+200E marks (CLAUDE.md). Resource strings must not:
// direction is handled by markup (<bdi>, dir), never by invisible characters.
const HIDDEN = /[\u200b-\u200f\u061c\u202a-\u202e\u2066-\u2069\ufeff]/;

function leaves(node: unknown, path: string[] = []): [string, string][] {
  if (typeof node === "string") return [[path.join("."), node]];
  if (typeof node !== "object" || node === null) {
    throw new Error(`Not a string or object at ${path.join(".")}`);
  }
  return Object.entries(node).flatMap(([key, value]) => leaves(value, [...path, key]));
}

const all = leaves(messages);

describe("DEC30 Arabic resources (packages/i18n/src/ar)", () => {
  it("has strings", () => {
    expect(all.length).toBeGreaterThan(50);
  });

  it.each(all)("%s is not empty and has no hidden direction marks", (_key, value) => {
    expect(value.trim()).not.toBe("");
    expect(value).not.toMatch(HIDDEN);
    expect(value).toBe(value.normalize("NFC"));
  });
});
