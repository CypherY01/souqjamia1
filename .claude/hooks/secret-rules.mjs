// Shared rules for the Claude Code secret guards (guard-secrets.mjs, check-secrets-after.mjs).
// Secrets must never enter a session: Claude Mem keeps what passes through it.
// .env.example is always allowed, read and write.

const OTHER_SECRET_NAMES = [
  /\.pem$/,
  /\.key$/,
  /\.p12$/,
  /\.pfx$/,
  /^id_(rsa|dsa|ecdsa|ed25519)(\..*)?$/,
  /^credentials\.json$/,
  /^service-account.*\.json$/,
];

/** Last part of a path written with / or \ separators. */
export function baseName(path) {
  const parts = String(path).split(/[\\/]/);
  return parts[parts.length - 1] ?? "";
}

/** .env, .env.local, any .env.<x>, and globs such as .env* — never .env.example. */
export function isEnvFile(path) {
  const name = baseName(path).toLowerCase();
  if (name === ".env.example") return false;
  return name === ".env" || name.startsWith(".env.") || name.startsWith(".env*");
}

/** Env files plus keys, certificates and credential files. */
export function isSecretFile(path) {
  if (isEnvFile(path)) return true;
  const name = baseName(path).toLowerCase();
  return OTHER_SECRET_NAMES.some((pattern) => pattern.test(name));
}

/** Words of a command or glob: split on spaces, quotes, operators and list separators. */
export function tokens(text) {
  return String(text)
    .split(/[\s"'`;|&()<>=,{}:]+/)
    .filter((token) => token.length > 0);
}

/** Drops heredoc bodies (a commit message, for example); the line that opens them stays. */
function stripHeredocs(text) {
  const opener = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g;
  let result = "";
  let index = 0;
  for (;;) {
    opener.lastIndex = index;
    const match = opener.exec(text);
    if (!match) break;
    const bodyStart = text.indexOf("\n", match.index + match[0].length);
    if (bodyStart === -1) break;
    result += text.slice(index, bodyStart + 1);
    const end = new RegExp(`^\\s*${match[2] ?? ""}\\s*$`, "m");
    const rest = text.slice(bodyStart + 1);
    const close = end.exec(rest);
    if (!close) return result;
    index = bodyStart + 1 + close.index + close[0].length;
  }
  return result + text.slice(index);
}

/** Shell segments: separated by &&, ||, ;, | and new lines outside quotes. */
export function segments(command) {
  const text = stripHeredocs(String(command));
  const parts = [];
  let current = "";
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? "";
    if (quote) {
      if (c === "\\" && quote === '"' && text[i + 1] === '"') {
        current += '\\"';
        i++;
        continue;
      }
      current += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      current += c;
      continue;
    }
    const two = text.slice(i, i + 2);
    if (two === "&&" || two === "||") {
      parts.push(current);
      current = "";
      i++;
      continue;
    }
    if (c === ";" || c === "|" || c === "\n") {
      parts.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  parts.push(current);
  return parts.map((segment) => segment.trim()).filter((segment) => segment.length > 0);
}

/** For `git [-C dir] [-c k=v] <sub> args...`: the sub-command and the words after it. */
export function gitCommand(words) {
  for (let i = 1; i < words.length; i++) {
    const word = words[i] ?? "";
    if (word === "-C" || word === "-c") {
      i++;
      continue;
    }
    if (word.startsWith("-")) continue;
    return { sub: word.toLowerCase(), args: words.slice(i + 1) };
  }
  return { sub: "", args: [] };
}

const WRITE_COMMANDS = new Set([
  "tee",
  "cp",
  "mv",
  "rm",
  "del",
  "erase",
  "copy",
  "move",
  "ren",
  "touch",
  "truncate",
  "ln",
  "install",
  "set-content",
  "sc",
  "add-content",
  "ac",
  "out-file",
  "new-item",
  "ni",
  "remove-item",
  "ri",
  "copy-item",
  "cpi",
  "move-item",
  "mi",
  "rename-item",
  "rni",
  "clear-content",
  "clc",
]);

function commandName(word) {
  return baseName(word)
    .toLowerCase()
    .replace(/\.exe$/, "");
}

/** grep -r, rg --hidden/--no-ignore/-u, findstr /s, Select-String with -Recurse: they read ignored .env files. */
function recursiveSearch(segment, allSegments) {
  const words = tokens(segment);
  const name = commandName(words[0] ?? "");
  const flags = words.slice(1);
  if (name === "grep" || name === "egrep" || name === "fgrep") {
    return flags.some(
      (flag) =>
        flag === "--recursive" ||
        flag === "--dereference-recursive" ||
        /^-[A-Za-z]*[rR][A-Za-z]*$/.test(flag) ||
        (flag === "-d" && flags.includes("recurse")),
    );
  }
  if (name === "rg") {
    return flags.some(
      (flag) => flag === "--hidden" || flag.startsWith("--no-ignore") || /^-[A-Za-z]*u/.test(flag),
    );
  }
  if (name === "findstr") return flags.some((flag) => /^\/s$/i.test(flag));
  if (name === "select-string" || name === "sls") {
    return allSegments.some((other) => /(^|\s)-recurse\b/i.test(other));
  }
  return false;
}

/**
 * Returns a reason when a shell command (Bash or PowerShell) must be refused, or null.
 * Git commands are never refused, except `git add -f/--force` naming a secret file.
 */
export function shellRefusal(command) {
  const parts = segments(command);
  for (const segment of parts) {
    const words = tokens(segment);
    const name = commandName(words[0] ?? "");
    const substitutes = segment.includes("$(") || segment.includes("`");

    if (name === "git" && !substitutes) {
      const { sub, args } = gitCommand(words);
      const forcedAdd =
        (sub === "add" || sub === "stage") &&
        args.some((word) => word === "--force" || /^-[A-Za-z]*f[A-Za-z]*$/.test(word));
      const secret = args.find((word) => isSecretFile(word));
      if (forcedAdd && secret) {
        return `git add --force on a secret file (${baseName(secret)}): secret files never enter git.`;
      }
      continue;
    }

    const env = words.find((word) => isEnvFile(word));
    if (env) {
      return `the command touches an env file (${baseName(env)}): secrets must not enter the session (read or write). Only .env.example is allowed.`;
    }

    if (WRITE_COMMANDS.has(name) || (name === "sed" && words.includes("-i"))) {
      const secret = words.slice(1).find((word) => isSecretFile(word));
      if (secret) return `the command writes a secret file (${baseName(secret)}).`;
    }
    for (const match of segment.matchAll(/>{1,2}\s*([^\s;|&>]+)/g)) {
      const target = match[1] ?? "";
      if (isSecretFile(target))
        return `the command redirects output into a secret file (${baseName(target)}).`;
    }

    if (recursiveSearch(segment, parts)) {
      return "a recursive shell search also reads ignored .env files: use the Grep tool, which respects .gitignore.";
    }
  }
  return null;
}

/** Secret-like content (built here as patterns only, never as values). */
export const SECRET_CONTENT = [
  { name: "private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "JWT", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: "Supabase secret key", pattern: /\bsb_secret_[A-Za-z0-9_-]{20,}/ },
  { name: "Resend API key", pattern: /\bre_[A-Za-z0-9]{8}_[A-Za-z0-9]{20,}/ },
  { name: "AWS access key", pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: "GitHub token", pattern: /\b(gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,})/ },
  { name: "Anthropic API key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
];

/** Reads the hook's JSON from stdin; null when it is not valid JSON. */
export async function readHookInput(stdin) {
  let data = "";
  for await (const chunk of stdin) data += String(chunk);
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}
