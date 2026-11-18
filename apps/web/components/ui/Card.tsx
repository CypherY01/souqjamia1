import type { ReactNode } from "react";
import styles from "./Card.module.css";

export function Card({
  children,
  as: Tag = "div",
}: {
  children: ReactNode;
  as?: "div" | "article" | "section";
}) {
  return <Tag className={styles.card}>{children}</Tag>;
}
