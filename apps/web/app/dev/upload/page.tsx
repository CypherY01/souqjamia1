// Task 4.1: the upload test page, for E2E and the owner's local review (item 11). Real uploads
// through API037 to API040 for each purpose accepted in task 4.1 (listing, avatar, student card),
// processed by the worker. Like /dev/ui, it returns 404 when APP_ENV=production (owner note 1 on
// the approval of task 4.1, tests/unit/dev-gallery.test.ts). It needs a signed-in member.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { t } from "@souq/i18n";
import { ImageUploader } from "../../../components/media/ImageUploader";
import { requireMemberPage } from "../../../lib/auth/page";
import { devGalleryEnabled } from "../../../lib/dev-gallery";
import { serverEnv } from "../../../lib/env";
import { routes } from "../../../lib/routes";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: t("dev.upload.title"),
  robots: { index: false, follow: false },
};

export default async function DevUploadPage() {
  if (!devGalleryEnabled(serverEnv().APP_ENV)) notFound();
  await requireMemberPage(routes.devUpload);
  return (
    <div className={styles.page}>
      <h1>{t("dev.upload.title")}</h1>
      <p className={styles.intro}>{t("dev.upload.intro")}</p>
      <section className={styles.section} aria-labelledby="upload-listing">
        <h2 id="upload-listing">{t("dev.upload.listing")}</h2>
        <ImageUploader purpose="listing" idPrefix="upload-listing" />
      </section>
      <section className={styles.section} aria-labelledby="upload-avatar">
        <h2 id="upload-avatar">{t("dev.upload.avatar")}</h2>
        <ImageUploader purpose="avatar" idPrefix="upload-avatar" />
      </section>
      <section className={styles.section} aria-labelledby="upload-card">
        <h2 id="upload-card">{t("dev.upload.studentCard")}</h2>
        <ImageUploader purpose="student_card" idPrefix="upload-card" />
      </section>
    </div>
  );
}
