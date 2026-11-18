// SEC06: check the build output that reaches the browser for secrets (task 1.3).
// The service_role key must never be in the browser bundle (CLAUDE.md).
// Run after `pnpm build`. Prints the file and the kind of problem, never the matched value.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

export type FindingKind =
  | "service_role_text"
  | "supabase_secret_key"
  | "service_role_jwt"
  | "postgres_url"
  | "server_env_name";

export interface Finding {
  readonly file: string;
  readonly kind: FindingKind;
  /** For server_env_name: the variable name (a name from .env.example, never a value). */
  readonly name?: string;
}

const SERVICE_ROLE_TEXT = /service_role/;
const SUPABASE_SECRET_KEY = /sb_secret_/;
const POSTGRES_URL = /postgres(?:ql)?:\/\//i;
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g;

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jwtRole(token: string): unknown {
  const payload = token.split(".")[1];
  if (payload === undefined) return undefined;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return isRecord(decoded) ? decoded.role : undefined;
  } catch {
    return undefined;
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Variable names in .env.example that the browser must never see (no NEXT_PUBLIC_ prefix). */
export function serverOnlyEnvNames(envExample: string): string[] {
  const names: string[] = [];
  for (const line of envExample.split(/\r?\n/)) {
    const name = /^\s*([A-Z][A-Z0-9_]*)\s*=/.exec(line)?.[1];
    if (name !== undefined && !name.startsWith("NEXT_PUBLIC_")) names.push(name);
  }
  return names;
}

export function scanText(
  text: string,
  serverOnlyNames: readonly string[],
): { kind: FindingKind; name?: string }[] {
  const found: { kind: FindingKind; name?: string }[] = [];
  if (SERVICE_ROLE_TEXT.test(text)) found.push({ kind: "service_role_text" });
  if (SUPABASE_SECRET_KEY.test(text)) found.push({ kind: "supabase_secret_key" });
  if (POSTGRES_URL.test(text)) found.push({ kind: "postgres_url" });
  for (const match of text.matchAll(JWT)) {
    if (jwtRole(match[0]) === "service_role") {
      found.push({ kind: "service_role_jwt" });
      break;
    }
  }
  for (const name of serverOnlyNames) {
    if (new RegExp(`\\b${escapeRegExp(name)}\\b`).test(text)) {
      found.push({ kind: "server_env_name", name });
    }
  }
  return found;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

/**
 * Files under .next that are sent to the browser: everything in static/, plus the prerendered
 * HTML and RSC payloads (including .segments/*.rsc) under server/app and server/pages.
 * Server-only code such as server/app/page.js is not sent to the browser and is not scanned.
 */
export function listClientFiles(nextDir: string): string[] {
  const files: string[] = [];
  const staticDir = join(nextDir, "static");
  if (existsSync(staticDir)) files.push(...walk(staticDir));
  for (const sub of ["server/app", "server/pages"]) {
    const dir = join(nextDir, sub);
    if (!existsSync(dir)) continue;
    files.push(...walk(dir).filter((file) => file.endsWith(".html") || file.endsWith(".rsc")));
  }
  return files.filter((file) => !BINARY_EXTENSIONS.has(extname(file).toLowerCase())).sort();
}

export function scanClientOutput(
  nextDir: string,
  serverOnlyNames: readonly string[],
): { files: number; findings: Finding[] } {
  const files = listClientFiles(nextDir);
  const findings: Finding[] = [];
  for (const file of files) {
    for (const hit of scanText(readFileSync(file, "utf8"), serverOnlyNames)) {
      findings.push({ file: relative(nextDir, file), ...hit });
    }
  }
  return { files: files.length, findings };
}

if (import.meta.main) {
  const nextDir = join(process.cwd(), "apps", "web", ".next");
  if (!existsSync(nextDir)) {
    console.error("check:bundle: apps/web/.next not found. Run `pnpm build` first.");
    process.exitCode = 1;
  } else {
    const envPath = join(process.cwd(), ".env.example");
    const names = existsSync(envPath) ? serverOnlyEnvNames(readFileSync(envPath, "utf8")) : [];
    const { files, findings } = scanClientOutput(nextDir, names);
    if (files === 0) {
      console.error(
        "check:bundle: no client files found under apps/web/.next. Is the build complete?",
      );
      process.exitCode = 1;
    } else if (findings.length > 0) {
      for (const f of findings) {
        console.error(`  ${f.file}: ${f.kind}${f.name === undefined ? "" : ` (${f.name})`}`);
      }
      console.error(
        `check:bundle: ${String(findings.length)} problem(s) in browser-facing output.`,
      );
      process.exitCode = 1;
    } else {
      console.log(
        `check:bundle: ${String(files)} browser-facing files scanned, ` +
          `${String(names.length)} server-only variable names checked, no secrets found.`,
      );
    }
  }
}
