// SEC08, DEC08 (task 4.2): the public URLs of a listing image's variants. media.publish copies
// them to the public bucket after the publication commits, at the same fixed keys as the private
// files (<media_id>/<variant>.webp). Build them only when the database says the public rows
// exist (public_ready), so a page never links to a file that is not there yet (owner note 2 on
// task 4.2). A master is never public.
import { MEDIA_BUCKETS, privateObjectKey } from "@souq/domain";

/** The contract's ImageSet. */
export interface ImageSet {
  w150: string;
  w600: string;
  w1200: string;
}

/** Supabase Storage's public object URL for one variant. */
export function publicImageUrl(
  supabaseUrl: string,
  mediaId: string,
  variant: "w150" | "w600" | "w1200",
): string {
  const base = supabaseUrl.replace(/\/+$/, "");
  return `${base}/storage/v1/object/public/${MEDIA_BUCKETS.public}/${privateObjectKey(mediaId, variant)}`;
}

export function publicImageSet(supabaseUrl: string, mediaId: string): ImageSet {
  return {
    w150: publicImageUrl(supabaseUrl, mediaId, "w150"),
    w600: publicImageUrl(supabaseUrl, mediaId, "w600"),
    w1200: publicImageUrl(supabaseUrl, mediaId, "w1200"),
  };
}
