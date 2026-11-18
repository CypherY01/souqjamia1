// NFR10: JSON request bodies are at most 128 KiB, counted while reading, so a wrong or missing
// Content-Length cannot get past the limit. Status codes follow contracts/README.md:
//   400 BAD_REQUEST        wrong content type, broken JSON, wrong types, unknown fields
//   400 PAYLOAD_TOO_LARGE  over 128 KiB (contract choice 11: 400, not 413)
//   422 VALIDATION_FAILED  a field rule (required, length, format...), with field_errors
import type { z } from "zod";
import { ApiError, type FieldError } from "./errors.ts";

export const MAX_JSON_BYTES = 128 * 1024;

async function readLimited(request: Request, limit: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > limit) throw new ApiError("PAYLOAD_TOO_LARGE");
  if (request.body === null) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new ApiError("PAYLOAD_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function valueAt(input: unknown, path: readonly PropertyKey[]): unknown {
  let node = input;
  for (const key of path) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<PropertyKey, unknown>)[key];
  }
  return node;
}

function fieldName(path: readonly PropertyKey[]): string {
  return path.map(String).join(".");
}

/** Maps zod issues to the contract: structure problems are 400, field rules are 422. */
export function validationError(issues: readonly z.core.$ZodIssue[], input: unknown): ApiError {
  const structure: FieldError[] = [];
  const rules: FieldError[] = [];
  for (const issue of issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        structure.push({ field: fieldName([...issue.path, key]), code: "unknown_field" });
      }
    } else if (issue.code === "invalid_type" && valueAt(input, issue.path) === undefined) {
      rules.push({ field: fieldName(issue.path), code: "required" });
    } else if (issue.code === "invalid_type") {
      structure.push({ field: fieldName(issue.path), code: "invalid_type" });
    } else {
      rules.push({ field: fieldName(issue.path), code: issue.code });
    }
  }
  return structure.length > 0
    ? new ApiError("BAD_REQUEST", { fieldErrors: structure })
    : new ApiError("VALIDATION_FAILED", { fieldErrors: rules });
}

/**
 * Reads and validates a JSON body. Use z.strictObject schemas so unknown fields are rejected
 * (additionalProperties: false in the contract).
 */
export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json(\s*;|$)/i.test(type)) throw new ApiError("BAD_REQUEST");

  const bytes = await readLimited(request, MAX_JSON_BYTES);
  let input: unknown;
  try {
    input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ApiError("BAD_REQUEST");
  }
  const result = schema.safeParse(input);
  if (!result.success) throw validationError(result.error.issues, input);
  return result.data;
}
