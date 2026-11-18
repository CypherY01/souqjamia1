// Footer (chapter 02, plan/screens.md): description, how it works, safety, categories, wanted
// requests, then privacy, terms, community guidelines and contact. No contribution link (DEC31).
import Link from "next/link";
import { t } from "@souq/i18n";
import { routes } from "../../lib/routes";
import styles from "./SiteFooter.module.css";

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <section className={styles.about} aria-labelledby="footer-about">
          <h2 id="footer-about" className={styles.heading}>
            {t("layout.footer.aboutHeading")}
          </h2>
          <p>{t("common.app.description")}</p>
        </section>
        <nav aria-label={t("layout.footer.label")} className={styles.groups}>
          <section aria-labelledby="footer-market">
            <h2 id="footer-market" className={styles.heading}>
              {t("layout.footer.marketHeading")}
            </h2>
            <ul className={styles.list}>
              <li>
                <Link href={routes.howItWorks}>{t("layout.footer.howItWorks")}</Link>
              </li>
              <li>
                <Link href={routes.safety}>{t("layout.footer.safety")}</Link>
              </li>
              <li>
                {/* The category list comes from the database in task 2.3. */}
                <Link href={routes.market}>{t("layout.footer.categories")}</Link>
              </li>
              <li>
                <Link href={routes.wanted}>{t("layout.footer.wanted")}</Link>
              </li>
            </ul>
          </section>
          <section aria-labelledby="footer-policies">
            <h2 id="footer-policies" className={styles.heading}>
              {t("layout.footer.policiesHeading")}
            </h2>
            <ul className={styles.list}>
              <li>
                <Link href={routes.privacy}>{t("layout.footer.privacy")}</Link>
              </li>
              <li>
                <Link href={routes.terms}>{t("layout.footer.terms")}</Link>
              </li>
              <li>
                <Link href={routes.guidelines}>{t("layout.footer.guidelines")}</Link>
              </li>
              <li>
                <Link href={routes.contact}>{t("layout.footer.contact")}</Link>
              </li>
            </ul>
          </section>
        </nav>
      </div>
    </footer>
  );
}
