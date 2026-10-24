import { readStoreLayoutScenarioSources } from "../commercial/physical-allocation-sources";
import { readCommercialOriginalSourceStates } from "../commercial/original-source-verification";
import { layoutScenarioInput } from "@fl-copilot/domain";
import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import {
  copilotPlanReadinessInputSchema,
  copilotPlanReadinessResultSchema,
  isCommercialOriginalSource,
} from "@fl-copilot/domain";
import { synchronizedCommercialVisualReadingSchema } from "@fl-copilot/sync-contracts";
import {
  commercialPlanIssues,
  type CommercialPlanContext,
  commercialValidatedOfferId,
  commercialChoiceProductUnitMatches,
} from "@fl-copilot/commercial-core";
import { loadCommercialPreparationContext } from "./commercial-preparation-tool";
import {
  serializeProductDocument,
  type ProductDocument,
} from "../products/product-master";
import {
  serializeValidatedOffer,
  type ValidatedOfferDocument,
} from "../commercial/validated-offer-sync";
import {
  serializeCommercialVersionDecision,
  type VersionDecisionDocument,
} from "../commercial/version-decision-sync";
import type { VisualReadingDocument } from "../commercial/visual-reading-store";
const digest = async (s: string) =>
  createHash("sha256").update(s).digest("hex");
/** Advisory synchronized readiness only; native confirmation rechecks current local dependencies. */
export async function loadCommercialPlanReadiness(
  db: Db,
  storeId: string,
  raw: unknown,
) {
  const input = copilotPlanReadinessInputSchema.parse(raw);
  const { preparation: prep, all: choices } =
    await loadCommercialPreparationContext(db, storeId, {
      ...input,
      offset: 0,
      limit: 10,
    });
  const summary = prep
    ? {
        id: prep.id,
        version: prep.version,
        selectedOfferCount: prep.offerRefs.length,
        placementCount: prep.placements.length,
        tgCapacity: prep.tgCapacity,
      }
    : null;
  let status: "READY" | "BLOCKED" | "NO_DRAFT" | "LIMIT_EXCEEDED" = prep
    ? "READY"
    : "NO_DRAFT";
  let issues: ReturnType<
    typeof copilotPlanReadinessResultSchema.parse
  >["issues"] = [];
  let context: CommercialPlanContext | null = null;
  if (prep) {
    const readingIds = [
      ...new Set([
        ...choices.flatMap((c) =>
          isCommercialOriginalSource(c.source) ? [] : [c.source.readingId],
        ),
        ...prep.placements.flatMap((p) =>
          p.sourceIdea ? [p.sourceIdea.readingId] : [],
        ),
      ]),
    ];
    const docs = [...new Set(choices.map((c) => c.source.sourceDocumentId))];
    const validationIds = await Promise.all(
      choices.map((c) =>
        commercialValidatedOfferId(storeId, c.id, c.version, digest),
      ),
    );
    const [productRows, validationRows, preferenceRows, pageRows] =
      await Promise.all([
        db
          .collection<ProductDocument>("products")
          .find({
            storeId,
            _id: { $in: choices.map((c) => c.productId) },
            status: "ACTIVE",
            deletedAt: null,
          })
          .maxTimeMS(2000)
          .limit(101)
          .toArray(),
        db
          .collection<ValidatedOfferDocument>("commercialValidatedOffers")
          .find({ storeId, _id: { $in: validationIds } })
          .maxTimeMS(2000)
          .limit(101)
          .toArray(),
        db
          .collection<VersionDecisionDocument>("commercialVersionDecisions")
          .find({
            storeId,
            $or: [
              { "before.documentId": { $in: docs } },
              { "after.documentId": { $in: docs } },
            ],
          })
          .maxTimeMS(2000)
          .limit(201)
          .toArray(),
        db
          .collection<VisualReadingDocument>("commercialVisualReadings")
          .find({ storeId, _id: { $in: readingIds } })
          .maxTimeMS(2000)
          .limit(131)
          .toArray(),
      ]);
    if (
      productRows.length > 100 ||
      validationRows.length > 100 ||
      preferenceRows.length > 200 ||
      pageRows.length > 130
    )
      status = "LIMIT_EXCEEDED";
    else {
      const products = productRows.map(serializeProductDocument),
        validated = validationRows.map(serializeValidatedOffer),
        preferences = preferenceRows.map(serializeCommercialVersionDecision),
        pages = pageRows.map((p) =>
          synchronizedCommercialVisualReadingSchema.parse(p),
        );
      for (const rows of [products, validated, preferences, pages])
        if (rows.some((r) => r.storeId !== storeId))
          throw Error("COPILOT_PLAN_READINESS_SCOPE");
      for (const [rows, parsed] of [
        [productRows, products],
        [validationRows, validated],
        [preferenceRows, preferences],
        [pageRows, pages],
      ] as const)
        if (rows.some((row, i) => row._id !== parsed[i]!.id))
          throw Error("COPILOT_PLAN_READINESS_SCOPE");
      let allocationSources: unknown;
      if (prep.physicalAllocation)
        try {
          allocationSources = await readStoreLayoutScenarioSources(
            db,
            storeId,
            layoutScenarioInput(prep.physicalAllocation),
          );
        } catch {
          /* A complete commercial validation needs this source. */
        }
      context = {
        allocationSources,
        preparation: prep,
        choices,
        products: products.map((p) => ({
          id: p.id,
          label: p.label,
          version: p.version,
        })),
        validated,
        preferences,
        pages,
        originalSources: await readCommercialOriginalSourceStates(
          db,
          storeId,
          choices.map((c) => c.source),
        ),
      };
      issues = commercialPlanIssues(prep, context).map((i) => ({
        ...i,
        label: i.choiceId
          ? (choices.find((c) => c.id === i.choiceId)?.rawProductLabel ?? null)
          : i.placementId
            ? (prep.placements.find((p) => p.id === i.placementId)?.label ??
              null)
            : null,
      }));
      for (const choice of choices) {
        const product = products.find((p) => p.id === choice.productId);
        if (
          product &&
          !commercialChoiceProductUnitMatches(choice, product.salesUnit)
        )
          issues.push({
            code: "UNIT_MISMATCH",
            choiceId: choice.id,
            label: choice.rawProductLabel,
            messageFr:
              "L’unité du prix de cette offre ne correspond pas à l’unité de vente du produit. Revoyez l’offre ou le produit.",
          });
      }
      if (
        issues.length > 200 ||
        Buffer.byteLength(JSON.stringify({ summary, issues }), "utf8") > 14000
      ) {
        status = "LIMIT_EXCEEDED";
        issues = [];
      } else if (issues.length) status = "BLOCKED";
    }
  }
  let value =
    status === "READY"
      ? "La préparation synchronisée satisfait les contrôles de validation du plan : offres validées, produits, sources et références disponibles. Ceci est un diagnostic, pas un plan enregistré ; une confirmation native avec recontrôle local reste nécessaire. Aucune mise en rayon déclarée."
      : status === "NO_DRAFT"
        ? "Aucun brouillon synchronisé pour cette semaine. Une préparation locale non synchronisée peut exister ; consulter ou synchroniser avant de la recréer."
        : status === "LIMIT_EXCEEDED"
          ? "Contrôle complet trop volumineux. Aucun résultat partiel ne vaut autorisation de validation ; examiner le plan dans Ma semaine."
          : `${issues.length} point(s) à résoudre avant validation : ${issues.map((i) => `${i.label ? i.label + " : " : ""}${i.messageFr}`).join(" ")} Aucun plan n’a été enregistré ni exécuté.`;
  if (
    status === "BLOCKED" &&
    (value.length > 9000 ||
      Buffer.byteLength(JSON.stringify({ summary, issues, value }), "utf8") >
        13000)
  ) {
    status = "LIMIT_EXCEEDED";
    issues = [];
    value =
      "Contrôle complet trop volumineux. Aucun résultat partiel ne vaut autorisation de validation ; examiner le plan dans Ma semaine.";
  }
  const result = copilotPlanReadinessResultSchema.parse({
    storeId,
    weekStart: input.weekStart,
    status,
    preparation: summary,
    issues,
    evidence: [
      {
        id: `plan-readiness/${await digest(JSON.stringify([storeId, input, summary, status, issues]))}`,
        sourceType: "DATA_QUALITY",
        sourceId: prep?.id ?? storeId,
        sourceVersion: prep?.version ?? null,
        label: "Vérification du plan de la semaine",
        value,
        factKind: "QUALITY",
      },
    ],
  });
  return { result, context, preparation: prep };
}
export async function readCommercialPlanReadiness(
  db: Db,
  storeId: string,
  raw: unknown,
) {
  return (await loadCommercialPlanReadiness(db, storeId, raw)).result;
}
