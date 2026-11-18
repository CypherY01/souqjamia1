// Task 1.5 (NFR02, CLAUDE.md): the interface is right to left, so CSS uses logical properties
// (margin-inline-start, inset-inline-end, text-align: start) and never left/right ones.
// ESLint checks inline styles in JSX; this checks the CSS files.
//   node scripts/check-logical-css.ts [dir...]   default: apps/web
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export interface Finding {
  line: number;
  declaration: string;
}

const PHYSICAL_PROPERTY =
  /^(left|right|(margin|padding|border|scroll-margin|scroll-padding)-(left|right)(-[a-z]+)?|border-(top|bottom)-(left|right)-radius)$/;
const PHYSICAL_VALUE_PROPERTY = /^(text-align|float|clear|caption-side|resize)$/;
const PHYSICAL_VALUE = /^(left|right)(\s*!important)?$/;

/** Physical declarations in one stylesheet, with 1-based line numbers. */
export function findPhysicalDeclarations(css: string): Finding[] {
  // Blank out comments but keep their newlines, so line numbers stay right.
  const source = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
  const findings: Finding[] = [];
  const declaration = /(^|[{;\s])([a-z-]+)\s*:\s*([^;{}]+?)\s*(?=;|\})/g;
  for (const match of source.matchAll(declaration)) {
    const property = match[2] ?? "";
    const value = (match[3] ?? "").trim();
    const physical =
      PHYSICAL_PROPERTY.test(property) ||
      (PHYSICAL_VALUE_PROPERTY.test(property) && PHYSICAL_VALUE.test(value));
    if (!physical) continue;
    const offset = match.index + (match[1] ?? "").length;
    findings.push({
      line: source.slice(0, offset).split("\n").length,
      declaration: `${property}: ${value}`,
    });
  }
  return findings;
}

function cssFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...cssFiles(path));
    else if (entry.name.endsWith(".css")) files.push(path);
  }
  return files;
}

if (import.meta.main) {
  const roots = process.argv.slice(2);
  let count = 0;
  for (const root of roots.length > 0 ? roots : ["apps/web"]) {
    for (const file of cssFiles(root)) {
      for (const finding of findPhysicalDeclarations(readFileSync(file, "utf8"))) {
        count += 1;
        console.error(
          `${relative(process.cwd(), file)}:${String(finding.line)}  ${finding.declaration}`,
        );
      }
    }
  }
  if (count > 0) {
    console.error(
      `check:css: ${String(count)} left/right declaration(s). Use logical properties: margin-inline-start, inset-inline-end, text-align: start.`,
    );
    process.exitCode = 1;
  } else {
    console.log("check:css: logical properties only.");
  }
}
