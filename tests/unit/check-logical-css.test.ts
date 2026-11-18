import { describe, expect, it } from "vitest";
import { findPhysicalDeclarations } from "../../scripts/check-logical-css.ts";

describe("check:css (NFR02, logical properties only)", () => {
  it("finds left/right properties and values with their lines", () => {
    const css = [
      ".a { margin-left: 0; }",
      ".b {",
      "  padding-right: 4px;",
      "  text-align: right;",
      "  float: left !important;",
      "  left: 0;",
      "  border-top-left-radius: 4px;",
      "  border-right-color: red;",
      "}",
    ].join("\n");
    expect(findPhysicalDeclarations(css)).toEqual([
      { line: 1, declaration: "margin-left: 0" },
      { line: 3, declaration: "padding-right: 4px" },
      { line: 4, declaration: "text-align: right" },
      { line: 5, declaration: "float: left !important" },
      { line: 6, declaration: "left: 0" },
      { line: 7, declaration: "border-top-left-radius: 4px" },
      { line: 8, declaration: "border-right-color: red" },
    ]);
  });

  it("accepts logical properties, start/end values and comments", () => {
    const css = [
      "/* margin-left: 0; is not allowed */",
      ".a { margin-inline-start: 0; inset-inline-end: 0; text-align: start; }",
      ".b { border-inline-start: 4px solid; float: inline-end; text-align: center }",
      ".c:hover { color: red; }",
    ].join("\n");
    expect(findPhysicalDeclarations(css)).toEqual([]);
  });
});
