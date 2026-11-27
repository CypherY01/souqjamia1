// PostToolUse: warn Claude (exit 2, stderr) when a written file holds secret-like content, or
// when `git add`/`git commit` staged or committed a secret file. The tool already ran: this
// never blocks, it asks Claude to undo and fix.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import process from "node:process";
import {
  gitCommand,
  isSecretFile,
  readHookInput,
  SECRET_CONTENT,
  segments,
  tokens,
} from "./secret-rules.mjs";

const MAX_BYTES = 2 * 1024 * 1024;

function writtenFileProblems(input) {
  const args = input.tool_input ?? {};
  const target = args.file_path ?? args.notebook_path;
  if (!target) return [];
  const path = isAbsolute(target) ? target : join(input.cwd ?? process.cwd(), target);
  if (!existsSync(path) || statSync(path).size > MAX_BYTES) return [];
  const text = readFileSync(path, "utf8");
  return SECRET_CONTENT.filter(({ pattern }) => pattern.test(text)).map(
    ({ name }) =>
      `${target} holds something that looks like a ${name}. Never commit secret-like strings, not even in tests: build fake values at run time.`,
  );
}

function git(cwd, args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\n")
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

function gitProblems(input) {
  const subs = segments(input.tool_input?.command ?? "")
    .map((segment) => tokens(segment))
    .filter((w) => (w[0] ?? "").toLowerCase().replace(/\.exe$/, "") === "git")
    .map((w) => gitCommand(w).sub);
  const adds = subs.includes("add") || subs.includes("stage");
  const commits = subs.includes("commit");
  if (!adds && !commits) return [];
  const cwd = input.cwd ?? process.cwd();
  const problems = git(cwd, ["diff", "--cached", "--name-only"])
    .filter((name) => isSecretFile(name))
    .map((name) => `${name} is staged. Unstage it now: git restore --staged -- "${name}"`);
  if (commits) {
    for (const name of git(cwd, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"])) {
      if (isSecretFile(name))
        problems.push(`${name} is in the last commit. Stop and tell the owner before any push.`);
    }
  }
  return problems;
}

const input = await readHookInput(process.stdin);
let problems = [];
if (input) {
  const tool = input.tool_name;
  if (tool === "Write" || tool === "Edit" || tool === "MultiEdit" || tool === "NotebookEdit") {
    problems = writtenFileProblems(input);
  } else if (tool === "Bash" || tool === "PowerShell") {
    problems = gitProblems(input);
  }
}
if (problems.length > 0) {
  process.stderr.write(
    `Warning from .claude/hooks/check-secrets-after.mjs:\n- ${problems.join("\n- ")}\n`,
  );
  process.exit(2);
}
process.exit(0);
