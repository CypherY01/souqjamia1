// DEC35: one background worker process on Railway, next to the web app.
// The job loop, retries and scheduler arrive in task 2.5.
// Node 26 runs this TypeScript file directly (type stripping), so there is no build step.
import { loadWorkerEnv } from "./env.ts";

type LogFields = Readonly<Record<string, string | number | boolean>>;

// One JSON object per line. Never log secrets, tokens, auth links or member content.
function log(level: "info" | "error", event: string, fields: LogFields = {}): void {
  const line = { ts: new Date().toISOString(), level, event, ...fields };
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

// OPS05: refuse to run with a missing or invalid configuration.
let env;
try {
  env = loadWorkerEnv();
} catch (error) {
  log("error", "worker.config_invalid", {
    message: error instanceof Error ? error.message : "Invalid environment configuration.",
  });
  process.exit(1);
}

// Keeps the process alive until a stop signal arrives.
const keepAlive = setInterval(() => undefined, 60_000);
let stopping = false;

function stop(signal: NodeJS.Signals): void {
  if (stopping) return;
  stopping = true;
  clearInterval(keepAlive);
  log("info", "worker.stopped", { signal });
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

log("info", "worker.started", { pid: process.pid, node: process.version, app_env: env.APP_ENV });
