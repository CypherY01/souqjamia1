// The market's search and filters (task 4.3, FR07 to FR12): a GET form to /market, so it works
// without JavaScript and every filter lives in the URL. It never carries the cursor, so applying
// it shows the first page (FR12). The query is always visible; the category, condition, meeting
// point and order fold into «الفلاتر والترتيب», open when one of them is set. «إعادة ضبط» is a
// link to /market (the defaults). A form that works without JavaScript keeps a plain Button
// (task 4.0).
import Link from "next/link";
import type { MarketFilters as Filters } from "@souq/domain";
import { t } from "@souq/i18n";
import type { Catalog } from "../../lib/catalog";
import { routes } from "../../lib/routes";
import { conditionOptions } from "../sell/wizard";
import { Button } from "../ui/Button";
import { Select, TextField } from "../ui/Field";
import styles from "./listings.module.css";

interface MarketFiltersProps {
  filters: Filters;
  catalog: Pick<Catalog, "categories" | "meeting_points">;
}

export function MarketFilters({ filters, catalog }: MarketFiltersProps) {
  const open =
    filters.category !== null ||
    filters.condition !== null ||
    filters.location !== null ||
    filters.sort !== "newest";
  return (
    <form role="search" action={routes.market} method="get" className={styles.filters}>
      <div className={styles.query}>
        <TextField
          id="market-q"
          name="q"
          type="search"
          label={t("market.market.q")}
          hint={t("market.market.qHint")}
          defaultValue={filters.q ?? ""}
          optional
          optionalMark={false}
          autoComplete="off"
        />
        <Button type="submit">{t("market.market.apply")}</Button>
      </div>
      <details className={styles.filterPanel} open={open}>
        <summary className={styles.summary}>{t("market.market.filtersTitle")}</summary>
        <div className={styles.filterGrid}>
          <Select
            id="market-category"
            name="category"
            label={t("market.market.category")}
            placeholder={t("market.market.categoryAll")}
            options={catalog.categories.map((category) => ({
              value: category.key,
              label: category.label_ar,
            }))}
            defaultValue={filters.category ?? ""}
            optional
            optionalMark={false}
          />
          <Select
            id="market-condition"
            name="condition"
            label={t("market.market.condition")}
            placeholder={t("market.market.conditionAll")}
            options={conditionOptions().map(({ value, label }) => ({ value, label }))}
            defaultValue={filters.condition ?? ""}
            optional
            optionalMark={false}
          />
          {catalog.meeting_points.length > 0 && (
            <Select
              id="market-location"
              name="location"
              label={t("market.market.location")}
              placeholder={t("market.market.locationAll")}
              options={catalog.meeting_points.map((point) => ({
                value: point.id,
                label: point.label_ar,
              }))}
              defaultValue={filters.location ?? ""}
              optional
              optionalMark={false}
            />
          )}
          {/* The empty first option is the default order, «الأحدث». */}
          <Select
            id="market-sort"
            name="sort"
            label={t("market.market.sort")}
            placeholder={t("market.market.sortOptions.newest")}
            options={[
              { value: "price_asc", label: t("market.market.sortOptions.price_asc") },
              { value: "price_desc", label: t("market.market.sortOptions.price_desc") },
            ]}
            defaultValue={filters.sort === "newest" ? "" : filters.sort}
            optional
            optionalMark={false}
          />
        </div>
        <p className={styles.filterActions}>
          <Button type="submit" variant="secondary">
            {t("market.market.apply")}
          </Button>
        </p>
      </details>
      {(open || filters.q !== null) && (
        <p className={styles.resetLine}>
          <Link href={routes.market} className={styles.reset}>
            {t("market.market.reset")}
          </Link>
        </p>
      )}
    </form>
  );
}
