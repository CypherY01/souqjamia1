// Shared navigation (chapter 02, plan/screens.md). In Arabic the logo is on the right, then
// search and the main links. No contribution link and no language switch (DEC30, DEC31).
// The layout shows the member variant for an ordinary session (task 3.1), the visitor otherwise.
import Link from "next/link";
import { formatNumber, t } from "@souq/i18n";
import { routes } from "../../lib/routes";
import { SignOutButton } from "../auth/SignOutButton";
import { Button, LinkButton } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Disclosure } from "./Disclosure";
import styles from "./SiteHeader.module.css";

export interface HeaderMember {
  name: string;
  college?: string;
  unreadNotifications: number;
}

interface SiteHeaderProps {
  member?: HeaderMember | null;
  /** Distinct names and ids when a second header is shown, as in the /dev/ui preview. */
  navLabel?: string;
  idPrefix?: string;
  /** The /dev/ui preview: the sign-out button there sends nothing. */
  preview?: boolean;
}

export function SiteHeader({
  member = null,
  navLabel = t("layout.header.navLabel"),
  idPrefix = "site",
  preview = false,
}: SiteHeaderProps) {
  const searchId = `${idPrefix}-search`;
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link href={routes.home} className={styles.logo} aria-label={t("layout.header.logoLabel")}>
          {t("common.app.name")}
        </Link>

        <form role="search" action={routes.market} method="get" className={styles.search}>
          <label htmlFor={searchId} className="visually-hidden">
            {t("layout.header.search.label")}
          </label>
          <input
            id={searchId}
            type="search"
            name="q"
            className={styles.searchInput}
            placeholder={t("layout.header.search.placeholder")}
          />
          <Button type="submit" variant="primary">
            <Icon name="search" />
            {t("layout.header.search.submit")}
          </Button>
        </form>

        <Disclosure
          kind="menu"
          buttonContent={
            <>
              <Icon name="menu" />
              {t("layout.header.menu")}
            </>
          }
        >
          <nav aria-label={navLabel}>
            <ul className={styles.links}>
              <li>
                <Link href={routes.home}>{t("layout.header.nav.home")}</Link>
              </li>
              <li>
                <Link href={routes.market}>{t("layout.header.nav.market")}</Link>
              </li>
              <li>
                <Link href={routes.wanted}>{t("layout.header.nav.wanted")}</Link>
              </li>
            </ul>
          </nav>
          {member === null ? (
            <VisitorActions />
          ) : (
            <MemberActions member={member} preview={preview} />
          )}
        </Disclosure>
      </div>
    </header>
  );
}

function VisitorActions() {
  return (
    <div className={styles.actions}>
      <LinkButton href={routes.login} variant="ghost">
        {t("layout.header.visitor.login")}
      </LinkButton>
      <LinkButton href={routes.signup} variant="secondary">
        {t("layout.header.visitor.signup")}
      </LinkButton>
      <LinkButton href={routes.sell} variant="primary">
        {t("layout.header.visitor.addListing")}
      </LinkButton>
    </div>
  );
}

function MemberActions({ member, preview }: { member: HeaderMember; preview: boolean }) {
  const unread = member.unreadNotifications;
  return (
    <div className={styles.actions}>
      <ul className={styles.links}>
        <li>
          <Link href={routes.messages}>{t("layout.header.member.messages")}</Link>
        </li>
        <li>
          <Link href={routes.notifications}>
            {t("layout.header.member.notifications")}
            {unread > 0 && (
              <span className={styles.count}>
                {/* The number is visible; the full phrase is for screen readers. */}
                <span aria-hidden="true">{formatNumber(unread)}</span>
                <span className="visually-hidden">
                  {t("layout.header.member.unread", { count: formatNumber(unread) })}
                </span>
              </span>
            )}
          </Link>
        </li>
        <li>
          <Link href={routes.account.favorites}>{t("layout.header.member.favorites")}</Link>
        </li>
      </ul>
      <Disclosure
        kind="account"
        buttonContent={
          <>
            {t("layout.header.member.accountMenu")}
            <Icon name="chevron" />
          </>
        }
      >
        <p className={styles.memberName}>
          <bdi>{member.name}</bdi>
        </p>
        {member.college !== undefined && (
          <p className={styles.memberCollege}>
            <bdi>{member.college}</bdi>
          </p>
        )}
        <ul className={styles.menuList}>
          <li>
            <Link href={routes.account.home}>{t("layout.header.member.account")}</Link>
          </li>
          <li>
            <Link href={routes.account.listings}>{t("layout.header.member.myListings")}</Link>
          </li>
          <li>
            <Link href={routes.account.wanted}>{t("layout.header.member.myWanted")}</Link>
          </li>
          <li>
            <Link href={routes.account.profile}>{t("layout.header.member.profile")}</Link>
          </li>
          <li>
            <Link href={routes.account.favorites}>{t("layout.header.member.favorites")}</Link>
          </li>
          <li>
            <Link href={routes.messages}>{t("layout.header.member.messages")}</Link>
          </li>
        </ul>
        {/* API003: a POST with the CSRF token, never a GET link or a plain form (SEC05, task 3.3). */}
        <SignOutButton preview={preview ? "idle" : undefined} />
      </Disclosure>
    </div>
  );
}
