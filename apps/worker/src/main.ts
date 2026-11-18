// DEC35: one background worker process on Railway, next to the web app.
// The job loop, retries and scheduler arrive in task 2.5.
// Node 26 runs this TypeScript file directly (type stripping), so there is no build step.

type LogFields = Readonly<Record<string, string | number | boolean>>;

// One JSON object per line. Never log secrets, tokens, auth links or member content.
function log(event: string, fields: LogFields = {}): void {
  const line = { ts: new Date().toISOString(), level: "info", event, ...fields };
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

// Keeps the process alive until a stop signal arrives.
const keepAlive = setInterval(() => undefined, 60_000);
let stopping = false;

function stop(signal: NodeJS.Signals): void {
  if (stopping) return;
  stopping = true;
  clearInterval(keepAlive);
  log("worker.stopped", { signal });
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

log("worker.started", { pid: process.pid, node: process.version });
