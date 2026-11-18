import { describe, expect, it } from "vitest";
import { t, type MessageKey } from "@souq/i18n";

describe("workspace packages", () => {
  it("resolves @souq/i18n and returns the Arabic product name (DEC25, DEC30)", () => {
    expect(t("common.app.name")).toBe("سوق الجامعة");
  });

  it("throws on a key that is not in the Arabic resources", () => {
    expect(() => t("common.app.missing" as MessageKey)).toThrow("Missing message key");
  });
});
