# CLAUDE.md — سوق الجامعة (Souq Al-Jamia)

Project memory for Claude Code. Read this first in every session.

## What we are building

An Arabic-first, responsive web marketplace where university students **and other residents of the same city** list items for sale, post "wanted" requests, chat, negotiate a price and arrange where to meet. Payment and handover happen **outside the site** (cash or bank transfer between the parties). The site never processes item payments: no cart, wallet, escrow or shipping.

- Product name: **سوق الجامعة**. Domain: **souqjamia1.com**.
- Never put the name or logo of any real university in the UI, seed data, copy or tests.
- Owner: Mohammed. Any open product question goes to the owner. Don't resolve it by guessing.

## Sources of truth (in order of precedence)

1. **`docs/addendum-v3.1.md`** (Arabic): owner decisions DEC25–DEC66, phase scope, new APIs (API107–API118), new tests (TC85–TC87), fixes. **Wins over everything below.**
2. **`docs/spec-v3-en.md`** (English): full specification v3.0. Canonical for identifiers, field names, limits, error codes and tests.
3. The Arabic edition of v3 is **not** in this repo on purpose. It contains hidden U+200E marks and six known translation errors. Never copy values from it.

Rules:
- Keep the spec identifiers (FR, UC, BR, DEC, API, TC, RL, RET, SEC, NFR) in code comments, migration names, test names and PR descriptions, e.g. `// BR33: one pending offer per conversation`.
- If the code needs a decision the docs don't make, or the two docs conflict, **stop and ask**. Don't invent behavior.
- When a limit or rule changes, first record the owner's decision as a new DEC at the end of the addendum, then update the contract, constants, DB constraints and tests together. Recording owner-approved decisions is the only allowed edit to `docs/` (DEC48).

## Scope: build Phase 1 only

The addendum's section 3 is the authority. In short:

**Phase 1 (build now):**
- Accounts: signup with any email and immediate sign-in (email confirmation is built but switched off by `email_confirmation_required=false`, DEC63), login, recovery, profile edit, email/password change, account deletion with a 30-day recovery window.
- Student badge by request: the member uploads a student-card photo, a moderator approves or rejects it, and the photo is deleted within 24 hours of the decision.
- Discovery: home page, search, filters, sort, listing details, public profile, favorites.
- Listings: 5-step wizard, image upload and processing, owner management. Wanted requests with expiry and one reopening.
- Chat: private messages and images, read state, realtime updates, price offers, meetup proposals (suggested meeting points **or** free-text place).
- Deals (simplified): seller creates, both parties confirm, one review each. No disputes.
- Safety: reports, blocks, admin panel (owner + moderator), warn/hide/suspend/ban, policy pages.
- In-app and email notifications, rate limits, audit log, background jobs, daily backups.

**Phase 2 (do NOT build, do NOT stub UI for):**
- English UI and the language switch.
- Contributions/payments (Moyasar).
- Appeals system.
- Deal disputes and voiding.
- Meetup attendance declarations.
- Legal holds, deletion ledger, coordinated media backups with manifests.
- PWA, Web Push, saved search, request matching, server drafts.

## Cost rule (DEC62)

No paid service and no hosted account before the student trial. Development and every review run locally (local Supabase in Docker, Mailpit, Cloudflare's official Turnstile test keys). Staging comes at cost stage 1, Supabase Pro at public launch (stage 2): leaked-password checks (DEC32), member session limits (DEC38) and daily backups (DEC42) only work after that upgrade. See `plan/cost-plan.md`.

## Stack (addendum section 5 overrides v3 chapter 07)

- **Next.js** (current supported release, App Router, TypeScript strict) on **Railway**, plus one **worker** process on Railway.
- **Supabase**: Postgres, Auth (`@supabase/ssr`, cookies managed server-side), Storage, Realtime (private channels authorized by RLS), MFA (TOTP) for owner and moderator.
- **Resend** as the SMTP sender for Supabase Auth emails and for app notifications.
- **Dropped from v3:** the custom BFF session store (`AppSession`), `AuthFlow` + Send Email Hook, the custom WebSocket server (API065), and the multi-consumer outbox (replaced by a simple jobs table).

Verify current library and framework versions before pinning. Don't rely on memory for versions.

## Repository layout (from v3 chapter 07)

```
apps/web        Next.js UI + route handlers / server actions
apps/worker     image processing, email, expiry jobs, retention purge
packages/domain rules, zod schemas, permissions, state transitions
packages/db     SQL migrations, constraints, RLS policies, Postgres functions, seeds
packages/i18n   Arabic resource keys (structure ready for English later)
tests           unit, integration (DB + RLS), e2e
contracts       approved OpenAPI contract and Realtime contract (task 1.1)
plan            Phase 1 plan, screen inventory, per-task details
ops             runbooks and operational scripts (DEC48)
docs            specs (read-only, except recording owner decisions, DEC48)
```

## Non-negotiable engineering rules

**Data and correctness**
- Money is **integer halalas** (SAR × 100). Listing price 0–5,000,000. Offer 100–5,000,000. Never use floats, and never round silently.
- Timestamps are **UTC `timestamptz`**. Meetups are displayed in **Asia/Riyadh**.
- Text limits are counted in Unicode code points after NFC normalization and trimming. Passwords are never trimmed or normalized: **8–64 chars, ≤ 72 UTF-8 bytes** (DEC32).
- Message order uses the per-conversation `message_seq` (bigint), never UUID order. Read cursors are monotonic.
- Uniqueness and "only one" rules are **DB constraints** (partial unique indexes, CHECKs), not check-then-insert code: one conversation per context and buyer/seller pair, one pending offer per conversation, one non-cancelled deal per listing or wanted request, one review per party per deal.
- State transitions use `expected_version` and return **409** on conflict. Creation endpoints take an `Idempotency-Key`, and messages also take a `client_message_id`.
- Follow the lock order in v3 chapter 07 for messaging, blocking, closure and account enforcement.

**Security**
- Deny by default. RLS is enabled on **every** table.
- `anon` and `authenticated` have **no direct INSERT/UPDATE/DELETE** on business tables. Business writes go through **Postgres functions** called from Next.js server code. Each function re-checks session, ownership, block state and account state.
- Write functions live in the **non-exposed `app` schema**, with EXECUTE revoked from `PUBLIC`, `anon` and `authenticated`. Only Next.js calls them, over a direct Postgres connection with a dedicated role that has no BYPASSRLS, passing the verified identity with transaction-local `set_config`. Quotas, idempotency and state checks stay inside the functions. The browser uses Supabase only for RLS-protected reads and Realtime (DEC36).
- No market writes until the member has acknowledged the current terms and privacy versions. Turnstile CAPTCHA and Supabase Auth's built-in rate limits replace RL02, live from launch on every operation that takes `captcha_token` (DEC36, DEC52).
- All auth email links are valid for **1 hour** and single-use (DEC37).
- JWT lifetime is 10 minutes. Admin (8 h / 30 min idle), recovery (5 min) and reauthentication (5 min) limits are enforced in Next.js from the `aal` and `amr` claims and their timestamps (DEC38).
- Never trust client-sent `seller_id`, `buyer_id`, `role`, `status`, badge or rating fields. Derive them on the server.
- `service_role` key: worker and server-only code. **Never in the browser bundle.**
- Every browser mutation carries CSRF protection and an Origin check (SEC05). No state change on GET.
- Member text is rendered as escaped plain text, always through `SafeText` (`apps/web/components/text/SafeText.tsx`). Only http/https URLs are linkified, with `rel="noopener noreferrer nofollow ugc"`, and bidi control characters are dropped for display (TC31).
- Raw uploads are private and quarantined. The worker verifies real bytes, strips EXIF and generates 150/600/1200 px variants. Chat images and student-card photos are **never public**, and access to them goes through ≤ 60-second signed URLs after an authorization check.
- Never log passwords, tokens, auth links, chat text or card images.

**UI**
- Arabic, **RTL**, built mobile-first and tested at 360, 768 and 1440 px.
- Use CSS logical properties (`margin-inline-start`, not `margin-left`). Isolate numbers, URLs and IDs with `<bdi>` or `dir="ltr"`.
- Numbers are displayed as Western digits (350). Numeric inputs also accept Arabic-Indic digits (٣٥٠), and the server converts them before validation. Member free text is stored as typed (DEC50).
- **No hard-coded UI strings.** Every string goes through `packages/i18n` keys (Arabic only for now).
- Target WCAG 2.2 AA: labels, visible focus, keyboard access, contrast, and never color alone.
- Design tokens are in v3 chapter 02 (dark green `#0B3B2D`, gold accent `#C59B27`, cream surfaces). There is no designer and no mockups: build screens from the tokens and the shared components, following `plan/screens.md` (DEC59).
- Colors, radii, spacing and type sizes come only from `apps/web/app/tokens.css`, as CSS variables in CSS Modules. Controls and every interactive boundary use `--color-control-border` (`#6B7280`); `#E5E7EB` is for decorative dividers only; gold is a background with dark text, never a text color. `tests/unit/design-tokens.test.ts` checks the contrast of every pair in use: add new pairs there.
- Shared components live in `apps/web/components/ui` (buttons, fields, dialog, alerts, badges, states, `Num`/`Money`/`Price`/`DateText`). Add each new one to the `/dev/ui` gallery with all its states; the gallery returns 404 when `APP_ENV=production`.
- Display numbers, money and dates only through the `@souq/i18n` format helpers or the `Display` components: `350 ريال`, `350.50 ريال` when there are halalas, a zero price is `مجاني`, Gregorian dates with Arabic month names, 12-hour time, `Asia/Riyadh`. Parse typed amounts with `parseAmount` from `@souq/domain` (no rounding).
- Strings with placeholders use `t(key, { name: value })`. Format numbers before passing them.
- Never put invisible or bidi control characters in source files; write them as escape sequences. `tests/unit/source-hygiene.test.ts` fails otherwise.
- Every screen has distinct loading, empty, error and retry states.

## How to work in this repo

1. **Plan before code.** For any feature, first list the FR/BR/API/TC IDs it covers and the files you'll touch, then wait for approval.
2. Work one vertical slice at a time: migration, then RLS, then domain logic, then API, then UI, then tests.
3. **Tests are part of done.** Name tests after their TC ID (e.g. `TC43 two pending offers in one conversation`). Cover the owner, an unrelated third account and the unconfirmed/restricted cases.
4. Migrations are forward-only, expand-then-contract, and never edited after they're merged.
5. Seed data uses clearly fake fixtures (e.g. "نقطة لقاء تجريبية 1"). Never use real people or real campus names.
6. Secrets live only in `.env.local` and the hosting dashboards. Keep `.env.example` current with no values. Never commit secrets.
7. Commit small and often, with messages that reference spec IDs.

## Definition of done (per feature)

The feature has Arabic UI with all states, server-side validation and DB constraints, owner and third-party authorization tests, the relevant TC tests passing, an audit record for sensitive/admin actions, and docs/contracts updated if anything changed. Until staging exists (cost stage 1, DEC62), a slice is approved after CI is green and the owner has reviewed it locally with `pnpm dev`, following run steps you give them.

## Commands

Requires Node 26.13.1 (`.nvmrc`) and pnpm 12.17.0. Run from the repository root.

```bash
pnpm install                 # install from pnpm-lock.yaml (CI: --frozen-lockfile)
pnpm dev                     # web app on http://localhost:3000
pnpm dev:worker              # worker, restarts on change
pnpm lint                    # ESLint, zero warnings allowed (also bans JSX text and left/right styles)
pnpm check:css               # CSS files use logical properties only (RTL)
pnpm typecheck               # tsc --noEmit in every package
pnpm test                    # unit tests (Vitest)
pnpm build                   # production build of the web app
pnpm test:e2e                # after build: Playwright + axe at 360, 768 and 1440 px
pnpm format:check            # Prettier check (pnpm format to fix)
pnpm contract:lint           # Redocly lint of contracts/openapi.yaml
pnpm check:contract-ids      # API001-API118: each in paths once, or in x-phase1-excluded
pnpm check:bundle            # after build: no secrets in browser-facing output (SEC06)
pnpm secrets:scan            # gitleaks over the whole git history, via Docker (SEC06)
pnpm db:start                # local Supabase in Docker (db:stop, db:status, db:reset)
pnpm env:local               # write apps/web/.env.local and apps/worker/.env.local from it
pnpm test:integration        # tests against the local stack (needs db:start)
pnpm emails:check            # Auth email templates match packages/i18n
```

- Local run and review steps for the owner: `ops/runbooks/local-dev.md`. Local URLs: site 3000, Studio 54323, Mailpit 54324.
- Supabase Auth settings live in `packages/db/supabase/config.toml`; `tests/unit/supabase-config.test.ts` pins the decision values. Email templates are generated from `packages/i18n/src/ar/email.json` with `pnpm --filter @souq/db emails:build`; never edit the HTML by hand.
- Every build goes through `pnpm build`: it checks the `NEXT_PUBLIC_*` values, and the server checks the rest at start-up (OPS05).
- CI (`.github/workflows/ci.yml`) runs all of the above except the `db:*`, `env:local` and integration commands on every push, plus actionlint on the workflow. Actions are pinned by commit SHA and Docker images by digest.
- E2E runs `next start` on port 3100 against the last `pnpm build`. Install the browser once with `pnpm --filter @souq/tests exec playwright install --only-shell chromium`. axe-core skips longer Arabic text in its contrast rule (an icon-ligature heuristic), so contrast is guaranteed by the token test, not by axe.
- Never commit a secret-like string, not even in tests: build fake keys at run time (see `tests/unit/check-client-bundle.test.ts`). gitleaks runs over every commit, and GitHub push protection is on.

- Versions live in the `catalog` in `pnpm-workspace.yaml`, pinned exactly. pnpm refuses any release younger than 14 days (`minimumReleaseAge`) and blocks dependency install scripts unless listed in `allowBuilds` (version policy in `plan/task-1.2.md`).
- The worker and the workspace packages are TypeScript run directly by Node (type stripping), so they have no build step. Use only erasable TypeScript syntax (no `enum`, no `namespace`, no constructor parameter properties); `erasableSyntaxOnly` in `tsconfig.base.json` makes `pnpm typecheck` reject them in every package. Write relative imports with the `.ts` extension.
- Migrations and seeds arrive with task 2.1 (`packages/db/supabase/migrations`, `seed.sql`); `pnpm db:reset` applies them.

## Open items (ask the owner, don't assume)

- Developer/team and timeline: not decided.
- Moderator (G09): not assigned. The owner acts as moderator for now.
- Real meeting-point and college lists (G02): use fixtures until the owner provides the CSV.
- Payments (G04): Phase 2.
