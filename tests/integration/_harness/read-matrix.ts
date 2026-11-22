// DEC77 (task 3.5): the read-permission matrix. A read function is a STABLE or IMMUTABLE function
// in app that a server role may execute: the server reads through these, never as
// authenticated. Each one is listed here with the integration tests that prove what a third
// party and a guest get from it. securityViolations() (security.ts) fails on a read function
// missing here, on an entry whose test is not found, and on an entry for a function that is gone.
//
// A test is found when an integration test file under tests/integration contains its title as
// a quoted string, so write each title literally in it("...") (no template or it.each title).
// The key is the signature as the check prints it: app.name(type, type).

export interface ReadFunctionTests {
  /** What the function returns, and to whom. */
  reads: string;
  /** Title of the test proving a third party never reads another member's data through it. */
  thirdParty: string;
  /** Title of the test proving what a guest (no identity) gets from it. */
  guest: string;
}

export const READ_MATRIX: Readonly<Record<string, ReadFunctionTests>> = {
  "app.me()": {
    reads: "API015: the private account fields of the session's own member (task 3.5)",
    thirdParty: "DEC77 app.me(): another member's session reads only its own account",
    guest: "DEC77 app.me(): a guest is UNAUTHENTICATED",
  },
  "app.session_context()": {
    reads: "the live session and account state of the session's own member (task 3.1)",
    thirdParty: "DEC77 app.session_context(): another member's session reads only its own state",
    guest: "DEC77 app.session_context(): a guest is UNAUTHENTICATED",
  },
  "app.current_policies()": {
    reads: "API114: the policy versions in force, public (task 3.2)",
    thirdParty: "DEC77 app.current_policies(): a member gets the same public rows as a guest",
    guest: "DEC77 app.current_policies(): a guest reads the versions in force",
  },
  "app.active_colleges()": {
    reads: "the active colleges for pick lists, public (task 3.2)",
    thirdParty: "DEC77 app.active_colleges(): a member gets the same public rows as a guest",
    guest: "DEC77 app.active_colleges(): a guest reads the active colleges only",
  },
  "app.job_queue_health()": {
    reads: "two queue counts for /readyz, no member data (task 2.5)",
    thirdParty: "DEC77 app.job_queue_health(): a member's identity changes nothing",
    guest: "DEC77 app.job_queue_health(): a guest reads two counts only",
  },
  "app.deletion_recovery_pending(text)": {
    reads: "API027: whether a recovery link may be sent to an address, server only (task 3.7)",
    thirdParty: "DEC77 app.deletion_recovery_pending(): a member's identity changes nothing",
    guest: "DEC77 app.deletion_recovery_pending(): a guest reads one boolean for the given address",
  },
  "app.my_notifications(timestamp with time zone, uuid, integer)": {
    reads: "API078: the session member's own notifications of the last 90 days (task 3.8)",
    thirdParty:
      "DEC77 app.my_notifications(): another member's session reads only its own notifications",
    guest: "DEC77 app.my_notifications(): a guest is UNAUTHENTICATED",
  },
  "app.unread_notification_count()": {
    reads: "API115: the session member's own unread count (task 3.8)",
    thirdParty:
      "DEC77 app.unread_notification_count(): another member's session counts only its own",
    guest: "DEC77 app.unread_notification_count(): a guest is UNAUTHENTICATED",
  },
  "app.notification_email(uuid)": {
    reads:
      "email.send: the address and event of one notification if it may be sent now, worker only (task 3.8)",
    thirdParty: "DEC77 app.notification_email(): a member's identity changes nothing",
    guest: "DEC77 app.notification_email(): a guest reads the email of the given notification only",
  },
  "app.rate_limit_check(text, bytea, integer, interval)": {
    reads: "the seconds left on one counter, keyed by a hash the server computes (task 2.4)",
    thirdParty: "DEC77 app.rate_limit_check(): a member's identity changes nothing",
    guest: "DEC77 app.rate_limit_check(): a guest reads one number for the given key",
  },
};
