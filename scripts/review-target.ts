// Task 4.3, owner condition on item 9: the review data script writes to the local Supabase only.
// Both its addresses (the API and the database) must point at this machine by name, exactly
// "localhost" or "127.0.0.1"; anything else stops it before any connection, with this message.
// tests/unit/review-listings.test.ts proves the refusal.

export const REVIEW_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1"]);

export class NotLocalTargetError extends Error {
  override name = "NotLocalTargetError";
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** Throws NotLocalTargetError unless the URL's host is localhost or 127.0.0.1. */
export function assertReviewTarget(url: string, what: string): void {
  const host = hostOf(url);
  if (host === null || !REVIEW_HOSTS.has(host)) {
    throw new NotLocalTargetError(
      `review:listings يعمل على Supabase المحلي فقط (localhost أو 127.0.0.1). ` +
        `${what} يشير إلى ${host ?? "عنوان غير صالح"}، فتوقف السكربت ولم يكتب شيئاً.`,
    );
  }
}
