import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import {
  copilotOfferValidationInputSchema,
  copilotOfferValidationPreviewSchema,
  offerValidationPreviewRequest,
  isCommercialOriginalSource,
} from "@fl-copilot/domain";
import { synchronizedCommercialVisualReadingSchema } from "@fl-copilot/sync-contracts";
import {
  commercialValidatedOfferId,
  commercialOfferValidationSource,
  commercialValidatedOfferSameBusiness,
  commercialChoiceProductUnitMatches,
  projectCommercialSourceOffer,
  projectCommercialOriginalOffer,
} from "@fl-copilot/commercial-core";
import {
  serializeCommercialChoice,
  type OfferChoiceDocument,
} from "../commercial/offer-choice-sync";
import {
  serializeValidatedOffer,
  type ValidatedOfferDocument,
} from "../commercial/validated-offer-sync";
import {
  serializeProductDocument,
  type ProductDocument,
} from "../products/product-master";
import type { VisualReadingDocument } from "../commercial/visual-reading-store";
import { readCommercialOriginalSourceStates } from "../commercial/original-source-verification";
const digest = async (s: string) =>
  createHash("sha256").update(s).digest("hex");
export async function previewOfferValidation(
  db: Db,
  storeId: string,
  raw: unknown,
) {
  const input = copilotOfferValidationInputSchema.parse(raw),
    choices = await db
      .collection<OfferChoiceDocument>("commercialOfferChoices")
      .find({ storeId, _id: { $in: input.choiceIds } })
      .maxTimeMS(2000)
      .limit(25)
      .toArray();
  let status:
    "READY" | "UNCHANGED" | "BLOCKED" | "UNAVAILABLE" | "LIMIT_EXCEEDED" =
    "READY";
  let basis: ReturnType<
    typeof copilotOfferValidationPreviewSchema.parse
  >["basis"] = { storeId, entries: [] };
  const alreadyValidatedIds: string[] = [];
  let issue: ReturnType<
    typeof copilotOfferValidationPreviewSchema.parse
  >["issue"] = null;
  const selected = choices.map(serializeCommercialChoice);
  const [products, pages, validationIds, originals] = await Promise.all([
    db
      .collection<ProductDocument>("products")
      .find({
        storeId,
        _id: { $in: selected.map((c) => c.productId) },
        status: "ACTIVE",
        deletedAt: null,
      })
      .maxTimeMS(2000)
      .limit(25)
      .toArray(),
    db
      .collection<VisualReadingDocument>("commercialVisualReadings")
      .find({
        storeId,
        _id: {
          $in: selected.flatMap((c) =>
            isCommercialOriginalSource(c.source) ? [] : [c.source.readingId],
          ),
        },
        status: "READY",
      })
      .maxTimeMS(2000)
      .limit(25)
      .toArray(),
    Promise.all(
      selected.map((c) =>
        commercialValidatedOfferId(storeId, c.id, c.version, digest),
      ),
    ),
    readCommercialOriginalSourceStates(
      db,
      storeId,
      selected.map((c) => c.source),
    ),
  ]);
  const validations = await db
    .collection<ValidatedOfferDocument>("commercialValidatedOffers")
    .find({ storeId, _id: { $in: validationIds } })
    .maxTimeMS(2000)
    .limit(25)
    .toArray();
  for (const id of input.choiceIds) {
    const row = choices.find((r) => r._id === id);
    if (!row) {
      issue = { choiceId: id, label: null, code: "MISSING_CHOICE" };
      status = "UNAVAILABLE";
      break;
    }
    const choice = serializeCommercialChoice(row);
    if (choice.status !== "RETAINED") {
      issue = {
        choiceId: id,
        label: choice.rawProductLabel,
        code: "WITHDRAWN",
      };
      status = "BLOCKED";
      break;
    }
    const choiceSource = choice.source;
    const productRow = products.find((p) => p._id === choice.productId),
      pageRow = isCommercialOriginalSource(choiceSource)
        ? undefined
        : pages.find((p) => p._id === choiceSource.readingId);
    const sourceAvailable = isCommercialOriginalSource(choiceSource)
      ? originals.some(
          (s) =>
            s.storeId === storeId &&
            s.sourceDocumentId === choiceSource.sourceDocumentId &&
            s.checksum === choiceSource.checksum,
        )
      : !!pageRow;
    if (!productRow || !sourceAvailable) {
      issue = {
        choiceId: id,
        label: choice.rawProductLabel,
        code: !productRow ? "PRODUCT_UNAVAILABLE" : "SOURCE_UNAVAILABLE",
      };
      status = "UNAVAILABLE";
      break;
    }
    const product = serializeProductDocument(productRow),
      page = pageRow
        ? synchronizedCommercialVisualReadingSchema.parse(pageRow)
        : null;
    if (
      choice.storeId !== storeId ||
      product.storeId !== storeId ||
      (page && (page.id !== pageRow!._id || page.storeId !== storeId))
    )
      throw Error("OFFER_VALIDATION_SCOPE");
    const validationId = validationIds[selected.findIndex((c) => c.id === id)]!,
      old = validations.find((v) => v._id === validationId),
      validation = old ? serializeValidatedOffer(old) : null;
    try {
      const source = commercialOfferValidationSource(
          choice,
          page ? [page] : [],
        ),
        offer = isCommercialOriginalSource(choiceSource)
          ? projectCommercialOriginalOffer({
              source: choiceSource,
              operationKind: choice.operationKind,
              operationLabel: choice.operationLabel,
              rawProductLabel: choice.rawProductLabel,
            })
          : projectCommercialSourceOffer(
              page!,
              choiceSource.operationIndex,
              choiceSource.itemIndex,
            );
      if (
        !commercialChoiceProductUnitMatches(choice, product.salesUnit) ||
        (validation &&
          !commercialValidatedOfferSameBusiness(validation, {
            ...validation,
            choice,
            ...source,
          }))
      )
        throw Error("INVALID_SOURCE_OR_UNITS");
      basis.entries.push({ choice, product, offer, validation });
      if (validation) alreadyValidatedIds.push(id);
    } catch {
      issue = {
        choiceId: id,
        label: choice.rawProductLabel,
        code: !commercialChoiceProductUnitMatches(choice, product.salesUnit)
          ? "UNIT_MISMATCH"
          : "SOURCE_CHANGED",
      };
      status = "BLOCKED";
      break;
    }
  }
  if (status === "READY") {
    offerValidationPreviewRequest(
      input,
      basis,
      "00000000-0000-4000-8000-000000000001",
    );
    if (alreadyValidatedIds.length === input.choiceIds.length) {
      status = "UNCHANGED";
      basis = null;
    } else if (
      Buffer.byteLength(JSON.stringify({ input, basis }), "utf8") > 14000
    ) {
      status = "LIMIT_EXCEEDED";
      basis = null;
    }
  } else basis = null;
  if (status === "BLOCKED" || status === "UNAVAILABLE")
    alreadyValidatedIds.splice(0);
  return copilotOfferValidationPreviewSchema.parse({
    storeId,
    input,
    status,
    basis,
    alreadyValidatedIds,
    issue,
    evidence: [
      {
        id: `offer-validation/${await digest(JSON.stringify([storeId, input, basis, status, alreadyValidatedIds]))}`,
        sourceType: "DATA_QUALITY",
        sourceId: storeId,
        sourceVersion: null,
        label: "Validation commerciale des offres retenues",
        value:
          status === "READY"
            ? `${input.choiceIds.length} offre(s) à revoir ; ${alreadyValidatedIds.length} validation(s) existante(s) conservée(s). Confirmation explicite de la revue des sources requise. Aucun plan, TG ni exécution validé.`
            : status === "UNCHANGED"
              ? "Toutes ces versions d’offres sont déjà validées ; aucune nouvelle action."
              : status === "BLOCKED"
                ? `Validation bloquée pour ${issue?.label ?? "l’offre demandée"} : ${issue?.code === "WITHDRAWN" ? "offre retirée" : issue?.code === "UNIT_MISMATCH" ? "unité du prix incompatible avec l’unité de vente du produit" : "source ou validation existante différente"}. Examiner cette offre ; aucune ligne du lot n’est validée.`
                : status === "LIMIT_EXCEEDED"
                  ? "Revue complète trop volumineuse : sélectionner un lot plus petit ou utiliser l’écran des offres, sans tronquer la confirmation."
                  : `${issue?.label ?? "L’offre demandée"} : ${issue?.code === "PRODUCT_UNAVAILABLE" ? "produit actif indisponible" : issue?.code === "SOURCE_UNAVAILABLE" ? "source indisponible" : "offre indisponible"} dans les données synchronisées du magasin. Aucun élément du lot n’est validé.`,
        factKind: "QUALITY",
      },
    ],
  });
}
