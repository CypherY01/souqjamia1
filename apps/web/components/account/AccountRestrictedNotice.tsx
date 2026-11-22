// FR78 without appeals (task 3.1, item 14): what a restricted account sees on /restricted.
// Suspended: until when, in Asia/Riyadh. Banned. Awaiting deletion (DEC41): the end of the
// 30-day recovery window, or that it has ended (task 3.7); the page adds the recovery link form.
// In Phase 1 an objection goes to the contact address (section 3 of the addendum), and so does a
// suspended or banned account's request to delete its data, handled by hand (DEC81).
import type { ReactNode } from "react";
import { t } from "@souq/i18n";
import type { Restriction } from "../../lib/auth/guards";
import { Alert } from "../ui/Alert";
import { DateText, DateTimeText } from "../ui/Display";
import styles from "./AccountRestrictedNotice.module.css";

interface AccountRestrictedNoticeProps {
  restriction: Restriction;
  /** Shown under the deletion state: the recovery link form of /restricted (task 3.7). */
  children?: ReactNode;
  contactEmail: string;
  /** Distinct ids when more than one is shown, as in the /dev/ui gallery. */
  idPrefix?: string;
}

function Contact({ objection, email, id }: { objection: boolean; email: string; id: string }) {
  const key = objection ? "objection" : "help";
  // DEC81: no self-deletion for a restricted account; it asks at the same address.
  return (
    <section className={styles.contact} aria-labelledby={id}>
      <h2 id={id} className={styles.contactTitle}>
        {t(`account.restricted.${key}.title`)}
      </h2>
      <p>{t(`account.restricted.${key}.body`)}</p>
      <p>
        <a href={`mailto:${email}`} dir="ltr" className={styles.email}>
          {email}
        </a>
      </p>
      {objection && <p>{t("account.restricted.dataDeletion")}</p>}
    </section>
  );
}

export function AccountRestrictedNotice({
  restriction,
  children,
  contactEmail,
  idPrefix = "restricted",
}: AccountRestrictedNoticeProps) {
  const contactId = `${idPrefix}-contact`;
  switch (restriction.kind) {
    case "suspended":
      return (
        <>
          <Alert variant="warning" title={t("account.restricted.suspended.title")}>
            <p>{t("account.restricted.suspended.body")}</p>
            <p>
              {t("account.restricted.suspended.until")} <DateTimeText value={restriction.until} />
            </p>
          </Alert>
          <Contact objection email={contactEmail} id={contactId} />
        </>
      );
    case "banned":
      return (
        <>
          <Alert variant="danger" title={t("account.restricted.banned.title")}>
            <p>{t("account.restricted.banned.body")}</p>
          </Alert>
          <Contact objection email={contactEmail} id={contactId} />
        </>
      );
    case "deletion_pending":
      return (
        <>
          {restriction.recoverable ? (
            <Alert variant="info" title={t("account.restricted.deletionPending.title")}>
              <p>{t("account.restricted.deletionPending.body")}</p>
              <p>
                {t("account.restricted.deletionPending.deadline")}{" "}
                <DateText value={restriction.deadline} />
              </p>
            </Alert>
          ) : (
            <Alert variant="warning" title={t("account.restricted.deletionPending.expiredTitle")}>
              <p>{t("account.restricted.deletionPending.expiredBody")}</p>
            </Alert>
          )}
          {children}
          <Contact objection={false} email={contactEmail} id={contactId} />
        </>
      );
  }
}
