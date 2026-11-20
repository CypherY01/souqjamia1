"use client";

// Cloudflare Turnstile (DEC36, DEC52, task 3.2 item 7), rendered explicitly in Arabic. The
// script is added by this component only where a form needs a token (signup and resend), so the
// visitor's browser contacts Cloudflare on those pages only (plan/policy-notes.md). The CSP lets
// it run through 'strict-dynamic' and shows its frame through frame-src (security-headers.ts).
// A token lasts 5 minutes: Turnstile renews it by itself, and the form resets the widget after
// CAPTCHA_FAILED. Locally and in CI the site key is Cloudflare's test key, which always passes.
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { t } from "@souq/i18n";
import { Button } from "../ui/Button";
import styles from "./Turnstile.module.css";

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile !== undefined) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => {
      if (window.turnstile === undefined) reject(new Error("turnstile missing"));
      else resolve(window.turnstile);
    };
    script.onerror = () => {
      script.remove();
      reject(new Error("turnstile unavailable"));
    };
    document.head.append(script);
  }).catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

export interface TurnstileHandle {
  /** A new challenge, after CAPTCHA_FAILED or a used token. */
  reset(): void;
}

interface TurnstileProps {
  siteKey: string;
  /** A token, or null when it expired or the challenge failed. */
  onToken: (token: string | null) => void;
  ref?: Ref<TurnstileHandle>;
}

type WidgetState = "loading" | "ready" | "failed";

export function Turnstile({ siteKey, onToken, ref }: TurnstileProps) {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  const [state, setState] = useState<WidgetState>("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let cancelled = false;
    loadTurnstile().then(
      (turnstile) => {
        if (cancelled || container.current === null) return;
        widget.current = turnstile.render(container.current, {
          sitekey: siteKey,
          language: "ar",
          theme: "light",
          size: "flexible",
          callback: (token: string) => {
            onTokenRef.current(token);
          },
          "expired-callback": () => {
            onTokenRef.current(null);
          },
          "error-callback": () => {
            onTokenRef.current(null);
          },
        });
        setState("ready");
      },
      () => {
        if (!cancelled) setState("failed");
      },
    );
    return () => {
      cancelled = true;
      if (widget.current !== null) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey, attempt]);

  useImperativeHandle(
    ref,
    () => ({
      reset() {
        onTokenRef.current(null);
        if (widget.current !== null) window.turnstile?.reset(widget.current);
      },
    }),
    [],
  );

  return (
    <div className={styles.wrapper} data-turnstile="">
      <p className="visually-hidden">{t("auth.captcha.label")}</p>
      {state === "loading" && (
        <p className={styles.status} role="status">
          {t("auth.captcha.loading")}
        </p>
      )}
      {state === "failed" && (
        <div className={styles.failed} role="alert">
          <p className={styles.status}>{t("auth.captcha.loadFailed")}</p>
          <Button
            variant="secondary"
            onClick={() => {
              setState("loading");
              setAttempt((count) => count + 1);
            }}
          >
            {t("auth.captcha.retry")}
          </Button>
        </div>
      )}
      <div ref={container} className={styles.widget} />
    </div>
  );
}
