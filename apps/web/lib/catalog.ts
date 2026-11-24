// API030 (task 4.2, FR08, FR20, FR55, DEC28): the active pick lists, public. Categories are the
// seven of the migration in every environment; colleges and meeting points come from the owner's
// G02 list, so either may be empty (owner note 1 on task 4.2: the wizard then offers
// «حسب الاتفاق» alone). Framework-free, so integration tests run it as is.
import type { enums } from "@souq/domain";
import type { AppDb } from "./db/app-client.ts";

/** The contract's CatalogRef. */
export interface CatalogRef {
  id: string;
  key: string;
  label_ar: string;
  label_en: string | null;
}

/** The contract's MeetingPointRef. */
export interface MeetingPointRef extends CatalogRef {
  kind: enums.MeetingPointKind;
}

/** The contract's Catalog. */
export interface Catalog {
  categories: CatalogRef[];
  colleges: CatalogRef[];
  meeting_points: MeetingPointRef[];
}

/** One read for the three lists, in display order, active rows only. */
export function loadCatalog(db: AppDb, traceId: string): Promise<Catalog> {
  return db.withActor(null, traceId, async (tx) => {
    const categories = await tx.query<CatalogRef>(
      "select id, key::text as key, label_ar, label_en from app.active_categories()",
    );
    const colleges = await tx.query<CatalogRef>(
      "select id, key, label_ar, label_en from app.active_colleges()",
    );
    const points = await tx.query<MeetingPointRef>(
      "select id, key, kind::text as kind, label_ar, label_en from app.active_meeting_points()",
    );
    return {
      categories: categories.rows,
      colleges: colleges.rows,
      meeting_points: points.rows,
    };
  });
}
