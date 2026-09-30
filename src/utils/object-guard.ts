/**
 * @file src/utils/object-guard.ts
 * @description The one plain-object admission guard shared by the exact-shape
 * record parsers (signed template envelopes, provider packages, provider
 * state). Each parser keeps its own field grammar; only the "is this a
 * non-array object" boundary is common, and it must fail with the same
 * labelled message everywhere.
 */

/** Admit only a non-null, non-array object, labelled for the caller's grammar. */
export function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
