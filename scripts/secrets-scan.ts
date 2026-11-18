// SEC06: scan the whole git history for secrets with gitleaks (task 1.3).
// CI and local runs use this same image, pinned by digest. Requires Docker.
// Findings are redacted: gitleaks prints the file, commit and rule, never the secret itself.
import { spawnSync } from "node:child_process";

// gitleaks v8.30.1 (2026-03-21), multi-arch index digest.
export const GITLEAKS_IMAGE =
  "zricethezav/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f";

if (import.meta.main) {
  const repo = process.cwd();
  const args = [
    "run",
    "--rm",
    "-v",
    `${repo}:/repo:ro`,
    GITLEAKS_IMAGE,
    "git",
    "/repo",
    "--config",
    "/repo/.gitleaks.toml",
    "--redact",
    "--no-banner",
    "--exit-code",
    "1",
  ];
  const result = spawnSync("docker", args, { stdio: "inherit" });
  if (result.error) {
    console.error(`secrets:scan: could not start Docker (${result.error.message}).`);
    process.exitCode = 1;
  } else {
    process.exitCode = result.status ?? 1;
  }
}
