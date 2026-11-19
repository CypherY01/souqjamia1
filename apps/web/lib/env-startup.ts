// OPS05, Node.js runtime only: imported by instrumentation.ts when the server process starts.
// A missing or invalid variable stops the server with exit code 1. The log line names the
// variables, never their values (lib/env.ts).
import { log } from "@souq/log";
import { loadServerEnv } from "./env.ts";

export function exitOnInvalidServerEnv(): void {
  try {
    loadServerEnv();
  } catch (error) {
    log.error("env.invalid", {
      message: error instanceof Error ? error.message : "Invalid environment configuration.",
    });
    process.exit(1);
  }
}
