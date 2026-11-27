// PreToolUse: refuse reading or writing .env files (never .env.example), writing other secret
// files, and `git add --force` on a secret file. Exit 2 blocks the tool and shows stderr to Claude.
// Unreadable input lets the tool run (fail-open), so a hook bug never stops the work.
import process from "node:process";
import {
  baseName,
  isEnvFile,
  isSecretFile,
  readHookInput,
  shellRefusal,
  tokens,
} from "./secret-rules.mjs";

function refusal(input) {
  const tool = input.tool_name;
  const args = input.tool_input ?? {};

  if (tool === "Read") {
    if (isEnvFile(args.file_path ?? ""))
      return `reading ${baseName(args.file_path)}: secrets must not enter the session.`;
    return null;
  }
  if (tool === "Grep") {
    if (isEnvFile(args.path ?? ""))
      return `searching ${baseName(args.path)}: secrets must not enter the session.`;
    if (tokens(args.glob ?? "").some((word) => isEnvFile(word))) {
      return "a Grep glob that reaches .env files: secrets must not enter the session.";
    }
    return null;
  }
  if (tool === "Write" || tool === "Edit" || tool === "MultiEdit" || tool === "NotebookEdit") {
    const target = args.file_path ?? args.notebook_path ?? "";
    if (isSecretFile(target))
      return `writing ${baseName(target)}: secret files are edited by the owner only.`;
    return null;
  }
  if (tool === "Bash" || tool === "PowerShell") return shellRefusal(args.command ?? "");
  return null;
}

const input = await readHookInput(process.stdin);
const reason = input ? refusal(input) : null;
if (reason) {
  process.stderr.write(
    `Blocked by .claude/hooks/guard-secrets.mjs: ${reason}\nAsk the owner if this file really needs a change.\n`,
  );
  process.exit(2);
}
process.exit(0);
