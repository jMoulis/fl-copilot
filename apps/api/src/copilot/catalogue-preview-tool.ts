import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "mongodb";
import {
  copilotCatalogueInputSchema,
  copilotCataloguePreviewSchema,
  catalogueSnapshotDraft,
  catalogueSnapshotIdentity,
  prepareCatalogueRequest,
  catalogueSnapshotSchema,
} from "@fl-copilot/domain";
import {
  serializeProductDocument,
  serializeProductAliasDocument,
  serializeProductIdentifierDocument,
  type ProductDocument,
  type ProductAliasDocument,
  type ProductIdentifierDocument,
} from "../products/product-master.js";
const operationId = "00000000-0000-4000-8000-000000000001";
export async function readCataloguePreview(
  db: Db,
  storeId: string,
  raw: unknown,
  options: { allowInactiveMaintenance?: boolean } = {},
) {
  z.uuid().parse(storeId);
  const input = copilotCatalogueInputSchema.parse(raw);
  const product = input.productId
    ? await db.collection<ProductDocument>("products").findOne(
        {
          _id: input.productId,
          storeId,
          deletedAt: null,
          ...(options.allowInactiveMaintenance && input.action !== "RETIRE"
            ? {}
            : { status: { $ne: "INACTIVE" } }),
        },
        { maxTimeMS: 2000 },
      )
    : null;
  const [ids, aliases] = product
    ? await Promise.all([
        db
          .collection<ProductIdentifierDocument>("productIdentifiers")
          .find({ storeId, productId: product._id, deletedAt: null })
          .sort({ _id: 1 })
          .limit(21)
          .maxTimeMS(2000)
          .toArray(),
        db
          .collection<ProductAliasDocument>("productAliases")
          .find({ storeId, productId: product._id, deletedAt: null })
          .sort({ _id: 1 })
          .limit(21)
          .maxTimeMS(2000)
          .toArray(),
      ])
    : [[], []];
  const limit = ids.length > 20 || aliases.length > 20;
  const record = <T extends { version: number }>(entity: T) => ({
    entity,
    syncState: "SYNCED",
    remoteVersion: entity.version,
    dirty: false,
  });
  const before =
    product && !limit
      ? catalogueSnapshotSchema.parse({
          product: record(serializeProductDocument(product)),
          identifiers: ids.map((e) =>
            record(serializeProductIdentifierDocument(e)),
          ),
          aliases: aliases.map((e) => record(serializeProductAliasDocument(e))),
        })
      : null;
  if (
    before &&
    (before.product.entity.id !== input.productId ||
      [before.product, ...before.identifiers, ...before.aliases].some(
        (r) => r.entity.storeId !== storeId,
      ) ||
      [...before.identifiers, ...before.aliases].some(
        (r) => r.entity.productId !== input.productId,
      ))
  )
    throw Error("CATALOGUE_SCOPE_INVALID");
  let status:
    "READY" | "UNCHANGED" | "UNAVAILABLE" | "LIMIT_EXCEEDED" | "INSPECTED" =
    limit
      ? "LIMIT_EXCEEDED"
      : input.action !== "CREATE" && !before
        ? "UNAVAILABLE"
        : input.action === "INSPECT"
          ? "INSPECTED"
          : "READY";
  if (status === "READY") {
    const request = prepareCatalogueRequest(input, before, operationId);
    if (
      before &&
      request.tool === "product.save" &&
      JSON.stringify(request.input.draft) ===
        JSON.stringify(catalogueSnapshotDraft(before))
    )
      status = "UNCHANGED";
  }
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        storeId,
        input,
        catalogueSnapshotIdentity(before),
        status,
      ]),
    )
    .digest("hex");
  return copilotCataloguePreviewSchema.parse({
    input,
    status,
    before,
    evidence: [
      {
        id: `catalogue-preview/${digest}`,
        sourceType: "DATA_QUALITY",
        sourceId: input.productId ?? storeId,
        sourceVersion: before?.product.entity.version ?? null,
        label: "Aperçu de fiche produit",
        value:
          (status === "READY"
            ? `Action ${input.action} préparée pour ${before?.product.entity.label ?? input.patch.label}. Confirmation requise, aucune fiche enregistrée. Les tableaux d'identifiants/alias remplacent la liste affichée : vérifier tout retrait.`
            : status === "INSPECTED"
              ? "Fiche synchronisée consultée, sans modification. Les statuts validés ou refusés sont conservés."
              : status === "UNCHANGED"
                ? "La fiche contient déjà ces informations ; aucune modification."
                : "Fiche indisponible ou limite atteinte ; aucune action préparée.") +
          (before?.product.entity.status === "INACTIVE"
            ? " Cette fiche est inactive et le restera après cette correction."
            : ""),
        factKind: "QUALITY",
      },
    ],
  });
}
