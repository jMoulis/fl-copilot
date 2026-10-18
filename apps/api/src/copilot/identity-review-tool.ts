import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import { z } from "zod";
import {
  identityReviewInputSchema,
  identityReviewPreviewSchema,
  identityReviewBasisSchema,
  identityReviewBasisMatches,
  identityReviewDesiredStatus,
  identityReviewAliasReadiness,
  IDENTITY_REVIEW_PRODUCT_LIMIT,
} from "@fl-copilot/domain";
import {
  serializeProductDocument,
  serializeProductAliasDocument,
  serializeProductIdentifierDocument,
  type ProductDocument,
  type ProductAliasDocument,
  type ProductIdentifierDocument,
} from "../products/product-master.js";
export async function readIdentityReviewPreview(
  db: Db,
  storeId: string,
  raw: unknown,
) {
  z.uuid().parse(storeId);
  const input = identityReviewInputSchema.parse(raw);
  const product = await db
    .collection<ProductDocument>("products")
    .findOne(
      { _id: input.productId, storeId, status: "ACTIVE", deletedAt: null },
      { maxTimeMS: 2000 },
    );
  const filter = {
    _id: input.entryId,
    productId: input.productId,
    storeId,
    deletedAt: null,
  };
  const entry = !product
    ? null
    : input.kind === "ALIAS"
      ? await db
          .collection<ProductAliasDocument>("productAliases")
          .findOne(filter, { maxTimeMS: 2000 })
          .then((v) => v && serializeProductAliasDocument(v))
      : await db
          .collection<ProductIdentifierDocument>("productIdentifiers")
          .findOne(filter, { maxTimeMS: 2000 })
          .then((v) => v && serializeProductIdentifierDocument(v));
  const before =
    product && entry
      ? identityReviewBasisSchema.parse({
          product: serializeProductDocument(product),
          entry,
        })
      : null;
  if (
    before &&
    (before.product.storeId !== storeId ||
      !identityReviewBasisMatches(input, before))
  )
    throw Error("READ_SCOPE_INVALID");
  let status:
    "READY" | "UNAVAILABLE" | "UNCHANGED" | "AMBIGUOUS" | "LIMIT_EXCEEDED" =
    !before
      ? "UNAVAILABLE"
      : before.entry.status === identityReviewDesiredStatus(input)
        ? "UNCHANGED"
        : "READY";
  if (before && status === "READY" && input.decision === "VALIDATE") {
    if ("alias" in before.entry) {
      const collision = await db
        .collection<ProductAliasDocument>("productAliases")
        .findOne(
          {
            storeId,
            normalizedAlias: before.entry.normalizedAlias,
            productId: { $ne: input.productId },
            status: "VALIDATED",
            deletedAt: null,
          },
          { projection: { _id: 1 }, maxTimeMS: 2000 },
        );
      const products = await db
        .collection<ProductDocument>("products")
        .find(
          { storeId, status: "ACTIVE", deletedAt: null },
          { projection: { _id: 1, label: 1 } },
        )
        .sort({ _id: 1 })
        .limit(IDENTITY_REVIEW_PRODUCT_LIMIT + 1)
        .maxTimeMS(2000)
        .toArray();
      status = identityReviewAliasReadiness(
        input.productId,
        before.entry.normalizedAlias,
        !!collision,
        products.map((p) => ({ id: p._id, label: p.label })),
      );
    } else {
      const collision = await db
        .collection<ProductIdentifierDocument>("productIdentifiers")
        .findOne(
          {
            storeId,
            _id: { $ne: input.entryId },
            type: before.entry.type,
            value: before.entry.value,
            deletedAt: null,
          },
          { projection: { _id: 1 }, maxTimeMS: 2000 },
        );
      if (collision) status = "AMBIGUOUS";
    }
  }
  const digest = createHash("sha256")
    .update(JSON.stringify([storeId, input, before, status]))
    .digest("hex");
  return identityReviewPreviewSchema.parse({
    input,
    status,
    before,
    evidence: [
      {
        id: `identity-review/${digest}`,
        sourceType: "DATA_QUALITY",
        sourceId: input.entryId,
        sourceVersion: before?.entry.version ?? null,
        label: "Décision sur une correspondance produit",
        value:
          status === "READY"
            ? `Décision ${input.decision} préparée, non enregistrée. Confirmation sur l’appareil requise${before?.entry.status === "REJECTED" ? ", avec réactivation explicite de l’alias refusé" : ""}.`
            : status === "UNCHANGED"
              ? "Cette décision est déjà enregistrée."
              : "Correspondance indisponible, ambiguë ou limite de vérification atteinte. Aucune modification préparée.",
        factKind: "QUALITY",
      },
    ],
  });
}
