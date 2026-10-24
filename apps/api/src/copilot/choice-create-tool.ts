import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import {
  copilotChoiceCreateInputSchema,
  copilotChoiceCreatePreviewSchema,
  choiceCreateRequest,
  commercialOfferChoiceSchema,
  isCommercialOriginalSource,
} from "@fl-copilot/domain";
import { synchronizedCommercialVisualReadingSchema } from "@fl-copilot/sync-contracts";
import {
  projectCommercialSourceOffer,
  projectCommercialOriginalOffer,
  commercialChoiceId,
  commercialChoiceDuplicateKey,
  commercialChoiceProductUnitMatches,
} from "@fl-copilot/commercial-core";
import {
  serializeProductDocument,
  type ProductDocument,
} from "../products/product-master.js";
import { type VisualReadingDocument } from "../commercial/visual-reading-store.js";
import { type OfferChoiceDocument } from "../commercial/offer-choice-sync.js";
const digest = async (s: string) =>
  createHash("sha256").update(s).digest("hex");
export async function previewChoiceCreate(
  db: Db,
  storeId: string,
  raw: unknown,
) {
  const input = copilotChoiceCreateInputSchema.parse(raw),
    id = await commercialChoiceId(storeId, input.source, digest);
  const existing = await db
    .collection<OfferChoiceDocument>("commercialOfferChoices")
    .findOne({ _id: id, storeId }, { maxTimeMS: 2000 });
  let status:
    "READY" | "ALREADY_EXISTS" | "BLOCKED" | "UNAVAILABLE" | "LIMIT_EXCEEDED" =
    existing ? "ALREADY_EXISTS" : "UNAVAILABLE";
  let basis: ReturnType<
    typeof copilotChoiceCreatePreviewSchema.parse
  >["basis"] = null;
  if (!existing) {
    const source = await db
      .collection<{ _id: string; storeId: string; checksum: string }>(
        "sourceDocuments",
      )
      .findOne(
        {
          _id: input.source.sourceDocumentId,
          storeId,
          checksum: input.source.checksum,
          sourceType: "WEEKLY_COMMERCIAL_PDF",
          remoteUploadStatus: "CONFIRMED",
          deletedAt: null,
        },
        { maxTimeMS: 2000 },
      );
    const choiceSource = input.source;
    const row =
      source && !isCommercialOriginalSource(choiceSource)
        ? await db
            .collection<VisualReadingDocument>("commercialVisualReadings")
            .findOne(
              {
                _id: choiceSource.readingId,
                storeId,
                sourceDocumentId: source._id,
                checksum: source.checksum,
                status: "READY",
              },
              { maxTimeMS: 2000 },
            )
        : null;
    const product = await db
      .collection<ProductDocument>("products")
      .findOne(
        { _id: input.productId, storeId, status: "ACTIVE", deletedAt: null },
        { maxTimeMS: 2000 },
      );
    if (
      source &&
      product &&
      (isCommercialOriginalSource(choiceSource) || row)
    ) {
      const page = row
        ? synchronizedCommercialVisualReadingSchema.parse(row)
        : null;
      if (page && (page.id !== row!._id || page.storeId !== storeId))
        throw Error("CHOICE_CREATE_SCOPE");
      try {
        basis = {
          storeId,
          offer: isCommercialOriginalSource(choiceSource)
            ? projectCommercialOriginalOffer({
                source: choiceSource,
                ...input.originalDescription!,
              })
            : projectCommercialSourceOffer(
                page!,
                choiceSource.operationIndex,
                choiceSource.itemIndex,
              ),
          product: serializeProductDocument(product),
        };
        const request = choiceCreateRequest(
          input,
          basis,
          "00000000-0000-4000-8000-000000000001",
        );
        // Whole-choice rules, including lot coherence and calendar ordering, remain canonical.
        const choice = commercialOfferChoiceSchema.parse({
          ...request.input.draft,
          id,
          storeId,
          version: 1,
          createdAt: "2000-01-01T00:00:00Z",
          updatedAt: "2000-01-01T00:00:00Z",
        });
        status = commercialChoiceProductUnitMatches(
          choice,
          basis.product.salesUnit,
        )
          ? "READY"
          : "BLOCKED";
      } catch {
        status = "BLOCKED";
      }
      if (status !== "READY") basis = null;
      else {
        const draft = choiceCreateRequest(
          input,
          basis!,
          "00000000-0000-4000-8000-000000000001",
        ).input.draft;
        const key = createHash("sha256")
          .update(
            commercialChoiceDuplicateKey({
              ...draft,
              id,
              storeId,
              version: 1,
              createdAt: "2000-01-01T00:00:00Z",
              updatedAt: "2000-01-01T00:00:00Z",
            }),
          )
          .digest("hex");
        if (
          await db
            .collection<OfferChoiceDocument>("commercialOfferChoices")
            .findOne(
              { storeId, status: "RETAINED", duplicateKey: key },
              { maxTimeMS: 2000 },
            )
        ) {
          status = "BLOCKED";
          basis = null;
        }
      }
    }
  }
  if (Buffer.byteLength(JSON.stringify({ input, basis }), "utf8") > 14000) {
    status = "LIMIT_EXCEEDED";
    basis = null;
  }
  return copilotChoiceCreatePreviewSchema.parse({
    input,
    status,
    basis,
    existingChoice:
      status === "ALREADY_EXISTS"
        ? {
            id: existing!._id,
            status: existing!.status,
            version: existing!.version,
          }
        : null,
    evidence: [
      {
        id: `choice-create/${await digest(JSON.stringify([storeId, input, status, basis]))}`,
        sourceType: "DATA_QUALITY",
        sourceId: input.source.sourceDocumentId,
        sourceVersion: 1,
        label: "Sélection initiale d’une offre",
        value:
          status === "READY"
            ? "Offre préparée, non enregistrée. Le responsable doit vérifier le produit, les dates et toutes les conditions avec la source, puis confirmer son applicabilité au magasin. Aucun plan ni TG validé."
            : status === "ALREADY_EXISTS"
              ? "Un choix existe déjà pour cette offre source. Examiner son état ; aucune création, réactivation ou modification implicite."
              : status === "BLOCKED"
                ? "Sélection bloquée : vérifier la source, les dates, le mécanisme, les unités ou un doublon."
                : status === "LIMIT_EXCEEDED"
                  ? "Aperçu trop volumineux : utiliser l’écran de l’offre, sans confirmation tronquée."
                  : "Source ou produit actif indisponible dans les données synchronisées de ce magasin.",
        factKind: "QUALITY",
      },
    ],
  });
}
