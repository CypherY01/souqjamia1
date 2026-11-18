import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";
import { t } from "@souq/i18n";
import {
  EMAIL_TEMPLATES,
  type EmailTemplateName,
} from "../../packages/db/scripts/build-email-templates.ts";
import { CONFIG_TOML, DB_DIR, emailConfirmationRequired } from "../../scripts/local-supabase.ts";

// Decision values in packages/db/supabase/config.toml. A change here needs a recorded owner
// decision (DEC48), so an accidental edit fails this test.
interface Config {
  api: { schemas: string[]; max_rows: number; auto_expose_new_tables: boolean };
  auth: {
    site_url: string;
    jwt_expiry: number;
    minimum_password_length: number;
    password_requirements: string;
    captcha: { enabled: boolean; provider: string };
    sessions: { timebox: string; inactivity_timeout: string };
    email: {
      enable_confirmations: boolean;
      double_confirm_changes: boolean;
      max_frequency: string;
      otp_expiry: number;
      template: Record<string, { subject: string; content_path: string }>;
    };
    mfa: { totp: { enroll_enabled: boolean; verify_enabled: boolean } };
  };
  edge_runtime: { enabled: boolean };
}

const text = readFileSync(CONFIG_TOML, "utf8");
const config = parse(text) as unknown as Config;

describe("local Supabase config.toml (task 1.4)", () => {
  it("DEC36: exposes only public, with no default grants", () => {
    expect(config.api.schemas).toEqual(["public"]);
    expect(config.api.auto_expose_new_tables).toBe(false);
    expect(config.api.max_rows).toBe(50);
  });

  it("DEC38: 10 minute JWT, 30 day sessions with a 7 day idle timeout", () => {
    expect(config.auth.jwt_expiry).toBe(600);
    expect(config.auth.sessions).toEqual({ timebox: "720h", inactivity_timeout: "168h" });
  });

  it("DEC37 and RL03: one hour links, 60 seconds between emails", () => {
    expect(config.auth.email.otp_expiry).toBe(3600);
    expect(config.auth.email.max_frequency).toBe("60s");
  });

  it("DEC63: email confirmation is off, and env:local reads the same value", () => {
    expect(config.auth.email.enable_confirmations).toBe(false);
    expect(emailConfirmationRequired(text)).toBe(false);
  });

  it("SEC03: an email change needs both addresses", () => {
    expect(config.auth.email.double_confirm_changes).toBe(true);
  });

  it("DEC32: minimum 8 characters, no mandatory character classes", () => {
    expect(config.auth.minimum_password_length).toBe(8);
    expect(config.auth.password_requirements).toBe("");
  });

  it("DEC36 and DEC52: Turnstile is on, with Cloudflare's public test secret locally", () => {
    expect(config.auth.captcha).toMatchObject({ enabled: true, provider: "turnstile" });
  });

  it("DEC29: TOTP MFA is enabled", () => {
    expect(config.auth.mfa.totp).toEqual({ enroll_enabled: true, verify_enabled: true });
  });

  it("uses localhost:3000 as the local site and no Edge Functions", () => {
    expect(config.auth.site_url).toBe("http://localhost:3000");
    expect(config.edge_runtime.enabled).toBe(false);
  });

  it.each(Object.keys(EMAIL_TEMPLATES) as EmailTemplateName[])(
    "template %s: subject comes from @souq/i18n and the file exists",
    (name) => {
      const template = config.auth.email.template[name];
      expect(template?.subject).toBe(t(`email.${name}.subject`));
      expect(template?.content_path).toBe(`./supabase/templates/${name}.html`);
      expect(existsSync(join(DB_DIR, template?.content_path ?? "missing"))).toBe(true);
    },
  );
});
