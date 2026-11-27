import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// Claude Code hooks (.claude/hooks): secrets never enter a session or git; .env.example,
// git and tests stay free. Exit 2 blocks (PreToolUse) or warns (PostToolUse).

const guard = fileURLToPath(new URL("../../.claude/hooks/guard-secrets.mjs", import.meta.url));
const after = fileURLToPath(
  new URL("../../.claude/hooks/check-secrets-after.mjs", import.meta.url),
);

function run(script: string, input: unknown, raw = false) {
  const result = spawnSync(process.execPath, [script], {
    input: raw ? String(input) : JSON.stringify(input),
    encoding: "utf8",
  });
  return { status: result.status, stderr: result.stderr };
}

const pre = (tool_name: string, tool_input: Record<string, unknown>) =>
  run(guard, { hook_event_name: "PreToolUse", cwd: process.cwd(), tool_name, tool_input }).status;
const shell = (command: string, tool = "Bash") => pre(tool, { command });

describe("PreToolUse guard-secrets", () => {
  it("refuses writing .env files and other secret files", () => {
    expect(pre("Write", { file_path: ".env", content: "x" })).toBe(2);
    expect(pre("Write", { file_path: "apps/web/.env.local", content: "x" })).toBe(2);
    expect(pre("Edit", { file_path: "C:\\repo\\apps\\worker\\.env.local" })).toBe(2);
    expect(pre("Write", { file_path: "certs/server.pem" })).toBe(2);
    expect(pre("Write", { file_path: "/home/me/.ssh/id_ed25519" })).toBe(2);
    expect(pre("Write", { file_path: "credentials.json" })).toBe(2);
    expect(pre("NotebookEdit", { notebook_path: ".env.production" })).toBe(2);
  });

  it("refuses reading .env files with Read and Grep", () => {
    expect(pre("Read", { file_path: ".env" })).toBe(2);
    expect(pre("Read", { file_path: "C:\\repo\\apps\\web\\.env.local" })).toBe(2);
    expect(pre("Read", { file_path: "apps/web/.ENV.Local" })).toBe(2);
    expect(pre("Grep", { pattern: "KEY", path: "apps/web/.env.local" })).toBe(2);
    expect(pre("Grep", { pattern: "KEY", glob: ".env*" })).toBe(2);
    expect(pre("Grep", { pattern: "KEY", glob: "**/{.env,.env.local}" })).toBe(2);
  });

  it("refuses reading .env files from the shell (cat, Get-Content, type)", () => {
    expect(shell("cat .env")).toBe(2);
    expect(shell("cat apps/web/.env.local")).toBe(2);
    expect(shell("head -5 'apps/worker/.env.local'")).toBe(2);
    expect(shell("Get-Content apps\\web\\.env.local", "PowerShell")).toBe(2);
    expect(shell("gc .env -TotalCount 3", "PowerShell")).toBe(2);
    expect(shell("type .env.local", "PowerShell")).toBe(2);
    expect(shell('Select-String -Path "apps/web/.env.local" -Pattern KEY', "PowerShell")).toBe(2);
    expect(shell("git status && cat .env")).toBe(2);
  });

  it("refuses shell writes to .env and secret files", () => {
    expect(shell("echo x > .env")).toBe(2);
    expect(shell("echo x >> apps/web/.env.local")).toBe(2);
    expect(shell("cp .env.example apps/web/.env.local")).toBe(2);
    expect(shell("Set-Content -Path apps/web/.env.local -Value x", "PowerShell")).toBe(2);
    expect(shell("git log | tee .env")).toBe(2);
    expect(shell("openssl genrsa > server.key")).toBe(2);
    expect(shell("Copy-Item a.txt server.pem", "PowerShell")).toBe(2);
  });

  it("refuses recursive shell searches that also read ignored .env files", () => {
    expect(shell("grep -rn SUPABASE apps/web")).toBe(2);
    expect(shell("Get-ChildItem -Recurse | Select-String SUPABASE", "PowerShell")).toBe(2);
    expect(shell("rg --hidden SUPABASE")).toBe(2);
    expect(shell("findstr /s SUPABASE *", "PowerShell")).toBe(2);
  });

  it("refuses git add -f and --force on a secret file", () => {
    expect(shell("git add -f apps/web/.env.local")).toBe(2);
    expect(shell("git add --force .env")).toBe(2);
    expect(shell("git add -Af certs/server.pem")).toBe(2);
    expect(shell("git -C apps add --force web/.env.local")).toBe(2);
  });

  it("always allows .env.example, read and write", () => {
    expect(pre("Read", { file_path: ".env.example" })).toBe(0);
    expect(pre("Write", { file_path: ".env.example", content: "X=" })).toBe(0);
    expect(pre("Edit", { file_path: "C:\\repo\\.env.example" })).toBe(0);
    expect(pre("Grep", { pattern: "KEY", glob: "**/.env.example" })).toBe(0);
    expect(shell("cat .env.example")).toBe(0);
    expect(shell("Get-Content .env.example", "PowerShell")).toBe(0);
  });

  it("allows ordinary git commands", () => {
    expect(shell("git status")).toBe(0);
    expect(shell("git add .env.example .gitignore")).toBe(0);
    expect(shell("git add -f docs/addendum-v3.1.md")).toBe(0);
    expect(shell('git commit -m "docs: .env.example lists what .env.local needs"')).toBe(0);
    expect(shell('git commit -m "add -f guard\n\nmentions apps/web/.env.local"')).toBe(0);
    expect(
      shell("git commit -q -F - <<'EOF'\nchore: keep .env.local out of git\n\n- add -f .env\nEOF"),
    ).toBe(0);
    expect(shell("git diff --stat; git log --oneline -3", "PowerShell")).toBe(0);
    expect(shell("git check-ignore -v apps/web/.env.local")).toBe(0);
    expect(shell("git push -u origin chore/claude-tooling")).toBe(0);
  });

  it("allows tests and the project's own commands", () => {
    expect(shell("pnpm test")).toBe(0);
    expect(shell("pnpm test:integration")).toBe(0);
    expect(shell("pnpm test:e2e")).toBe(0);
    expect(shell("pnpm env:local")).toBe(0);
    expect(shell("pnpm --filter @souq/tests exec vitest run unit/env.test.ts")).toBe(0);
    expect(shell('node -e "console.log(process.env.HOME)"')).toBe(0);
    expect(shell("grep -n parseEnv apps/web/lib/env.ts")).toBe(0);
    expect(pre("Read", { file_path: "apps/web/lib/env.ts" })).toBe(0);
    expect(pre("Write", { file_path: "tests/unit/env.test.ts", content: "x" })).toBe(0);
  });

  it("lets the tool run when the input is not JSON (fail-open)", () => {
    expect(run(guard, "not json", true).status).toBe(0);
  });

  it("explains the refusal on stderr", () => {
    const result = run(guard, { tool_name: "Read", tool_input: { file_path: ".env.local" } });
    expect(result.stderr).toContain("guard-secrets");
    expect(result.stderr).toContain(".env.local");
  });
});

describe("PostToolUse check-secrets-after", () => {
  const dir = mkdtempSync(join(tmpdir(), "claude-hooks-"));
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const written = (name: string, content: string) => {
    const path = join(dir, name);
    writeFileSync(path, content);
    return run(after, { tool_name: "Write", cwd: dir, tool_input: { file_path: path } }).status;
  };

  it("warns when a written file holds a secret-like value", () => {
    // Built at run time: no secret-like string in the source (gitleaks).
    const header = ["-----BEGIN", "PRIVATE", "KEY-----"].join(" ");
    expect(written("key.txt", `${header}\nabc\n`)).toBe(2);
    const part = "A".repeat(24);
    expect(written("jwt.ts", `const t = "${["eyJ" + part, "eyJ" + part, part].join(".")}";`)).toBe(
      2,
    );
    expect(written("sb.ts", `const k = "${"sb_" + "secret_" + "x".repeat(30)}";`)).toBe(2);
  });

  it("stays quiet for ordinary files", () => {
    expect(written("ok.ts", "export const limit = 200;\n")).toBe(0);
  });

  it("warns after git add or commit when a secret file is staged or committed", () => {
    const repo = join(dir, "repo");
    execFileSync("git", ["init", "-q", repo]);
    writeFileSync(join(repo, ".env.local"), "FAKE=1\n");
    writeFileSync(join(repo, ".env.example"), "FAKE=\n");
    const post = (command: string) =>
      run(after, { tool_name: "Bash", cwd: repo, tool_input: { command } }).status;

    execFileSync("git", ["add", ".env.example"], { cwd: repo });
    expect(post("git add .env.example")).toBe(0);

    execFileSync("git", ["add", "-f", ".env.local"], { cwd: repo });
    expect(post("git add -A")).toBe(2);
    expect(post("pnpm test")).toBe(0);
  });
});
