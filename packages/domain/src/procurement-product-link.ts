import { z } from "zod";
import {
  buildProcurementCrosswalk,
  mercalysReferenceIdentitySchema,
  type ProcurementOfferIdentity,
} from "./procurement-crosswalk";
import { type ProductMatchCatalog } from "./product-matching";

export const referenceIdentityFactSchema = mercalysReferenceIdentitySchema
  .extend({
    ean: z.string().regex(/^\d+$/).max(80),
    pluSourceKind: z.enum(["MISSING", "TEXT", "INTEGER", "FORMATTED_INTEGER"]),
  })
  .superRefine((v, c) => {
    if ((v.plu === null) !== (v.pluSourceKind === "MISSING"))
      c.addIssue({ code: "custom", message: "PLU source kind mismatch" });
  });
export type ReferenceIdentityFact = z.infer<typeof referenceIdentityFactSchema>;
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const procurementLinkBasisSchema = z
  .strictObject({
    catalogueSnapshotId: z.uuid(),
    catalogueChecksum: hash,
    referenceDocumentId: z.uuid(),
    referenceChecksum: hash,
    referenceParserVersion: z.literal("mercalys-reference-identities.v1"),
    reference: referenceIdentityFactSchema,
    method: z.enum(["EXPLICIT_PLU", "ITM_CANDIDATE", "MANUAL"]),
    reason: z.string().trim().min(1).max(500).nullable(),
  })
  .superRefine((v, c) => {
    if (v.method === "MANUAL" && v.reason === null)
      c.addIssue({ code: "custom", message: "Manual link requires a reason" });
  });
export const procurementProductLinkSchema = z.strictObject({
  id: z.uuid(),
  storeId: z.uuid(),
  genericId: z.string().min(1).max(80),
  productId: z.uuid(),
  status: z.enum(["ACTIVE", "WITHDRAWN"]),
  basis: procurementLinkBasisSchema,
  version: z.number().int().positive(),
  createdBy: z.uuid(),
  updatedBy: z.uuid(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type ProcurementProductLink = z.infer<
  typeof procurementProductLinkSchema
>;
export const procurementLinkReviewSchema = z
  .strictObject({
    id: z.uuid(),
    storeId: z.uuid(),
    actorId: z.uuid(),
    version: z.literal(1),
    createdAt: z.string().datetime({ offset: true }),
    decisions: z
      .array(
        z.strictObject({
          link: procurementProductLinkSchema,
          expectedVersion: z.number().int().positive().nullable(),
        }),
      )
      .min(1)
      .max(1000),
  })
  .superRefine((v, c) => {
    if (
      new Set(v.decisions.map((d) => d.link.id)).size !== v.decisions.length ||
      new Set(v.decisions.map((d) => d.link.genericId)).size !==
        v.decisions.length ||
      v.decisions.some(
        (d) =>
          d.link.storeId !== v.storeId ||
          d.link.updatedBy !== v.actorId ||
          d.link.updatedAt !== v.createdAt ||
          d.link.version !== (d.expectedVersion ?? 0) + 1,
      )
    )
      c.addIssue({ code: "custom", message: "Invalid link review lineage" });
    let bytes = 0;
    for (const char of JSON.stringify(v)) {
      const p = char.codePointAt(0)!;
      bytes += p <= 127 ? 1 : p <= 2047 ? 2 : p <= 65535 ? 3 : 4;
    }
    if (bytes > 750000)
      c.addIssue({
        code: "custom",
        message: "Link review exceeds bounded publication size",
      });
  });
export type ProcurementLinkReview = z.infer<typeof procurementLinkReviewSchema>;
export function procurementLinkIdentityKey(storeId: string, genericId: string) {
  return JSON.stringify([
    "mousquetaires-procurement-link.v1",
    z.uuid().parse(storeId).toLowerCase(),
    z.string().min(1).max(80).parse(genericId),
  ]);
}
/** UUIDv8 using the first 128 SHA-256 bits. Digest adapters stay outside Domain. */
export function procurementLinkIdFromHash(hash: string) {
  const hex = z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .parse(hash)
    .slice(7, 39)
    .split("");
  hex[12] = "8";
  hex[16] = ((parseInt(hex[16]!, 16) & 3) | 8).toString(16);
  const s = hex.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
export function validateProcurementLinkRevision(
  link: ProcurementProductLink,
  previous: ProcurementProductLink | null,
) {
  if (
    link.version !== (previous?.version ?? 0) + 1 ||
    (previous &&
      (previous.id !== link.id ||
        previous.storeId !== link.storeId ||
        previous.genericId !== link.genericId ||
        previous.createdAt !== link.createdAt ||
        previous.createdBy !== link.createdBy)) ||
    (!previous &&
      (link.createdBy !== link.updatedBy ||
        link.createdAt !== link.updatedAt ||
        link.status !== "ACTIVE"))
  )
    throw Error("PROCUREMENT_LINK_VERSION_INVALID");
  if (
    link.status === "WITHDRAWN" &&
    (!previous ||
      link.productId !== previous.productId ||
      JSON.stringify(link.basis) !== JSON.stringify(previous.basis))
  )
    throw Error("PROCUREMENT_LINK_WITHDRAWAL_INVALID");
}
const itm = (s: string) => (/^00000\d{8}$/.test(s) ? s.slice(5) : s);
/** A source reference must still have one common, validated ITM/EAN owner. */
export function referenceProductOwner(
  reference: ReferenceIdentityFact,
  catalog: ProductMatchCatalog,
  storeId: string,
) {
  const owners = (type: "ITM8" | "EAN", value: string) =>
    new Set(
      catalog.identifiers
        .filter(
          (i) =>
            i.storeId === storeId &&
            !i.deletedAt &&
            i.status === "VALIDATED" &&
            i.type === type &&
            (type === "ITM8" ? itm(i.value) === itm(value) : i.value === value),
        )
        .map((i) => i.productId),
    );
  const a = owners("ITM8", reference.itm8),
    b = owners("EAN", reference.ean);
  if (a.size !== 1 || b.size !== 1 || [...a][0] !== [...b][0]) return null;
  const product = catalog.products.find(
    (p) =>
      p.id === [...a][0] &&
      p.storeId === storeId &&
      !p.deletedAt &&
      p.status !== "INACTIVE",
  );
  return product?.id ?? null;
}
export function procurementLinkCandidates(
  offers: readonly ProcurementOfferIdentity[],
  references: readonly ReferenceIdentityFact[],
  catalog: ProductMatchCatalog,
  storeId: string,
) {
  return buildProcurementCrosswalk(offers, references).map((row) => ({
    ...row,
    products: row.candidates.map((r) => ({
      sourceIndex: r.sourceIndex,
      productId: referenceProductOwner(
        references.find((f) => f.sourceIndex === r.sourceIndex)!,
        catalog,
        storeId,
      ),
    })),
  }));
}
export function validateProcurementLinkChoice(
  link: ProcurementProductLink,
  offers: readonly ProcurementOfferIdentity[],
  references: readonly ReferenceIdentityFact[],
  catalog: ProductMatchCatalog,
  preview = buildProcurementCrosswalk(offers, references),
) {
  const chosen = references.find(
    (r) => r.sourceIndex === link.basis.reference.sourceIndex,
  );
  if (
    !chosen ||
    JSON.stringify(referenceIdentityFactSchema.parse(chosen)) !==
      JSON.stringify(referenceIdentityFactSchema.parse(link.basis.reference)) ||
    referenceProductOwner(chosen, catalog, link.storeId) !== link.productId
  )
    throw Error("PROCUREMENT_LINK_REFERENCE_CHANGED");
  const row = preview.find((r) => r.genericId === link.genericId);
  if (!row) throw Error("PROCUREMENT_LINK_GENERIC_MISSING");
  if (link.basis.method === "MANUAL") return;
  if (
    row.candidates.length !== 1 ||
    row.candidates[0]!.sourceIndex !== chosen.sourceIndex ||
    (link.basis.method === "EXPLICIT_PLU"
      ? row.state !== "PLU_MATCH"
      : row.state !== "ITM_CANDIDATE")
  )
    throw Error("PROCUREMENT_LINK_REVIEW_REQUIRED");
}
