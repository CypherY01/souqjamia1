import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// "Trojan Source": invisible and bidirectional control characters in source code can make it
// read differently from how it runs. Source files must write them as escape sequences.
// The pattern is built from code points so this file itself contains none of them.
const RANGES: [number, number][] = [
  [0x200b, 0x200f], // zero-width spaces and joiners, LRM, RLM
  [0x202a, 0x202e], // bidi embeddings and overrides
  [0x2066, 0x2069], // bidi isolates
  [0x061c, 0x061c], // Arabic letter mark
  [0xfeff, 0xfeff], // byte order mark / zero-width no-break space
];
const hidden = new RegExp(
  `[${RANGES.map(([a, b]) => `${String.fromCodePoint(a)}-${String.fromCodePoint(b)}`).join("")}]`,
  "u",
);

const root = join(import.meta.dirname, "../..");
const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], {
  cwd: root,
  encoding: "utf8",
})
  .split("\n")
  // .sql since task 2.1: migrations write special characters as U& escapes.
  .filter((file) => /\.(ts|tsx|mjs|js|css|json|ya?ml|toml|html|sql)$/.test(file));

describe("source hygiene", () => {
  it("found source files", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("no source file contains invisible or bidi control characters", () => {
    const offending = files.flatMap((file) =>
      readFileSync(join(root, file), "utf8")
        .split("\n")
        .flatMap((line, index) => (hidden.test(line) ? [`${file}:${String(index + 1)}`] : [])),
    );
    expect(offending).toEqual([]);
  });
});
