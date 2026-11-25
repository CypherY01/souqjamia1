// A listing's images (task 4.3, FR13, UC04): a strip that scrolls sideways and snaps to each
// picture, and thumbnails that are links to them (#image-n). Image selection without JavaScript.
// Only images whose public copies exist come here; none yet is «الصور قيد التجهيز» (owner note on
// task 4.2).
import { formatNumber, t } from "@souq/i18n";
import { stripBidiControls } from "@souq/domain";
import type { ImageSet } from "../../lib/media/public";
import { ImagesPending } from "./ImagesPending";
import styles from "./listings.module.css";

export function ImageGallery({ images, title }: { images: ImageSet[]; title: string }) {
  if (images.length === 0) return <ImagesPending />;
  const total = formatNumber(images.length);
  const name = stripBidiControls(title);
  return (
    <section className={styles.gallery} aria-label={t("market.listing.galleryLabel")}>
      {/* A strip that scrolls takes the keyboard focus, so arrow keys move it (WCAG 2.1.1). */}
      <ul
        className={styles.strip}
        tabIndex={images.length > 1 ? 0 : undefined}
        aria-label={images.length > 1 ? t("market.listing.stripLabel") : undefined}
      >
        {images.map((image, index) => (
          <li key={image.w1200} id={`image-${String(index + 1)}`} className={styles.slide}>
            {/* The worker already made the sizes (DEC08): no next/image optimizer. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className={styles.slideImage}
              src={image.w1200}
              srcSet={`${image.w600} 600w, ${image.w1200} 1200w`}
              sizes="(min-width: 1024px) 600px, 100vw"
              width={1200}
              height={900}
              alt={t("market.listing.imageAlt", {
                n: formatNumber(index + 1),
                total,
                title: name,
              })}
              loading={index === 0 ? "eager" : "lazy"}
              decoding="async"
            />
          </li>
        ))}
      </ul>
      {images.length > 1 && (
        <nav aria-label={t("market.listing.thumbsLabel")}>
          <ul className={styles.thumbs}>
            {images.map((image, index) => (
              <li key={image.w150}>
                <a className={styles.thumb} href={`#image-${String(index + 1)}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    className={styles.thumbImage}
                    src={image.w150}
                    width={150}
                    height={113}
                    alt={t("market.listing.thumbAlt", { n: formatNumber(index + 1) })}
                    loading="lazy"
                    decoding="async"
                  />
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </section>
  );
}
