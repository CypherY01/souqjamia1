---
name: task-start
description: Start-of-session routine before any Phase 1 task. Checks the branch and working tree, checks that CI is green on the latest main, reads CLAUDE.md and the status table and next-session notes in plan/phase-1.md, then reports the next task to the owner in Arabic and waits. Read only.
disable-model-invocation: true
---

# /task-start

Run this before any task (owner rule: one task per session). **Read only**: this skill creates no branch, writes no file and commits nothing. Every message to the owner is in Arabic.

Stop at the first failed check, tell the owner what failed and what you saw, and wait. Never guess a result you could not read.

## 1. Branch and working tree

- `git branch --show-current` and `git status --short`.
- Expect `main` with a clean tree. Otherwise stop and report: the branch name, or the changed files (names only). Never stash, reset, switch branches or delete anything to make the check pass.

## 2. main is current

- `git fetch origin` (never `--depth`: it makes the clone shallow).
- `git rev-parse main` must equal `git rev-parse origin/main`. If main is behind, report it and ask before `git pull --ff-only`. If it is ahead or has diverged, stop.

## 3. CI is green on that commit

`gh` is not installed. Ask the GitHub API from the **PowerShell** tool (the Bash tool's `curl` has no network here):

```powershell
$r = Invoke-RestMethod -Uri "https://api.github.com/repos/CypherY01/souqjamia1/commits/main/check-runs?per_page=50" -Headers @{ "User-Agent" = "task-start-check"; "Accept" = "application/vnd.github+json" }
"$($r.total_count) runs"; $r.check_runs | ForEach-Object { "$($_.name): $($_.status)/$($_.conclusion) @ $($_.head_sha.Substring(0,7))" }
```

- Every run must be `completed/success` and its `head_sha` must equal `origin/main`.
- The four jobs of `.github/workflows/ci.yml` must all be there: Lint, types, tests, contract, build / Integration / E2E / Secret scan. A missing job is not a success.
- A run still in progress: say so and stop (do not poll in a loop). A failure: give the job name and stop.
- If the API refuses or fails (rate limit, private repository): say so and ask the owner to check the Actions page. Never call CI green without reading it.

## 4. Read the project memory

- `CLAUDE.md` is already loaded at session start. Re-read only what the next task touches.
- In `plan/phase-1.md`, read only two sections (owner rule 9 about saving context): find the `## ` headings with Grep (`-n`), then Read each range with `offset`/`limit`:
  - `## حالة المهام` (the status table).
  - `## ملاحظات للجلسة القادمة`.
- Never read `docs/spec-v3-en.md` or `docs/addendum-v3.1.md` in full. Grep them only for the next task's IDs, and only after the owner picks the task.

## 5. Next task

From the notes and the table, name:

- the next task and its section in `plan/phase-1.md`;
- whether its details file `plan/task-<n>.md` exists (it comes first and needs approval before any code);
- the next free DEC number (the last DEC in `docs/addendum-v3.1.md`, found with Grep);
- any open item or owner condition the notes mention for it.

## 6. Report and wait

Send the owner a short Arabic report:

- branch and tree: clean or not;
- main: the commit hash, and whether it matches origin;
- CI: each job and its result;
- the next task, its details-file state, and the next DEC.

Then wait. Do not create the task branch or write any file until the owner approves explicitly.
