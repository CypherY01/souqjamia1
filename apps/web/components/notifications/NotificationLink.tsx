"use client";

// Task 3.8 (FR48, API079): opening an unread notification marks it read, then goes to its
// destination, where that page checks access again. Without JavaScript it is a plain link. If
// marking fails, the member still reaches the destination; the item stays unread.
import type { ReactNode } from "react";
import { api } from "../../lib/client/api";
import { routes } from "../../lib/routes";
import styles from "./notifications.module.css";

interface NotificationLinkProps {
  id: string;
  /** A fixed local path the server derived. */
  href: string;
  unread: boolean;
  /** The /dev/ui preview sends nothing. */
  preview?: boolean;
  children: ReactNode;
}

export function NotificationLink({
  id,
  href,
  unread,
  preview = false,
  children,
}: NotificationLinkProps) {
  return (
    <a
      className={styles.link}
      href={href}
      onClick={(event) => {
        if (preview) {
          event.preventDefault();
          return;
        }
        if (!unread || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
          return;
        }
        event.preventDefault();
        void api
          .request(routes.api.notifications, { method: "PATCH", body: { ids: [id], read: true } })
          .finally(() => {
            window.location.assign(href);
          });
      }}
    >
      {children}
    </a>
  );
}
