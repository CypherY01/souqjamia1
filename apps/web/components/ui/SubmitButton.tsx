"use client";

// Task 4.0 (item C, owner condition 2): the submit button of a form that JavaScript sends
// (fetch to /api/*). Until React hydrates the form it is disabled, with a spinner and «جارٍ
// التحميل» for screen readers, so a press never reaches the browser's own submit and is never
// lost without a sign. Without JavaScript at all, the root layout's <noscript> message explains
// it. A form that works without JavaScript (the header search) keeps a plain Button.
import { useHydrated } from "../../lib/client/use-hydrated";
import { Button, type ButtonProps } from "./Button";

export function SubmitButton(props: Omit<ButtonProps, "type" | "preparing">) {
  const hydrated = useHydrated();
  return <Button {...props} type="submit" preparing={!hydrated} />;
}
