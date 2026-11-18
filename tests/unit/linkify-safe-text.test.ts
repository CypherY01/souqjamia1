import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { linkify } from "@souq/domain";
import { MEMBER_LINK_REL, SafeText } from "../../apps/web/components/text/SafeText.tsx";

const NEW_TAB = "(يفتح في نافذة جديدة)";

function render(text: string): string {
  return renderToStaticMarkup(createElement(SafeText, { text, newTabLabel: NEW_TAB }));
}

describe("linkify (SEC06)", () => {
  it("joins back to the original text", () => {
    const text = "انظر https://example.test/a?b=1، أو http://example.test.";
    const parts = linkify(text);
    expect(parts.map((part) => (part.type === "text" ? part.value : part.text)).join("")).toBe(
      text,
    );
  });

  it("links http and https only, without trailing punctuation", () => {
    expect(linkify("انظر https://example.test/a?b=1، شكراً")).toEqual([
      { type: "text", value: "انظر " },
      { type: "link", href: "https://example.test/a?b=1", text: "https://example.test/a?b=1" },
      { type: "text", value: "، شكراً" },
    ]);
    expect(linkify("(https://example.test/wiki_(x))")).toEqual([
      { type: "text", value: "(" },
      {
        type: "link",
        href: "https://example.test/wiki_(x)",
        text: "https://example.test/wiki_(x)",
      },
      { type: "text", value: ")" },
    ]);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<b>x</b>",
    "ftp://example.test/file",
    "www.example.test",
    "https://bank.example@evil.example/login",
  ])("keeps %s as text", (text) => {
    expect(linkify(text).every((part) => part.type === "text")).toBe(true);
  });

  it("encodes the href but shows the text as typed", () => {
    const [, link] = linkify("x https://example.test/كتب");
    expect(link).toEqual({
      type: "link",
      href: "https://example.test/%D9%83%D8%AA%D8%A8",
      text: "https://example.test/كتب",
    });
  });
});

describe("TC31 SafeText: HTML, malicious links and bidi controls", () => {
  it("shows HTML as text, never as markup", () => {
    const html = render('<script>alert("x")</script><img src=x onerror=alert(1)>');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });

  it("does not link javascript: URLs", () => {
    const html = render("javascript:alert(1)");
    expect(html).not.toContain("<a");
    expect(html).not.toContain("href");
  });

  it("links https URLs with safe rel, a new tab and a screen-reader hint", () => {
    const html = render("الرابط https://example.test/a");
    expect(html).toContain('href="https://example.test/a"');
    expect(html).toContain(`rel="${MEMBER_LINK_REL}"`);
    expect(MEMBER_LINK_REL).toBe("noopener noreferrer nofollow ugc");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('dir="ltr"');
    expect(html).toContain(NEW_TAB);
  });

  it("drops the right-to-left override and isolates the text", () => {
    const html = render("رقم \u202e12345\u202c");
    expect(html).not.toMatch(/[\u202a-\u202e\u2066-\u2069]/);
    expect(html).toContain("12345");
    expect(html.startsWith("<bdi")).toBe(true);
  });
});
