-- Stored enumerations, Phase 1 values (task 2.1, item 7 in plan/task-2.1.md).
-- Sources: "Canonical enumerations" and enum fields in chapter 08 of docs/spec-v3-en.md,
-- section 6.2 of docs/addendum-v3.1.md, DEC28, DEC29, DEC33, DEC39, DEC45, DEC51 and DEC61.
-- Values are identical to packages/domain/src/enums.ts and, where it lists them, the contract:
-- tests/unit/enums.test.ts and tests/integration/enums.test.ts fail on any difference (DEC48).
-- Adding a value later is `alter type ... add value` in a new migration. Removing one needs a
-- new owner decision. Not created: session_scope (AppSession dropped, DEC35), appeal_status,
-- report kind deal_dispute, deal states disputed and voided, payments (Phase 2), and contract
-- lists that are never stored (ListingSort, DisabledReason, ReporterStatus and similar).

-- Market (BR03, BR04, chapter 08, section 6.2)
create type public.category_key as enum (
  'books_study', 'electronics', 'room_furniture', 'university_supplies', 'clothing_personal',
  'vehicles', 'other'
);
create type public.item_condition as enum ('new_boxed', 'like_new', 'good', 'fair', 'used');
create type public.listing_status as enum ('active', 'sold', 'archived');
create type public.archive_reason as enum ('owner', 'sold_auto', 'account_deletion');
create type public.wanted_status as enum ('active', 'found', 'closed');
-- DEC61 adds account_deletion.
create type public.wanted_closed_reason as enum ('owner', 'expired', 'account_deletion');

-- Negotiation (chapter 08, DEC39, DEC44)
create type public.offer_status as enum (
  'pending', 'accepted', 'rejected', 'withdrawn', 'expired', 'cancelled'
);
create type public.offer_cancel_reason as enum (
  'context_closed', 'price_changed', 'made_free_or_fixed', 'blocked', 'account_restricted'
);
create type public.offer_reference_kind as enum ('listing_price', 'wanted_budget');
create type public.meetup_status as enum ('proposed', 'accepted', 'rejected', 'cancelled', 'expired');
create type public.meetup_cancel_reason as enum (
  'by_proposer', 'by_recipient', 'blocked', 'account_restricted'
);
create type public.message_type as enum ('text', 'image', 'offer', 'meetup', 'system');

-- Deals: Phase 1 states only (DEC33); no blocked cancel reason (DEC39 as amended).
create type public.deal_status as enum ('pending', 'completed', 'cancelled');
create type public.deal_cancel_reason as enum ('by_seller', 'by_buyer', 'timeout', 'account_restricted');

-- Safety and moderation (chapter 08, section 6.2)
create type public.report_target_type as enum (
  'listing', 'wanted', 'conversation', 'message', 'review', 'user'
);
create type public.report_reason as enum (
  'inappropriate_content', 'fraud', 'illegal_goods', 'harassment', 'spam', 'misleading_price',
  'other'
);
create type public.report_status as enum ('received', 'in_review', 'actioned', 'dismissed');
-- ban is for the owner role only (section 6.2).
create type public.report_decision as enum (
  'dismiss', 'warn', 'hide_content', 'suspend_7d', 'suspend_30d', 'ban'
);
create type public.moderation_action as enum (
  'warning', 'hide_content', 'unhide_content', 'suspend', 'unsuspend', 'ban', 'unban',
  'revoke_badge', 'reset_display_name', 'remove_avatar'
);

-- Accounts and roles (DEC29, DEC30, DEC51)
create type public.app_role as enum ('owner', 'moderator');
create type public.account_status as enum ('active', 'suspended', 'banned');
-- Arabic only in Phase 1 (DEC51); English is added with Phase 2.
create type public.app_locale as enum ('ar');
create type public.policy_type as enum ('terms', 'privacy');

-- Media (section 6.2, DEC27, DEC45)
create type public.media_purpose as enum ('listing', 'chat', 'avatar', 'student_card');
create type public.media_status as enum (
  'pending', 'uploaded', 'processing', 'ready', 'rejected', 'deleted'
);
create type public.media_variant as enum ('master', 'w150', 'w600', 'w1200');
create type public.media_visibility as enum ('private', 'public');
-- Values chosen by the contract (MediaRejectionReason), approved with task 1.1.
create type public.media_rejection_reason as enum (
  'unsupported_type', 'too_large', 'too_many_pixels', 'animated', 'corrupt', 'processing_failed'
);

-- Reference data (DEC28)
create type public.meeting_point_kind as enum ('campus', 'city');

-- Student badge (section 4.1, DEC45)
create type public.student_verification_status as enum (
  'pending', 'approved', 'rejected', 'expired', 'revoked'
);
create type public.student_verification_reason as enum (
  'unclear_image', 'expired_card', 'not_student_card', 'name_mismatch', 'other'
);

-- Infrastructure (chapter 08)
create type public.idempotency_state as enum ('processing', 'succeeded', 'failed');
-- Values chosen by the contract (NotificationContextType), approved with task 1.1.
create type public.notification_context_type as enum (
  'conversation', 'offer', 'meetup', 'deal', 'review', 'report', 'listing', 'wanted', 'account',
  'student_verification'
);
