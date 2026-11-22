// Task 4.0 (item D): starts `next start` for E2E, as `pnpm --filter @souq/web exec next start`
// did, and copies everything the server writes into a log file of this run as well, so
// no-js.spec.ts can check that a form posted before hydration left nothing in the server's log.
// Usage: node tests/e2e/web-server.ts <port> (with E2E_SERVER_LOG_DIR set, playwright.config.ts)
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { REPO_ROOT, serverLogFile } from "./local-env.ts";

const [port] = process.argv.slice(2);
if (port === undefined || !/^[0-9]+$/.test(port)) {
  throw new Error("usage: node tests/e2e/web-server.ts <port>");
}
const logFile = serverLogFile(Number(port));

const webDir = join(REPO_ROOT, "apps", "web");
const nextBin = createRequire(join(webDir, "package.json")).resolve("next/dist/bin/next");
const log = createWriteStream(logFile, { flags: "a" });
const child = spawn(process.execPath, [nextBin, "start", "--port", port], {
  cwd: webDir,
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});

child.stdout.on("data", (chunk: Buffer) => {
  process.stdout.write(chunk);
  log.write(chunk);
});
child.stderr.on("data", (chunk: Buffer) => {
  process.stderr.write(chunk);
  log.write(chunk);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    child.kill(signal);
  });
}

child.once("exit", (code, signal) => {
  log.end(() => {
    process.exit(code ?? (signal === null ? 0 : 1));
  });
});
