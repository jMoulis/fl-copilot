import { z } from "zod";

const id = z.string().uuid(),
  level = z.number().finite().min(0).max(1),
  timestamp = z.string().datetime();
export const productSubstitutionSchema = z
  .object({
    id,
    storeId: id,
    sourceProductId: id,
    substituteProductId: id,
    needUnitId: id,
    needCompatibility: level,
    usageCompatibility: level,
    priceCompatibility: level.nullable(),
    packagingCompatibility: level.nullable(),
    observedSubstitution: level.nullable(),
    relationshipScore: level.nullable(),
    confidence: level.nullable(),
    evidenceCount: z.number().int().nonnegative(),
    lastEvidenceAt: timestamp.nullable(),
    status: z.enum(["PROPOSED", "VALIDATED", "LEARNING", "REJECTED"]),
    source: z.enum(["MANUAL", "AI_PROPOSED", "LEARNED"]),
    humanConfirmed: z.boolean(),
    version: z.number().int().positive(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict()
  .superRefine((e, c) => {
    if (e.sourceProductId === e.substituteProductId)
      c.addIssue({
        code: "custom",
        path: ["substituteProductId"],
        message: "Choisissez un autre produit.",
      });
    if (e.status !== "PROPOSED" && !e.humanConfirmed)
      c.addIssue({
        code: "custom",
        path: ["humanConfirmed"],
        message: "Cette relation doit être confirmée explicitement.",
      });
    if (e.status === "LEARNING" && e.evidenceCount === 0)
      c.addIssue({
        code: "custom",
        path: ["status"],
        message: "L’apprentissage nécessite des observations.",
      });
    if (
      e.evidenceCount === 0 &&
      (e.observedSubstitution !== null ||
        e.lastEvidenceAt !== null ||
        e.relationshipScore !== null ||
        e.confidence !== null)
    )
      c.addIssue({
        code: "custom",
        path: ["evidenceCount"],
        message: "Un score appris nécessite des observations.",
      });
  });
export type ProductSubstitution = z.infer<typeof productSubstitutionSchema>;
export async function productSubstitutionId(
  storeId: string,
  sourceProductId: string,
  substituteProductId: string,
  needUnitId: string,
  digest: (s: string) => Promise<string>,
) {
  // The ordered product pair is deliberately never sorted.
  const raw = (
    await digest(
      JSON.stringify([
        "product-substitution-v1",
        storeId.toLowerCase(),
        sourceProductId.toLowerCase(),
        substituteProductId.toLowerCase(),
        needUnitId.toLowerCase(),
      ]),
    )
  ).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(raw))
    throw Error("PRODUCT_SUBSTITUTION_DIGEST_INVALID");
  const chars = raw.slice(0, 32).split("");
  chars[12] = "8";
  chars[16] = (8 + (parseInt(chars[16]!, 16) & 3)).toString(16);
  const h = chars.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export function sameSubstitutionIdentity(
  a: ProductSubstitution,
  b: ProductSubstitution,
) {
  return (
    a.id === b.id &&
    a.storeId === b.storeId &&
    a.sourceProductId === b.sourceProductId &&
    a.substituteProductId === b.substituteProductId &&
    a.needUnitId === b.needUnitId
  );
}
export function sameSubstitutionLearning(
  a: ProductSubstitution,
  b: ProductSubstitution,
) {
  return (
    a.observedSubstitution === b.observedSubstitution &&
    a.relationshipScore === b.relationshipScore &&
    a.confidence === b.confidence &&
    a.evidenceCount === b.evidenceCount &&
    a.lastEvidenceAt === b.lastEvidenceAt
  );
}
export function sameSubstitutionValues(
  a: ProductSubstitution,
  b: ProductSubstitution,
) {
  return (
    sameSubstitutionIdentity(a, b) &&
    sameSubstitutionLearning(a, b) &&
    a.source === b.source &&
    a.status === b.status &&
    a.humanConfirmed === b.humanConfirmed &&
    a.needCompatibility === b.needCompatibility &&
    a.usageCompatibility === b.usageCompatibility &&
    a.priceCompatibility === b.priceCompatibility &&
    a.packagingCompatibility === b.packagingCompatibility
  );
}
export const substitutionBatchToolRequestSchema = z
  .object({
    storeId: id,
    candidates: z
      .array(
        z
          .object({
            sourceProductId: id,
            substituteProductId: id,
            needUnitId: id,
            needCompatibility: level,
            usageCompatibility: level,
            priceCompatibility: level.nullable(),
            packagingCompatibility: level.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
