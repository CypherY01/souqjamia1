// /account/listings/{id}/edit «تعديل إعلان» (task 4.4, plan/screens.md, FR23, API035, API037 to
// API040, item 6): the member's own listing read on the server (app.owner_listing, DEC77) and the
// edit form. Another member's listing or an unknown id is the generic «غير متاح» page (TC10: no
// hint that it exists). A listing that cannot be edited (sold, archived, hidden by moderation)
// says why, with the way back. The current category and meeting point stay in the lists even if
// they were deactivated since (they are kept while unchanged, TC80).
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { canEditListing } from "@souq/domain";
import { t } from "@souq/i18n";
import { EditListingForm } from "../../../../../components/listings/EditListingForm";
import { Alert } from "../../../../../components/ui/Alert";
import { LinkButton } from "../../../../../components/ui/Button";
import { memberDenial } from "../../../../../lib/auth/guards";
import { requireMemberPage } from "../../../../../lib/auth/page";
import { loadCatalog } from "../../../../../lib/catalog";
import { appDb } from "../../../../../lib/db/app-client";
import { traceIdOf } from "../../../../../lib/http/trace";
import { loadOwnerListing } from "../../../../../lib/listings/pages";
import { routes } from "../../../../../lib/routes";
import page from "../../page.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: t("myListings.edit.title") };

type Props = { params: Promise<{ id: string }> };

export default async function EditListingPage({ params }: Props) {
  const { id } = await params;
  const auth = await requireMemberPage(routes.account.listingEdit(id));
  const denial = memberDenial(auth.state);
  if (denial === "EMAIL_NOT_CONFIRMED" || denial === "TERMS_NOT_ACKNOWLEDGED") {
    return (
      <div className={page.page}>
        <h1>{t("myListings.edit.title")}</h1>
        <Alert variant="warning" title={t(`myListings.blocked.${denial}.title`)}>
          <p>{t(`myListings.blocked.${denial}.body`)}</p>
        </Alert>
        <p className={page.action}>
          <LinkButton href={routes.account.home}>{t("myListings.blocked.account")}</LinkButton>
        </p>
      </div>
    );
  }

  const listing = await loadOwnerListing(auth, id);
  if (listing === null) notFound();

  if (!canEditListing(listing)) {
    const reason = listing.moderation_hidden
      ? "hidden"
      : listing.status === "sold"
        ? "sold"
        : "archived";
    return (
      <div className={page.page}>
        <h1>{t("myListings.edit.title")}</h1>
        <Alert variant="info" title={t("myListings.edit.notEditableTitle")}>
          <p>{t(`myListings.edit.notEditable.${reason}`)}</p>
        </Alert>
        <p className={page.action}>
          <LinkButton href={routes.account.listings}>{t("myListings.edit.back")}</LinkButton>
        </p>
      </div>
    );
  }

  const catalog = await loadCatalog(appDb(), traceIdOf(await headers()));
  const categories = catalog.categories.map((category) => ({
    id: category.id,
    label: category.label_ar,
  }));
  if (!categories.some((category) => category.id === listing.category.id)) {
    categories.unshift({ id: listing.category.id, label: listing.category.label_ar });
  }
  const points = catalog.meeting_points.map((point) => ({
    id: point.id,
    kind: point.kind,
    label: point.label_ar,
  }));
  const location = listing.location;
  if (location !== null && !points.some((point) => point.id === location.id)) {
    points.unshift({ id: location.id, kind: location.kind, label: location.label_ar });
  }

  return (
    <div className={page.page}>
      <h1>{t("myListings.edit.title")}</h1>
      <p className={page.intro}>{t("myListings.edit.intro")}</p>
      <EditListingForm
        listing={{
          id: listing.id,
          title: listing.title,
          description: listing.description,
          categoryId: listing.category.id,
          condition: listing.condition,
          priceMinor: listing.price_minor,
          negotiable: listing.is_negotiable,
          locationId: location?.id ?? null,
          version: listing.version,
          images: listing.images.map((image) => ({
            mediaId: image.media_id,
            thumbnail: image.image?.w150 ?? null,
          })),
        }}
        catalog={{ categories, points }}
      />
    </div>
  );
}
