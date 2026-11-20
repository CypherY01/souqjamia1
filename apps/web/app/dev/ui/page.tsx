// Component gallery (task 1.5, DEC59): every shared component in each of its states, for the
// owner's local review. Returns 404 when APP_ENV=production.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { t, type MessageKey } from "@souq/i18n";
import { AccountRestrictedNotice } from "../../../components/account/AccountRestrictedNotice";
import { SiteHeader } from "../../../components/layout/SiteHeader";
import { SafeText } from "../../../components/text/SafeText";
import { Alert, SafeMeetupNotice } from "../../../components/ui/Alert";
import { Badge, NegotiableBadge, StudentBadge } from "../../../components/ui/Badge";
import { Button, LinkButton } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { Dialog } from "../../../components/ui/Dialog";
import {
  DateText,
  DateTimeText,
  Money,
  Num,
  Price,
  RelativeDate,
} from "../../../components/ui/Display";
import { AmountField, Checkbox, RadioGroup, Select, TextField } from "../../../components/ui/Field";
import { PasswordField } from "../../../components/ui/PasswordField";
import { EmptyState, ErrorState, LoadingState } from "../../../components/ui/States";
import { TextArea } from "../../../components/ui/TextArea";
import { devGalleryEnabled } from "../../../lib/dev-gallery";
import { serverEnv } from "../../../lib/env";
import { routes } from "../../../lib/routes";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

// PasswordField states (task 3.2, DEC75): seven characters (no count), 60 Latin characters (the
// count, past 56), and 40 Arabic letters (80 UTF-8 bytes, over the 72-byte limit of DEC32 while
// under 64 characters: the count and the notice).
const DEV_SHORT_PASSWORD = "abc1234";
const DEV_NEAR_LIMIT_PASSWORD = "a".repeat(60);
const DEV_LONG_ARABIC_PASSWORD = "ك".repeat(40);

export const metadata: Metadata = {
  title: t("dev.title"),
  robots: { index: false, follow: false },
};

// Each chip is colored by a rule in page.module.css: the CSP (task 1.6) blocks style attributes.
const swatches: readonly { token: string; label: MessageKey }[] = [
  { token: "--color-primary", label: "dev.colors.primary" },
  { token: "--color-surface-dark", label: "dev.colors.surfaceDark" },
  { token: "--color-accent", label: "dev.colors.accent" },
  { token: "--color-page", label: "dev.colors.page" },
  { token: "--color-card", label: "dev.colors.card" },
  { token: "--color-subtle-green", label: "dev.colors.subtleGreen" },
  { token: "--color-subtle-gold", label: "dev.colors.subtleGold" },
  { token: "--color-warning-bg", label: "dev.colors.warning" },
  { token: "--color-danger", label: "dev.colors.danger" },
  { token: "--color-control-border", label: "dev.colors.controlBorder" },
  { token: "--color-divider", label: "dev.colors.divider" },
  { token: "--color-text", label: "dev.colors.text" },
  { token: "--color-text-muted", label: "dev.colors.textMuted" },
];

// Sample member texts for TC31. These are data, as a member would type them, not UI strings.
const memberTexts: readonly { label: MessageKey; text: string }[] = [
  { label: "dev.memberText.html", text: '<script>alert("x")</script> <b>عريض؟</b>' },
  {
    label: "dev.memberText.link",
    text: "تفاصيل الكتاب هنا: https://example.test/books?id=7، والسعر 350 ريال.",
  },
  { label: "dev.memberText.badLink", text: "جرّب javascript:alert(1) أو data:text/html,hi" },
  { label: "dev.memberText.bidi", text: "رقم الطلب \u202e12345\u202c بعد الحذف" },
  { label: "dev.memberText.multiline", text: "السطر الأول\nالسطر الثاني\n\nسطر بعد فراغ" },
];

// Clearly fake fixtures (CLAUDE.md).
const sampleMember = { name: "عضو تجريبي", college: "كلية تجريبية 1", unreadNotifications: 3 };
const now = new Date();
const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);
const meetupAt = "2026-11-18T13:30:00Z";
// Task 3.1: fixture restriction dates and the fixture contact address (G05 gives the real one).
const suspendedUntil = new Date("2026-12-01T09:00:00Z");
const deletionDeadline = new Date("2026-12-19T12:00:00Z");
const sampleContactEmail = "contact@example.test";

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className={styles.section} aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

export default function DevUiPage() {
  if (!devGalleryEnabled(serverEnv().APP_ENV)) notFound();

  return (
    <>
      <h1>{t("dev.title")}</h1>
      <p className={styles.intro}>{t("dev.intro")}</p>

      <Section id="colors" title={t("dev.sections.colors")}>
        <ul className={styles.swatches}>
          {swatches.map((swatch) => (
            <li key={swatch.token} className={styles.swatch}>
              <span className={styles.chip} data-token={swatch.token} aria-hidden="true" />
              <span>{t(swatch.label)}</span>
              <code dir="ltr">{swatch.token}</code>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="typography" title={t("dev.sections.typography")}>
        <p className={styles.h1Sample}>{t("dev.typography.h1")}</p>
        <p className={styles.h2Sample}>{t("dev.typography.h2")}</p>
        <p className={styles.h3Sample}>{t("dev.typography.h3")}</p>
        <p>{t("dev.typography.body")}</p>
        <p className={styles.muted}>{t("dev.typography.muted")}</p>
      </Section>

      <Section id="buttons" title={t("dev.sections.buttons")}>
        <div className={styles.row}>
          <Button variant="primary">{t("dev.buttons.primary")}</Button>
          <Button variant="secondary">{t("dev.buttons.secondary")}</Button>
          <Button variant="danger">{t("dev.buttons.danger")}</Button>
          <Button variant="ghost">{t("dev.buttons.ghost")}</Button>
          <LinkButton href={routes.market} variant="secondary">
            {t("dev.buttons.link")}
          </LinkButton>
        </div>
        <div className={styles.row}>
          <Button loading loadingLabel={t("dev.buttons.loading")}>
            {t("dev.buttons.primary")}
          </Button>
          <Button disabledReason={t("dev.buttons.disabledReason")}>
            {t("dev.buttons.disabled")}
          </Button>
        </div>
      </Section>

      <Section id="fields" title={t("dev.sections.fields")}>
        <div className={styles.form}>
          <TextField
            id="dev-title"
            label={t("dev.fields.title")}
            hint={t("dev.fields.titleHint")}
          />
          <TextArea
            id="dev-description"
            label={t("dev.fields.description")}
            maxChars={2000}
            optional
          />
          <AmountField
            id="dev-price"
            label={t("dev.fields.price")}
            hint={t("dev.fields.priceHint")}
            defaultValue="٣٥٠٫٥٠٥"
            error={t("dev.fields.priceError")}
          />
          <Select
            id="dev-category"
            label={t("dev.fields.category")}
            placeholder={t("dev.fields.categoryPlaceholder")}
            options={[
              { value: "books", label: t("dev.fields.categoryBooks") },
              { value: "electronics", label: t("dev.fields.categoryElectronics") },
              { value: "furniture", label: t("dev.fields.categoryFurniture") },
            ]}
          />
          <RadioGroup
            name="dev-condition"
            legend={t("dev.fields.condition")}
            defaultValue="like_new"
            options={[
              { value: "new", label: t("dev.fields.conditionNew") },
              { value: "like_new", label: t("dev.fields.conditionLikeNew") },
              { value: "used", label: t("dev.fields.conditionUsed") },
            ]}
          />
          <Checkbox id="dev-negotiable" label={t("dev.fields.negotiable")} />
          <Checkbox
            id="dev-terms"
            label={t("auth.signup.terms.label")}
            error={t("auth.fields.terms.required")}
            extra={<a href={routes.terms}>{t("auth.signup.terms.link")}</a>}
          />
        </div>
      </Section>

      <Section id="password" title={t("dev.sections.password")}>
        <div className={styles.form}>
          <PasswordField
            id="dev-password"
            label={t("dev.password.label")}
            hint={t("dev.password.hint")}
            autoComplete="new-password"
          />
          <PasswordField
            id="dev-password-error"
            label={t("dev.password.errorLabel")}
            error={t("dev.password.error")}
            autoComplete="new-password"
            defaultValue={DEV_SHORT_PASSWORD}
          />
          <PasswordField
            id="dev-password-near-limit"
            label={t("dev.password.nearLimitLabel")}
            autoComplete="new-password"
            defaultValue={DEV_NEAR_LIMIT_PASSWORD}
          />
          <PasswordField
            id="dev-password-bytes"
            label={t("dev.password.bytesLabel")}
            autoComplete="new-password"
            defaultValue={DEV_LONG_ARABIC_PASSWORD}
          />
        </div>
      </Section>

      <Section id="alerts" title={t("dev.sections.alerts")}>
        <Alert variant="info" title={t("dev.alerts.infoTitle")}>
          {t("dev.alerts.infoBody")}
        </Alert>
        <Alert variant="success" title={t("dev.alerts.successTitle")}>
          {t("dev.alerts.successBody")}
        </Alert>
        <Alert variant="warning" title={t("dev.alerts.warningTitle")}>
          {t("dev.alerts.warningBody")}
        </Alert>
        <Alert variant="danger" title={t("dev.alerts.dangerTitle")}>
          {t("dev.alerts.dangerBody")}
        </Alert>
        <SafeMeetupNotice />
      </Section>

      <Section id="badges" title={t("dev.sections.badges")}>
        <div className={styles.row}>
          <StudentBadge />
          <NegotiableBadge />
          <Badge variant="condition">{t("dev.fields.conditionLikeNew")}</Badge>
          <Badge variant="neutral">{t("dev.fields.categoryBooks")}</Badge>
        </div>
        <p>
          <StudentBadge withHint />
        </p>
      </Section>

      <Section id="cards" title={t("dev.sections.cards")}>
        <Card>
          <h3>{t("dev.card.title")}</h3>
          <p>{t("dev.card.body")}</p>
          <p className={styles.row}>
            <Price halalas={35000} />
            <RelativeDate value={threeHoursAgo} now={now} />
          </p>
        </Card>
      </Section>

      <Section id="states" title={t("dev.sections.states")}>
        <div className={styles.states}>
          <Card>
            <LoadingState />
          </Card>
          <Card>
            <EmptyState
              headingLevel={3}
              title={t("dev.states.emptyTitle")}
              body={t("dev.states.emptyBody")}
              action={
                <LinkButton href={routes.sell} variant="primary">
                  {t("dev.states.emptyAction")}
                </LinkButton>
              }
            />
          </Card>
          <ErrorState
            headingLevel={3}
            title={t("dev.states.errorTitle")}
            body={t("dev.states.errorBody")}
            action={<Button variant="secondary">{t("ui.retry")}</Button>}
          />
        </div>
      </Section>

      <Section id="formatting" title={t("dev.sections.formatting")}>
        <dl className={styles.facts}>
          <dt>{t("dev.formatting.number")}</dt>
          <dd>
            <Num value={1200350} />
          </dd>
          <dt>{t("dev.formatting.money")}</dt>
          <dd>
            <Money halalas={120000} />
          </dd>
          <dt>{t("dev.formatting.moneyHalalas")}</dt>
          <dd>
            <Money halalas={35050} />
          </dd>
          <dt>{t("dev.formatting.price")}</dt>
          <dd>
            <Price halalas={35000} />
          </dd>
          <dt>{t("dev.formatting.priceFree")}</dt>
          <dd>
            <Price halalas={0} />
          </dd>
          <dt>{t("dev.formatting.date")}</dt>
          <dd>
            <DateText value={meetupAt} />
          </dd>
          <dt>{t("dev.formatting.dateTime")}</dt>
          <dd>
            <DateTimeText value={meetupAt} />
          </dd>
          <dt>{t("dev.formatting.relative")}</dt>
          <dd>
            <RelativeDate value={threeHoursAgo} now={now} />
          </dd>
        </dl>
      </Section>

      <Section id="member-text" title={t("dev.sections.memberText")}>
        <dl className={styles.facts}>
          {memberTexts.map((sample) => (
            <div key={sample.label} className={styles.fact}>
              <dt>{t(sample.label)}</dt>
              <dd>
                <SafeText text={sample.text} newTabLabel={t("ui.newTab")} />
              </dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section id="dialog" title={t("dev.sections.dialog")}>
        <Dialog
          triggerLabel={t("dev.dialog.open")}
          title={t("dev.dialog.title")}
          closeLabel={t("ui.close")}
          actions={
            <Button type="submit" variant="danger">
              {t("dev.dialog.confirm")}
            </Button>
          }
        >
          <p>{t("dev.dialog.body")}</p>
        </Dialog>
      </Section>

      <Section id="member-header" title={t("dev.sections.header")}>
        <p>{t("dev.header.intro")}</p>
        <div className={styles.preview}>
          <SiteHeader
            member={sampleMember}
            navLabel={t("dev.header.navLabel")}
            idPrefix="preview"
          />
        </div>
      </Section>

      <Section id="account-restricted" title={t("dev.sections.restricted")}>
        <p>{t("dev.restricted.intro")}</p>
        <h3>{t("dev.restricted.suspended")}</h3>
        <div className={styles.preview}>
          <AccountRestrictedNotice
            restriction={{ kind: "suspended", until: suspendedUntil }}
            contactEmail={sampleContactEmail}
            idPrefix="dev-suspended"
          />
        </div>
        <h3>{t("dev.restricted.banned")}</h3>
        <div className={styles.preview}>
          <AccountRestrictedNotice
            restriction={{ kind: "banned" }}
            contactEmail={sampleContactEmail}
            idPrefix="dev-banned"
          />
        </div>
        <h3>{t("dev.restricted.deletionPending")}</h3>
        <div className={styles.preview}>
          <AccountRestrictedNotice
            restriction={{ kind: "deletion_pending", deadline: deletionDeadline }}
            contactEmail={sampleContactEmail}
            idPrefix="dev-deletion"
          />
        </div>
      </Section>
    </>
  );
}
