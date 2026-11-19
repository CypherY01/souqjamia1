// Stored enumerations, Phase 1 values (task 2.1). One list per database enum type in
// packages/db/supabase/migrations/20261119090100_enums.sql, named after its contract schema.
// tests/unit/enums.test.ts (against contracts/) and tests/integration/enums.test.ts (against the
// database) fail on any difference, so a change touches all three together (DEC48).

export const CategoryKey = [
  "books_study",
  "electronics",
  "room_furniture",
  "university_supplies",
  "clothing_personal",
  "vehicles",
  "other",
] as const;
export type CategoryKey = (typeof CategoryKey)[number];

export const Condition = ["new_boxed", "like_new", "good", "fair", "used"] as const;
export type Condition = (typeof Condition)[number];

export const ListingStatus = ["active", "sold", "archived"] as const;
export type ListingStatus = (typeof ListingStatus)[number];

export const ArchiveReason = ["owner", "sold_auto", "account_deletion"] as const;
export type ArchiveReason = (typeof ArchiveReason)[number];

export const WantedStatus = ["active", "found", "closed"] as const;
export type WantedStatus = (typeof WantedStatus)[number];

/** DEC61 adds account_deletion. */
export const WantedClosedReason = ["owner", "expired", "account_deletion"] as const;
export type WantedClosedReason = (typeof WantedClosedReason)[number];

export const OfferStatus = [
  "pending",
  "accepted",
  "rejected",
  "withdrawn",
  "expired",
  "cancelled",
] as const;
export type OfferStatus = (typeof OfferStatus)[number];

/** DEC39 adds account_restricted. */
export const OfferCancelReason = [
  "context_closed",
  "price_changed",
  "made_free_or_fixed",
  "blocked",
  "account_restricted",
] as const;
export type OfferCancelReason = (typeof OfferCancelReason)[number];

export const OfferReferenceKind = ["listing_price", "wanted_budget"] as const;
export type OfferReferenceKind = (typeof OfferReferenceKind)[number];

export const MeetupStatus = ["proposed", "accepted", "rejected", "cancelled", "expired"] as const;
export type MeetupStatus = (typeof MeetupStatus)[number];

/** DEC39. by_proposer and by_recipient are derived from the caller by the server. */
export const MeetupCancelReason = [
  "by_proposer",
  "by_recipient",
  "blocked",
  "account_restricted",
] as const;
export type MeetupCancelReason = (typeof MeetupCancelReason)[number];

export const MessageType = ["text", "image", "offer", "meetup", "system"] as const;
export type MessageType = (typeof MessageType)[number];

/** Phase 1 states only (DEC33). */
export const DealStatus = ["pending", "completed", "cancelled"] as const;
export type DealStatus = (typeof DealStatus)[number];

/** No blocked: a member block does not cancel a deal (DEC39). */
export const DealCancelReason = ["by_seller", "by_buyer", "timeout", "account_restricted"] as const;
export type DealCancelReason = (typeof DealCancelReason)[number];

export const ReportTargetType = [
  "listing",
  "wanted",
  "conversation",
  "message",
  "review",
  "user",
] as const;
export type ReportTargetType = (typeof ReportTargetType)[number];

export const ReportReason = [
  "inappropriate_content",
  "fraud",
  "illegal_goods",
  "harassment",
  "spam",
  "misleading_price",
  "other",
] as const;
export type ReportReason = (typeof ReportReason)[number];

export const ReportStatus = ["received", "in_review", "actioned", "dismissed"] as const;
export type ReportStatus = (typeof ReportStatus)[number];

/** ban is for the owner role only (section 6.2). */
export const ReportDecision = [
  "dismiss",
  "warn",
  "hide_content",
  "suspend_7d",
  "suspend_30d",
  "ban",
] as const;
export type ReportDecision = (typeof ReportDecision)[number];

export const ModerationAction = [
  "warning",
  "hide_content",
  "unhide_content",
  "suspend",
  "unsuspend",
  "ban",
  "unban",
  "revoke_badge",
  "reset_display_name",
  "remove_avatar",
] as const;
export type ModerationAction = (typeof ModerationAction)[number];

/** DEC29. */
export const Role = ["owner", "moderator"] as const;
export type Role = (typeof Role)[number];

export const AccountStatus = ["active", "suspended", "banned"] as const;
export type AccountStatus = (typeof AccountStatus)[number];

/** Arabic only in Phase 1 (DEC30, DEC51). */
export const Locale = ["ar"] as const;
export type Locale = (typeof Locale)[number];

export const PolicyType = ["terms", "privacy"] as const;
export type PolicyType = (typeof PolicyType)[number];

export const MediaPurpose = ["listing", "chat", "avatar", "student_card"] as const;
export type MediaPurpose = (typeof MediaPurpose)[number];

export const MediaStatus = [
  "pending",
  "uploaded",
  "processing",
  "ready",
  "rejected",
  "deleted",
] as const;
export type MediaStatus = (typeof MediaStatus)[number];

export const MediaVariant = ["master", "w150", "w600", "w1200"] as const;
export type MediaVariant = (typeof MediaVariant)[number];

export const MediaVisibility = ["private", "public"] as const;
export type MediaVisibility = (typeof MediaVisibility)[number];

export const MediaRejectionReason = [
  "unsupported_type",
  "too_large",
  "too_many_pixels",
  "animated",
  "corrupt",
  "processing_failed",
] as const;
export type MediaRejectionReason = (typeof MediaRejectionReason)[number];

/** DEC28. */
export const MeetingPointKind = ["campus", "city"] as const;
export type MeetingPointKind = (typeof MeetingPointKind)[number];

/** expired means unreviewed for 30 days only (DEC45). */
export const StudentVerificationStatus = [
  "pending",
  "approved",
  "rejected",
  "expired",
  "revoked",
] as const;
export type StudentVerificationStatus = (typeof StudentVerificationStatus)[number];

export const StudentVerificationReason = [
  "unclear_image",
  "expired_card",
  "not_student_card",
  "name_mismatch",
  "other",
] as const;
export type StudentVerificationReason = (typeof StudentVerificationReason)[number];

export const IdempotencyState = ["processing", "succeeded", "failed"] as const;
export type IdempotencyState = (typeof IdempotencyState)[number];

export const NotificationContextType = [
  "conversation",
  "offer",
  "meetup",
  "deal",
  "review",
  "report",
  "listing",
  "wanted",
  "account",
  "student_verification",
] as const;
export type NotificationContextType = (typeof NotificationContextType)[number];

/** Background job states (task 2.4). Not in the contract. */
export const JobStatus = ["queued", "running", "done", "dead"] as const;
export type JobStatus = (typeof JobStatus)[number];
