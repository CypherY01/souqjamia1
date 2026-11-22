// Task 3.4: real emails in the local Mailpit (the recovery link, and the password-changed notice
// of SEC11). Local stack only: the URL comes from `supabase status`. Task 3.8: the text part and
// the headers too, for the worker's notification email.
import { inject } from "vitest";

export interface Mail {
  id: string;
  subject: string;
  html: string;
  text: string;
}

interface Search {
  messages?: { ID: string; Subject: string }[];
}

/** The newest message to `address` whose subject is `subject`, waiting up to 10 seconds. */
export async function waitForMail(address: string, subject: string): Promise<Mail> {
  const { mailpitUrl } = inject("stack");
  const query = encodeURIComponent(`to:"${address}" subject:"${subject}"`);
  for (let attempt = 0; attempt < 40; attempt++) {
    const found = (
      (await (await fetch(`${mailpitUrl}/api/v1/search?query=${query}`)).json()) as Search
    ).messages?.find((message) => message.Subject === subject);
    if (found !== undefined) {
      const full = (await (await fetch(`${mailpitUrl}/api/v1/message/${found.ID}`)).json()) as {
        HTML: string;
        Text: string;
      };
      return { id: found.ID, subject: found.Subject, html: full.HTML, text: full.Text };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no "${subject}" email arrived`);
}

/** The token_hash of the recovery link in a message, as the link page receives it. */
export function recoveryTokenOf(mail: Mail): { path: string; tokenHash: string } {
  const href = /href="([^"]+)"/.exec(mail.html)?.[1];
  if (href === undefined) throw new Error("no link in the message");
  const url = new URL(href.replaceAll("&amp;", "&"));
  const tokenHash = url.searchParams.get("token_hash");
  if (tokenHash === null) throw new Error("no token_hash in the link");
  return { path: url.pathname, tokenHash };
}

/** Task 3.8: the headers of a message, by name. */
export async function mailHeaders(id: string): Promise<Record<string, string[]>> {
  const { mailpitUrl } = inject("stack");
  return (await (await fetch(`${mailpitUrl}/api/v1/message/${id}/headers`)).json()) as Record<
    string,
    string[]
  >;
}

/** Task 3.8: how many messages were sent to `address` (no waiting). */
export async function mailCount(address: string): Promise<number> {
  const { mailpitUrl } = inject("stack");
  const query = encodeURIComponent(`to:"${address}"`);
  const found = (await (await fetch(`${mailpitUrl}/api/v1/search?query=${query}`)).json()) as {
    messages_count?: number;
  };
  return found.messages_count ?? 0;
}
