// /account/profile «تعديل الملف» (task 3.5, plan/screens.md): API016 for the name and the
// college. The avatar comes with task 4.7 (TC75). Read on the server through app.me() and
// app.active_colleges() (DEC77). The member's current college stays in the list even after it
// is deactivated, marked as no longer available (item 5). An unconfirmed member, or one who has
// not acknowledged new policy versions, sees why the form cannot save (API016 refuses both).
import type { Metadata } from "next";
import { headers } from "next/headers";
import { t } from "@souq/i18n";
import { loadAccount } from "../../../lib/account/me";
import { memberDenial } from "../../../lib/auth/guards";
import { requireMemberPage } from "../../../lib/auth/page";
import { activeColleges } from "../../../lib/auth/policies";
import { appDb } from "../../../lib/db/app-client";
import { traceIdOf } from "../../../lib/http/trace";
import { routes } from "../../../lib/routes";
import { ProfileForm, type Blocked } from "./ProfileForm";
import styles from "./profile.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: t("account.profile.pageTitle") };

export default async function ProfilePage() {
  const auth = await requireMemberPage(routes.account.profile);
  const traceId = traceIdOf(await headers());
  const db = appDb();
  const [{ me, state }, colleges] = await Promise.all([
    loadAccount(db, auth.identity, traceId),
    activeColleges(db, traceId),
  ]);

  const options = colleges.map((college) => ({ value: college.id, label: college.label_ar }));
  const current = me.college;
  if (current !== null && !options.some((option) => option.value === current.id)) {
    options.unshift({
      value: current.id,
      label: t("account.profile.college.inactive", { name: current.label_ar }),
    });
  }
  const denial = memberDenial(state);
  const blocked: Blocked | null =
    denial === "EMAIL_NOT_CONFIRMED" || denial === "TERMS_NOT_ACKNOWLEDGED" ? denial : null;

  return (
    <div className={styles.page}>
      <h1>{t("account.profile.pageTitle")}</h1>
      <p className={styles.intro}>{t("account.profile.intro")}</p>
      <ProfileForm
        initial={{
          displayName: me.display_name,
          collegeId: current?.id ?? "",
          version: me.version,
        }}
        colleges={options}
        blocked={blocked}
      />
      <p className={styles.back}>
        <a href={routes.account.home}>{t("account.profile.back")}</a>
      </p>
    </div>
  );
}
