import { z } from "zod";
export type CanonicalVisualKind = "visual_asset" | "product_visual_link";
/** Versioned, unambiguous material; SHA-256 is supplied by the platform crypto adapter. */
export function visualIdMaterial(
  kind: CanonicalVisualKind,
  storeId: string,
  key: string,
) {
  z.uuid().parse(storeId);
  if (kind === "visual_asset")
    z.string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .parse(key);
  else z.uuid().parse(key);
  return JSON.stringify([`fl-copilot.${kind}.v1`, storeId, key]);
}
/** RFC UUID v8 from a SHA-256 digest. No hash algorithm or provider lives in the domain. */
export function visualIdFromDigest(raw: string) {
  const hex = z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(raw.toLowerCase())
    .slice(0, 32);
  const value = `${hex.slice(0, 12)}8${hex.slice(13, 16)}${((parseInt(hex[16]!, 16) & 3) | 8).toString(16)}${hex.slice(17)}`;
  return z
    .uuid()
    .parse(
      `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`,
    );
}
