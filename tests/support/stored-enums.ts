// Which database type, domain list and contract location belong together (task 2.1, item 7).
import { enums } from "@souq/domain";

export interface StoredEnum {
  /** Enum type in the public schema (20261119090100_enums.sql). */
  db: string;
  values: readonly string[];
  /** Path under components.schemas of the contract, or null when the contract lists no enum. */
  contract: readonly string[] | null;
}

export const STORED_ENUMS: readonly StoredEnum[] = [
  { db: "category_key", values: enums.CategoryKey, contract: ["CategoryKey"] },
  { db: "item_condition", values: enums.Condition, contract: ["Condition"] },
  { db: "listing_status", values: enums.ListingStatus, contract: ["ListingStatus"] },
  { db: "archive_reason", values: enums.ArchiveReason, contract: ["ArchiveReason"] },
  { db: "wanted_status", values: enums.WantedStatus, contract: ["WantedStatus"] },
  {
    db: "wanted_closed_reason",
    values: enums.WantedClosedReason,
    contract: ["WantedClosedReason"],
  },
  { db: "offer_status", values: enums.OfferStatus, contract: ["OfferStatus"] },
  { db: "offer_cancel_reason", values: enums.OfferCancelReason, contract: ["OfferCancelReason"] },
  {
    db: "offer_reference_kind",
    values: enums.OfferReferenceKind,
    contract: ["Offer", "properties", "reference_kind"],
  },
  { db: "meetup_status", values: enums.MeetupStatus, contract: ["MeetupStatus"] },
  {
    db: "meetup_cancel_reason",
    values: enums.MeetupCancelReason,
    contract: ["MeetupCancelReason"],
  },
  { db: "message_type", values: enums.MessageType, contract: ["MessageType"] },
  { db: "deal_status", values: enums.DealStatus, contract: ["DealStatus"] },
  { db: "deal_cancel_reason", values: enums.DealCancelReason, contract: ["DealCancelReason"] },
  { db: "report_target_type", values: enums.ReportTargetType, contract: ["ReportTargetType"] },
  { db: "report_reason", values: enums.ReportReason, contract: ["ReportReason"] },
  { db: "report_status", values: enums.ReportStatus, contract: ["ReportStatus"] },
  { db: "report_decision", values: enums.ReportDecision, contract: ["ReportDecision"] },
  { db: "moderation_action", values: enums.ModerationAction, contract: ["ModerationAction"] },
  { db: "app_role", values: enums.Role, contract: ["Role"] },
  { db: "account_status", values: enums.AccountStatus, contract: ["AccountStatus"] },
  { db: "app_locale", values: enums.Locale, contract: ["Locale"] },
  // The contract names these as object keys (terms and privacy), not as an enum.
  { db: "policy_type", values: enums.PolicyType, contract: null },
  { db: "media_purpose", values: enums.MediaPurpose, contract: ["MediaPurpose"] },
  { db: "media_status", values: enums.MediaStatus, contract: ["MediaStatus"] },
  // Variants appear as object keys (w150, w600, w1200); master is never public.
  { db: "media_variant", values: enums.MediaVariant, contract: null },
  { db: "media_visibility", values: enums.MediaVisibility, contract: null },
  {
    db: "media_rejection_reason",
    values: enums.MediaRejectionReason,
    contract: ["MediaRejectionReason"],
  },
  { db: "meeting_point_kind", values: enums.MeetingPointKind, contract: ["MeetingPointKind"] },
  {
    db: "student_verification_status",
    values: enums.StudentVerificationStatus,
    contract: ["StudentVerificationStatus"],
  },
  {
    db: "student_verification_reason",
    values: enums.StudentVerificationReason,
    contract: ["StudentVerificationReason"],
  },
  { db: "idempotency_state", values: enums.IdempotencyState, contract: null },
  {
    db: "notification_context_type",
    values: enums.NotificationContextType,
    contract: ["NotificationContextType"],
  },
];
