# CLAUDE.md — سوق الجامعة (Souq Al-Jamia)

Project memory for Claude Code. Read this first in every session.

## What we are building

An Arabic-first, responsive web marketplace where university students **and other residents of the same city** list items for sale, post "wanted" requests, chat, negotiate a price and arrange where to meet. Payment and handover happen **outside the site** (cash or bank transfer between the parties). The site never processes item payments: no cart, wallet, escrow or shipping.

- Product name: **سوق الجامعة**. Domain: **souqjamia1.com**.
- Never put the name or logo of any real university in the UI, seed data, copy or tests.
- Owner: Mohammed. Any open product question goes to the owner. Don't resolve it by guessing.

## Sources of truth (in order of precedence)

1. **`docs/addendum-v3.1.md`** (Arabic): owner decisions DEC25–DEC69, phase scope, new APIs (API107–API119), new tests (TC85–TC87), fixes. **Wins over everything below.**
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
- Database baseline (task 2.1, rules in `packages/db/README.md`): roles `souq_web` (Next.js) and `souq_worker` (worker) own nothing and have no table privileges. Every app entry point is `security definer` owned by `postgres`, with `set search_path = ''` and schema-qualified names, granted to exactly one of the two roles; internal helpers get no grant. Identity: the server verifies the JWT signature first (`getClaims`), then `set_config('request.jwt.claims', <claims>, true)`; functions read it with `app.actor_id()`. Time comes only from `app.app_now()`. Contract errors: `app.raise_api_error('CODE')` (SQLSTATE `SJ001`). `tests/integration/_harness/security.ts` fails on any table without RLS, any direct write privilege, any open SECURITY DEFINER or app function, and any object in `public` or `app` not owned by `postgres`.
- Identity (task 2.2, `packages/db/README.md`): `profile.id` is the auth user id; nothing cascades from `auth.users` (RET06). Member write functions start with `app.assert_active_member()`. `profile.hidden_from_public` is derived from `account_control` by trigger only. Every SELECT grant lists its columns; RLS helpers live in schema `rls` (SECURITY INVOKER, read only). A signup needs `data.display_name` (2-50 after NFC and trim, `parseDisplayName` in `@souq/domain`).
- Reference data (task 2.3): the seven categories are in the migration; colleges, meeting points and `draft-1` policy versions are local fixtures in `packages/db/supabase/seed.sql`. Used values are deactivated (`is_active`), never deleted. Adding a category: `ops/runbooks/reference-data.md`.
- Write-function tools (task 2.4, `packages/db/README.md`): `app.idempotency_claim`/`app.idempotency_complete` in the business transaction; success quotas with `app.rate_limit_take` in the same transaction; failure and attempt counters (DEC70: RL01, RL14...) with `app.rate_limit_hit` called by the server on a separate connection after the attempt; `app.audit` (append-only; only `app.purge_audit_events` for `souq_worker` deletes rows older than 730 days); `app.enqueue_job` and `app.notify` with dedupe keys. Internal tables live in schema `app`.
- Background jobs (task 2.5, `packages/db/README.md`): the worker claims with `app.claim_jobs` (SKIP LOCKED, its own kinds only, 5-minute lease, attempt counted at claim), and `app.complete_job`/`app.fail_job` are fenced by the attempt number. Retries after 1, 5, 15, then 60 minutes; the tenth failure is `dead` and logs `job.dead` (OPS03). **Delivery is at least once (DEC71): every handler must be idempotent**, so database effects go through app functions that deduplicate or check state, and outside calls send `context.idempotencyKey`. A new job kind: `apps/worker/src/jobs/<kind>.ts` with `defineJob`, listed in `registry.ts` (recurring ones in `scheduler.ts`); `tests/unit/worker-registry.test.ts` fails on a queued kind without a handler. The worker connects with `DATABASE_URL` as `souq_worker` and refuses any other role; `pnpm env:local` sets that role's local password, and `pnpm db:reset` clears it.
- Server identity and database (task 3.1, `plan/task-3.1.md`): session cookies are written by `apps/web/lib/supabase/server.ts` with our attributes (HttpOnly, Secure, SameSite=Lax, 30 days): no refresh token ever reaches browser JavaScript. `proxy.ts` refreshes an expired token; route handlers verify again with `await api.identity()` (never trust a header from the proxy), pages with `pageSession()`/`requireMemberPage()` from `lib/auth/page.ts`. Guard reads with `requireSession`/`requireMember` from `lib/auth/guards.ts` (the `x-access` levels; `recovery`, `member_reauth` and the staff levels come with tasks 3.4, 3.6 and 7.1). A session without `password` in `amr` is limited (DEC73: a recovery link gives `otp` only), refused with `RECOVERY_SESSION_ONLY` by the guards and by `app.assert_active_member()`; review DEC73 before adding any sign-in without a password. Run database work with `appDb().withActor(identity.claims, traceId, async (tx) => ...)` as `souq_web` (`DATABASE_URL` of the web app): claims and trace id for that transaction only, errors already mapped to `ApiError` (`lib/db/errors.ts`; register a unique constraint that is a contract error in `UNIQUE_CONSTRAINT_ERRORS`). **DEC72: `40001` and `40P01` rerun the whole body up to three times, so a body does everything through `tx`, with the same inputs and Idempotency-Key, and nothing outside the transaction.** Failure counters: `rateLimitCheck`/`rateLimitHit` with `fingerprint()` from `lib/http/rate-limit.ts` (key purpose `rate-limit`), outside `withActor`. A trigger function that reads a table is `security definer` with no grant: a deferred trigger runs at commit as `souq_web`. `pnpm env:local` sets the `souq_web` password too.
- Signup and auth flows (task 3.2, `plan/task-3.2.md`): every login identity is created with the current `terms_version` and `privacy_version` (and optional `college_id`) in its user data, or the signup trigger refuses it; tests use `signupData()` from `tests/integration/_harness/users.ts`. The flows live in `apps/web/lib/auth/{signup,confirm,policies}.ts` as framework-free functions taking an `AuthFlowContext`; call Supabase Auth with `createRequestAuthClient` (`lib/supabase/server.ts`, a per-request cookie jar, 10-second timeout) and map its errors with `classifyAuthError`. Attempt limits counted before the call: `countAttempt` (`lib/http/rate-limit.ts`) with `signupLimits`/`emailLimits` (`lib/auth/limits.ts`): RL02 5/hour per guest and `SIGNUP_IP_LIMIT_PER_HOUR` (300) per address (DEC74), RL03 1/minute, 3/hour, 10/day per address, shared by recovery (3.4) and email change (3.6). Browser forms call `/api/*` through `api.request()` from `lib/client/api.ts` (CSRF token in memory, one retry after `CSRF_FAILED`; `api.resetCsrfToken()` after signup, login, logout). Turnstile: `components/auth/Turnstile.tsx` with `NEXT_PUBLIC_TURNSTILE_SITE_KEY` passed from the server page (Cloudflare's test key locally and in CI). Pages under `/auth/` send `Referrer-Policy: no-referrer` and `Cache-Control: no-store` (proxy). E2E runs against local Supabase (`pnpm db:start`, `pnpm env:local`) on ports 3100 (confirmation off) and 3102 (on). `notFound()` and `redirect()` in a page under `app/loading.tsx` keep status 200 after streaming: test what the visitor sees.
- Server reads and the account (task 3.5, `plan/task-3.5.md`, DEC77, DEC78): the server reads the database only through read functions in `app` (STABLE, `security definer`, one server role), never PostgREST. A read function returns named columns (`returns table (...)`), never a whole row, `select *`, `alias.*` or `to_jsonb(row)`; it checks visibility with the same `rls.*` helpers as the policies; and it is registered in `tests/integration/_harness/read-matrix.ts` with a third-party and a guest test whose titles appear literally in an integration test, or the comprehensive check fails. Name the columns in server queries too. RLS stays on every table for browser reads and Realtime. API015 is `loadAccount()` (`lib/account/me.ts`, `app.me()`, guard `requireIdentity`); API016 is `updateProfile()` (`lib/account/profile.ts`) with `expected_version` and DEC78 (10 edits per member per hour). E2E runs with `TURNSTILE_STUB=true` (local stand-in for the widget, refused with `APP_ENV=production`); the owner's review uses the real widget.
- Credentials (task 3.6, `plan/task-3.6.md`, DEC79, DEC80): `member_reauth` is `requireMemberReauth` (a password entry in `amr` within 5 minutes, DEC38, else `REAUTH_REQUIRED`). Supabase Auth cannot renew `amr` in a session and its password sign-in needs Turnstile, so API009 and API022 check the password with `freshSignIn` (`lib/auth/reauth.ts`: the login's RL01 counters, a new session) and swap the browser to that session with `replaceSessionCookies`, which renews the CSRF token (Next.js appends the route's Set-Cookie after the proxy's). API022 is member level with `captcha_token`. DEC79: email confirmation off means Supabase completes an email change with one link, so the trigger `app.guard_email_change()` on `auth.users` (fires only when `email` changes) refuses any email change without both links recorded by `app.confirm_email_change_link()` (API021); completion revokes every session (BR23). DEC80: no other email change, not even by staff; an administrative change needs its own procedure and a new owner decision. The trigger relies on Supabase-managed columns: on every Supabase upgrade follow `ops/runbooks/supabase-upgrade.md`.
- Account deletion (task 3.7, `plan/task-3.7.md`, DEC41, DEC81): the request is `account_control.deletion_requested_at` (its trigger hides the profile); every public read of later tasks must leave out `profile.hidden_from_public` owners. API026 is `requireAccountReauth` (`account_reauth`: `member_reauth` without the current-terms condition, DEC81; a restricted account is refused and pointed to `CONTACT_EMAIL`). `app.request_account_deletion()` commits first, then the server revokes every session at Supabase Auth; the guards refuse the old sessions from the commit on. DEC39: `app.cancel_pending_for_account(user_id, 'account_restricted')` is empty now; tasks 5.5, 5.6 and 6.1 replace it with their cancellations, 7.4 calls it. The recovery link is Supabase's sign-in link (`magic_link` template, `signInWithOtp` with `shouldCreateUser: false`, only for an account `app.deletion_recovery_pending()` accepts) and shares one slot with the recovery link; API028 verifies it in a request cookie jar, runs `app.recover_account_deletion()` on that limited session and signs it out: it never reaches the browser. The 30 days are `app.deletion_deadline()` with `app.app_now()`. SEC11: the required "deletion requested" email is built in task 3.8 (owner condition).
- Notifications (task 3.8, `plan/task-3.8.md`, `packages/db/README.md`): create them only with `app.notify(recipient, event_type, context_type, context_id, dedupe_key)` in the business transaction. Every event type is a row of `app.notification_event` (its email channel: `required`, one of the five optional groups, or `none`) added by the task's migration, with the same entry in `NOTIFICATION_EVENTS` (`@souq/domain`), its in-app text in `packages/i18n/src/ar/notifications.json` and its destination in `apps/web/lib/notifications/events.ts`; a `required` event also needs its email in `packages/email/src/notifications.ts`. A new notification of an emailed event queues one `email.send` job (no `notify.dispatch`); the worker reads the address, the account state and the preferences at send time with `app.notification_email()`, renders fixed text only (BR38: email never carries member text, and optional email only says something changed and opens `/notifications`), ends every email with the DEC65 line, and sends with the idempotency key `email/<notification id>` (DEC71). Required email reaches any account state, awaiting deletion included; optional email only an active account with its group on (all off by default, DEC49, DEC65). The worker sends through Mailpit's HTTP API locally and in CI (`EMAIL_TRANSPORT=mailpit`, refused in production) and Resend from cost stage 1. Fixture addresses are on `souqjamia1.test` only, never a real or personal mailbox.
- Turnstile in E2E and the hydration guard (task 4.0, `plan/task-4.0.md`, DEC82): E2E runs against local Supabase without Auth's Turnstile check (`pnpm db:e2e`; CI sets `SUPABASE_AUTH_CAPTCHA_ENABLED=false` on the e2e job only), with `APP_ENV=test` (accepted with a localhost `APP_ORIGIN` only). At start-up the web app (`instrumentation.ts`) and the worker ask Supabase Auth with `probeAuthCaptcha` (`@souq/domain`, a sign-in without a token) and exit 1 unless the check is on or `APP_ENV=test`; `tests/e2e/global-setup.ts` refuses a stack that verifies and the integration setup refuses one that does not, so run `pnpm db:restart` after E2E. DEC52 stays tested against the real check in the integration tests. A form that JavaScript sends is `method="post"` with a `SubmitButton` (`components/ui/SubmitButton.tsx`): disabled with «جارٍ التحميل» until React hydrates (`useHydrated`, `lib/client/use-hydrated.ts`), as are the `Disclosure` buttons; the root layout's `<noscript>` explains them. `tests/unit/forms.test.ts` and `tests/e2e/no-js.spec.ts` enforce it; a form that works without JavaScript (the header search) keeps a plain `Button`.
- Images (task 4.1, `plan/task-4.1.md`, DEC83, `packages/db/README.md`): API037 to API040 in `apps/web/lib/media/uploads.ts`; Storage only through signed links made after the database decides (`lib/media/storage.ts`, `SUPABASE_SECRET_KEY`, server-only, for the web app and the worker). Buckets `quarantine` (raw, private, 5 MiB), `media-private` (masters and variants of every purpose) and `media-public` (empty until 4.2 and 4.7); no policy on `storage.objects`. DEC83: Storage's upload token lives two hours, so our five minutes are API038's deadline and the raw file stays until the token expires (`media.cleanup`, hourly). `image.process` (two at a time, `concurrency` in `defineJob`) checks the real bytes (the type must equal the declared one, 24,000,000 pixels, no animation), applies orientation, strips all metadata and writes WebP files at fixed keys `<media_id>/<variant>.webp`; a third failed attempt is `processing_failed`. A student card keeps the master only and has no preview (DEC45, DEC83). Limits live in the migration and `packages/domain/src/media.ts` (a test compares them). A task that attaches an image sets `expires_at` to null after checking owner, purpose, context and `ready`; public copies are made only after the publication commits. Test images are built at run time (`tests/fixtures/images/`); `tests/integration/_harness/storage.ts` runs the real routes and jobs. E2E starts a worker too.
- Listings (task 4.2, `plan/task-4.2.md`, `packages/db/README.md`): API034 is `publishListing()` (`lib/listings/publish.ts`) over `app.publish_listing`, with the `Idempotency-Key` read by `idempotencyKey(request)` (`lib/http/idempotency.ts`; 201 new, 200 replay). The function checks everything again (RL05 per hour and day, 200 active listings under the seller's lock, media owner, purpose and `ready`) and returns field codes such as `media_ids.<n>`, which the wizard maps back to their step with `firstStepOf` (`@souq/domain`, section 6.3). `listing.search_text` is a generated column from `app.search_normalize` with a pg_trgm GIN index (extension in schema `extensions`, DEC67). Public image copies come only from the worker's `media.publish` after the commit (w150, w600, w1200, never the master, SEC08); a listing can be shown before they exist, so build image URLs with `publicImageUrl` (`lib/media/public.ts`) only when `public_ready`, and show «الصور قيد التجهيز» otherwise (task 4.3). The `/sell` draft lives in `sessionStorage` only (`lib/client/sell-draft.ts`, FR60, DEC07); `clearSellDraft()` runs after every `api.resetCsrfToken()` (logout, login, signup, deletion, TC82). Read browser storage in a lazy `useState` inside a component mounted after `useHydrated()`: React 19's lint forbids setState in an effect. A server page cannot call a function exported from a `"use client"` module. Integration tests never add meeting points or colleges (`reference-data.test.ts` counts the seed rows): deactivate seed rows and restore them.
- No market writes until the member has acknowledged the current terms and privacy versions. Turnstile CAPTCHA and Supabase Auth's built-in rate limits stay on every operation that takes `captcha_token` (DEC36, DEC52); our server also enforces RL02 for signup (DEC74). API119 acknowledges new versions after signup (DEC69).
- All auth email links are valid for **1 hour** and single-use (DEC37).
- JWT lifetime is 10 minutes. Admin (8 h / 30 min idle), recovery (5 min) and reauthentication (5 min) limits are enforced in Next.js from the `aal` and `amr` claims and their timestamps (DEC38).
- Never trust client-sent `seller_id`, `buyer_id`, `role`, `status`, badge or rating fields. Derive them on the server.
- `service_role` key: worker and server-only code. **Never in the browser bundle.**
- Every browser mutation carries CSRF protection and an Origin check (SEC05). No state change on GET. `apps/web/proxy.ts` (Next.js 16's name for Middleware) enforces this for every path: exact `Origin`, `Sec-Fetch-Site: same-origin` when sent, and `X-CSRF-Token` from `/api/csrf`, signed and bound to the guest cookie or to the verified member's `session_id` (task 3.1).
- **No Server Actions.** Mutations go through `/api/*` route handlers from the contract, called with `fetch` and the CSRF token. The signup, login and logout handlers call `rotateGuestBinding()` (owner condition on task 1.6), email and password changes renew the token too (task 3.6), and the UI fetches a new token afterwards.
- Every route handler is wrapped: `export const GET = apiHandler("/api/route/[id]", async (request, context, api) => ok(data));` (`api.traceId`, `api.identity()`) from `apps/web/lib/http/`. Throw `ApiError("CODE")` for contract errors; anything else becomes 500 `INTERNAL_ERROR` with only the trace id. Read bodies with `readJson(request, z.strictObject({...}))` (128 KiB, unknown fields rejected). Page with `encodeCursor`/`decodeCursor`/`parseLimit`. Client addresses come from `clientIp()` only.
- Log with `log` from `@souq/log` (`packages/log`, shared by the web app and the worker), never `console` directly, and never log request bodies, cookies or headers. It masks tokens, JWTs, keys and auth links, but do not rely on that: don't pass them.
- No `style` attributes in markup: the CSP blocks them. Use CSS Modules.
- Server secrets (`APP_SECRET`, `PROBE_TOKEN`) are described in `ops/runbooks/secrets.md`. Keys are derived from `APP_SECRET` with HKDF, one purpose name each (`csrf`, `cursor`).
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

Saving context (owner rule, 20 November 2026):

8. **One task per session.** A session starts by reading the notes (the status table and «ملاحظات للجلسة القادمة» in `plan/phase-1.md`) and ends with the merge and updated notes.
9. **Never read `docs/spec-v3-en.md` in full, nor the addendum.** Search them (grep) for the IDs and terms the task needs, and read only those sections.
10. **Test, build and CI output:** show the failures and the summary only, never the full log.
11. **Use subagents** for broad reading and for long test suites. They return a summary only.

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
pnpm check:contract-ids      # API001-API119: each in paths once, or in x-phase1-excluded
pnpm check:bundle            # after build: no secrets in browser-facing output (SEC06)
pnpm secrets:scan            # gitleaks over the whole git history, via Docker (SEC06)
pnpm db:start                # local Supabase in Docker (db:stop, db:status, db:reset)
pnpm db:e2e                  # restart it without Auth's Turnstile check, for pnpm test:e2e only (DEC82)
pnpm db:restart              # restart it with the check again (dev, integration, review)
pnpm db:lint                 # plpgsql_check over the app and public functions (needs db:start)
pnpm check:migrations        # merged migrations unchanged, new ones sort last (compares with origin/main)
pnpm check:supabase-images   # running Supabase images match packages/db/supabase/images.lock.json
pnpm env:local               # write apps/web/.env.local and apps/worker/.env.local from it (new local secrets and souq_worker password each run; rerun after db:reset)
pnpm test:integration        # tests against the local stack (needs db:start and db:reset); refuses non-local hosts
pnpm emails:check            # Auth email templates match packages/i18n
```

- Local run and review steps for the owner: `ops/runbooks/local-dev.md`. Local URLs: site 3000, Studio 54323, Mailpit 54324.
- Supabase Auth settings live in `packages/db/supabase/config.toml`; `tests/unit/supabase-config.test.ts` pins the decision values. Email templates are generated from `packages/i18n/src/ar/email.json` with `pnpm --filter @souq/db emails:build`; never edit the HTML by hand.
- Every build goes through `pnpm build`: it checks the `NEXT_PUBLIC_*` values, and the server checks the rest at start-up (OPS05).
- CI (`.github/workflows/ci.yml`) runs all of the above except `env:local`, `db:stop` and `db:reset` on every push, plus actionlint on the workflow. The `integration` job starts local Supabase without Studio, postgres-meta, Realtime, Storage and imgproxy (add them back when a task needs them). Actions are pinned by commit SHA and Docker images by digest; the Supabase CLI pulls by tag, so `check:supabase-images` verifies the digests instead (after a CLI upgrade: full stack, then `pnpm check:supabase-images --write`, then the checks in `ops/runbooks/supabase-upgrade.md`).
- E2E runs `next start` on port 3100 against the last `pnpm build` (through `tests/e2e/web-server.ts`, which copies the server's output to a log file of the run), on Supabase started with `pnpm db:e2e`. Install the browser once with `pnpm --filter @souq/tests exec playwright install --only-shell chromium`. axe-core skips longer Arabic text in its contrast rule (an icon-ligature heuristic), so contrast is guaranteed by the token test, not by axe.
- Never commit a secret-like string, not even in tests: build fake keys at run time (see `tests/unit/check-client-bundle.test.ts`). gitleaks runs over every commit, and GitHub push protection is on.

- Versions live in the `catalog` in `pnpm-workspace.yaml`, pinned exactly. pnpm refuses any release younger than 14 days (`minimumReleaseAge`) and blocks dependency install scripts unless listed in `allowBuilds` (version policy in `plan/task-1.2.md`).
- The worker and the workspace packages are TypeScript run directly by Node (type stripping), so they have no build step. Use only erasable TypeScript syntax (no `enum`, no `namespace`, no constructor parameter properties); `erasableSyntaxOnly` in `tsconfig.base.json` makes `pnpm typecheck` reject them in every package. Write relative imports with the `.ts` extension.
- Migrations live in `packages/db/supabase/migrations` (`<YYYYMMDDHHMMSS>_<snake_case>.sql`); `pnpm db:reset` applies them and `seed.sql` (fixtures from task 2.3). Stored enum values live in three places that tests keep equal: the migration, `packages/domain/src/enums.ts` and the contract.
- Never `git fetch --depth` in the local clone: it makes the repository shallow (`git fetch --unshallow origin` repairs it). Shallow fetches are for CI only.

## Open items (ask the owner, don't assume)

- Developer/team and timeline: not decided.
- Moderator (G09): not assigned. The owner acts as moderator for now.
- Real meeting-point and college lists (G02): use fixtures until the owner provides the CSV.
- Payments (G04): Phase 2.
