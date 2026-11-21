// API016 (task 3.5): the member edits the permitted profile fields (FR49, TC21, TC65, DEC78).
// The body is the contract's ProfilePatch: any other field (a role, the badge, a rating, an id,
// the version) is 400 BAD_REQUEST and changes nothing. app.update_profile() rechecks every rule
// and the account state, and returns through app.me() in the same transaction.
// Framework-free, so integration tests run it as is.
import { parseDisplayName } from "@souq/domain";
import { z } from "zod";
import { requireMember, type GuardContext } from "../auth/guards.ts";
import type { AppDb } from "../db/app-client.ts";
import { readJson } from "../http/body.ts";
import { ApiError, type FieldError } from "../http/errors.ts";
import { readAccount, type Account } from "./me.ts";

export const ProfileBody = z.strictObject({
  display_name: z.string().optional(),
  college_id: z.uuid().nullable().optional(),
  avatar_id: z.uuid().nullable().optional(),
  locale: z.literal("ar").optional(),
  expected_version: z.int().min(1),
});
export type ProfileBody = z.infer<typeof ProfileBody>;

/** Field rules past the structure: the name (parseDisplayName) and the avatar until task 4.7. */
export function profileFieldErrors(input: ProfileBody): FieldError[] {
  const errors: FieldError[] = [];
  if (input.display_name !== undefined) {
    const name = parseDisplayName(input.display_name);
    if (!name.ok) errors.push({ field: "display_name", code: name.error });
  }
  // Item 2: no media exists before task 4.1, so no id can be an eligible avatar (TC75 in 4.7).
  if (typeof input.avatar_id === "string") errors.push({ field: "avatar_id", code: "unknown" });
  return errors;
}

export interface ProfileContext extends GuardContext {
  db: AppDb;
}

/** API016: returns the account after the edit (MeOk). */
export async function updateProfile(request: Request, ctx: ProfileContext): Promise<Account> {
  const { identity } = await requireMember(ctx, { db: ctx.db });
  const input = await readJson(request, ProfileBody);
  const fieldErrors = profileFieldErrors(input);
  if (fieldErrors.length > 0) throw new ApiError("VALIDATION_FAILED", { fieldErrors });

  // Only the fields the member sent: absent stays, null removes (the college).
  const patch: Record<string, unknown> = {};
  if (input.display_name !== undefined) patch.display_name = input.display_name;
  if (input.college_id !== undefined) patch.college_id = input.college_id;
  if (input.avatar_id !== undefined) patch.avatar_id = input.avatar_id;
  if (input.locale !== undefined) patch.locale = input.locale;

  // DEC72: the whole body may run again; it does everything through tx, with the same inputs.
  return ctx.db.withActor(identity.claims, ctx.traceId, async (tx) => {
    await tx.query("select app.update_profile($1, $2::jsonb)", [
      input.expected_version,
      JSON.stringify(patch),
    ]);
    return readAccount(tx, identity);
  });
}
