# CLAUDE.md — سوق الجامعة (Souq Al-Jamia)

Project memory for Claude Code. Read this first in every session.

## What we are building

An Arabic-first, responsive web marketplace where university students **and other residents of the same city** list items for sale, post "wanted" requests, chat, negotiate a price and arrange where to meet. Payment and handover happen **outside the site** (cash or bank transfer between the parties). The site never processes item payments: no cart, wallet, escrow or shipping.

- Product name: **سوق الجامعة**. Domain: **souqjamia1.com**.
- Never put the name or logo of any real university in the UI, seed data, copy or tests.
- Owner: Mohammed. Any open product question goes to the owner. Don't resolve it by guessing.

## Sources of truth (in order of precedence)

1. **`docs/addendum-v3.1.md`** (Arabic): owner decisions DEC25–DEC35, phase scope, new APIs (API107–API118), new tests (TC85–TC87), fixes. **Wins over everything below.**
2. **`docs/spec-v3-en.md`** (English): full specification v3.0. Canonical for identifiers, field names, limits, error codes and tests.
3. The Arabic edition of v3 is **not** in this repo on purpose. It contains hidden U+200E marks and six known translation errors. Never copy values from it.

Rules:
- Keep the spec identifiers (FR, UC, BR, DEC, API, TC, RL, RET, SEC, NFR) in code comments, migration names, test names and PR descriptions, e.g. `// BR33: one pending offer per conversation`.
- If the code needs a decision the docs don't make, or the two docs conflict, **stop and ask**. Don't invent behavior.
- When a limit or rule changes, update the docs, constants, DB constraints and tests together.

## Scope: build Phase 1 only

The addendum's section 3 is the authority. In short:

**Phase 1 (build now):**
- Accounts: signup with any email, email confirmation, login, recovery, profile edit, email/password change, account deletion with a 30-day recovery window.
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
docs            specs (this folder is read-only reference)
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
- Never trust client-sent `seller_id`, `buyer_id`, `role`, `status`, badge or rating fields. Derive them on the server.
- `service_role` key: worker and server-only code. **Never in the browser bundle.**
- Every browser mutation carries CSRF protection and an Origin check (SEC05). No state change on GET.
- Member text is rendered as escaped plain text. Only http/https URLs are linkified, with `rel="noopener noreferrer"`.
- Raw uploads are private and quarantined. The worker verifies real bytes, strips EXIF and generates 150/600/1200 px variants. Chat images and student-card photos are **never public**, and access to them goes through ≤ 60-second signed URLs after an authorization check.
- Never log passwords, tokens, auth links, chat text or card images.

**UI**
- Arabic, **RTL**, built mobile-first and tested at 360, 768 and 1440 px.
- Use CSS logical properties (`margin-inline-start`, not `margin-left`). Isolate numbers, URLs and IDs with `<bdi>` or `dir="ltr"`.
- **No hard-coded UI strings.** Every string goes through `packages/i18n` keys (Arabic only for now).
- Target WCAG 2.2 AA: labels, visible focus, keyboard access, contrast, and never color alone.
- Design tokens are in v3 chapter 02 (dark green `#0B3B2D`, gold accent `#C59B27`, cream surfaces).
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

The feature has Arabic UI with all states, server-side validation and DB constraints, owner and third-party authorization tests, the relevant TC tests passing, an audit record for sensitive/admin actions, and docs/contracts updated if anything changed.

## Commands

_To be filled in once the project is scaffolded (install, dev, test, lint, typecheck, db migrate, db reset, seed)._

## Open items (ask the owner, don't assume)

- Developer/team and timeline: not decided.
- Moderator (G09): not assigned. The owner acts as moderator for now.
- Real meeting-point and college lists (G02): use fixtures until the owner provides the CSV.
- Payments (G04): Phase 2.
