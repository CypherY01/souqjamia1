import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Chapter 02: "test each actual text and background combination for contrast".
// WCAG 2.2 AA: 4.5:1 for text, 3:1 for control boundaries and focus indicators.
const css = readFileSync(join(import.meta.dirname, "../../apps/web/app/tokens.css"), "utf8");
const tokens = new Map(
  [...css.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [m[1] ?? "", m[2] ?? ""]),
);

function color(name: string): string {
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`No token --${name}`);
  return value;
}

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light = 0, dark = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

// [text, background] pairs used by the components.
const textPairs: [string, string][] = [
  ["text", "page"],
  ["text", "card"],
  ["text-muted", "page"],
  ["text-muted", "card"],
  ["text-muted", "divider"], // disabled button
  ["primary", "page"], // links
  ["primary", "card"],
  ["primary", "subtle-green"], // condition badge, success alert
  ["on-primary", "primary"],
  ["on-surface-dark", "surface-dark"], // footer
  ["on-accent", "accent"], // student badge
  ["text", "subtle-gold"],
  ["text", "subtle-green"],
  ["text", "warning-bg"],
  ["warning-text", "warning-bg"],
  ["danger", "card"], // field errors, danger alert
  ["danger", "page"],
  ["on-danger", "danger"], // danger button, unread count
];

// [boundary, background] pairs: control borders and focus rings.
const boundaryPairs: [string, string][] = [
  ["control-border", "card"],
  ["control-border", "page"],
  ["primary", "card"], // focus ring
  ["primary", "page"],
  ["on-surface-dark", "surface-dark"], // focus ring in the footer
];

describe("design tokens (chapter 02, WCAG 2.2 AA)", () => {
  it.each(textPairs)("text --color-%s on --color-%s is at least 4.5:1", (fg, bg) => {
    expect(contrast(color(`color-${fg}`), color(`color-${bg}`))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(boundaryPairs)("boundary --color-%s on --color-%s is at least 3:1", (fg, bg) => {
    expect(contrast(color(`color-${fg}`), color(`color-${bg}`))).toBeGreaterThanOrEqual(3);
  });

  it("owner decision on task 1.5, item 4: control borders #6B7280, dividers #E5E7EB", () => {
    expect(color("color-control-border").toLowerCase()).toBe("#6b7280");
    expect(color("color-divider").toLowerCase()).toBe("#e5e7eb");
  });

  it("gold fails as text on white, so it is only a background", () => {
    expect(contrast(color("color-accent"), color("color-card"))).toBeLessThan(4.5);
  });
});
