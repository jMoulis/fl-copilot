import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import {
  layoutScenarioInputSchema,
  layoutScenarioSourcesSchema,
  layoutScenarioPreviewSchema,
  layoutScenarioCardSchema,
} from "@fl-copilot/domain";
import { prepareStoreLayoutScenario } from "@fl-copilot/commercial-core";
import { readCopilotStoreLayoutSnapshot } from "./store-layout-tool";
import {
  serializeProductDocument,
  type ProductDocument,
} from "../products/product-master";
import {
  serializeCommercialChoice,
  type OfferChoiceDocument,
} from "../commercial/offer-choice-sync";
/** Exact authorized IDs only, bounded canonical reads with a final stability check. No business write. */
export async function readStoreLayoutScenarioSources(
  db: Db,
  storeId: string,
  raw: unknown,
) {
  const input = layoutScenarioInputSchema.parse(raw),
    layout = await readCopilotStoreLayoutSnapshot(db, storeId),
    refs = input.assignments.flatMap((a) => a.items);
  const offerIds = [
    ...new Set(refs.filter((r) => r.kind === "OFFER").map((r) => r.id)),
  ].sort();
  const offers = async () =>
    offerIds.length
      ? (
          await db
            .collection<OfferChoiceDocument>("commercialOfferChoices")
            .find({ storeId, _id: { $in: offerIds } })
            .sort({ _id: 1 })
            .maxTimeMS(2000)
            .limit(17)
            .toArray()
        ).map((r) => {
          const c = serializeCommercialChoice(r);
          if (c.id !== r._id) throw Error("LAYOUT_SCENARIO_SCOPE_INVALID");
          return c;
        })
      : [];
  const choices = await offers();
  const productIds = [
    ...new Set([
      ...refs.filter((r) => r.kind === "PRODUCT").map((r) => r.id),
      ...choices.map((c) => c.productId),
    ]),
  ].sort();
  const products = async () =>
    productIds.length
      ? (
          await db
            .collection<ProductDocument>("products")
            .find({ storeId, _id: { $in: productIds } })
            .sort({ _id: 1 })
            .maxTimeMS(2000)
            .limit(17)
            .toArray()
        ).map(serializeProductDocument)
      : [];
  const first = await products();
  const [freshHead, freshProducts, freshChoices] = await Promise.all([
    db
      .collection<{
        _id: string;
        storeId: string;
        referenceRevisionId: string | null;
      }>("storeLayouts")
      .findOne(
        { _id: storeId, storeId },
        { projection: { referenceRevisionId: 1 }, maxTimeMS: 2000 },
      ),
    products(),
    offers(),
  ]);
  if (
    (freshHead?.referenceRevisionId ?? null) !==
      (layout.head?.referenceRevisionId ?? null) ||
    JSON.stringify(freshProducts) !== JSON.stringify(first) ||
    JSON.stringify(freshChoices) !== JSON.stringify(choices)
  )
    throw Error("LAYOUT_SCENARIO_SOURCE_CHANGED");
  return layoutScenarioSourcesSchema.parse({
    layout,
    products: first,
    choices,
  });
}
export function presentStoreLayoutScenario(
  storeId: string,
  raw: unknown,
  sources: unknown,
) {
  const prepared = prepareStoreLayoutScenario(storeId, raw, sources);
  let result: {
    input: typeof prepared.input;
    status: typeof prepared.status | "LIMIT_EXCEEDED";
    scenario: typeof prepared.scenario;
    message: string;
  } = prepared;
  if (
    prepared.scenario &&
    JSON.stringify(
      layoutScenarioCardSchema.parse({
        kind: "STORE_LAYOUT_SCENARIO",
        schemaVersion: 1,
        assistantMessageId: "00000000-0000-4000-8000-000000000001",
        scenario: prepared.scenario,
      }),
    ).length > 15000
  )
    result = {
      ...prepared,
      status: "LIMIT_EXCEEDED",
      scenario: null,
      message:
        "La proposition est trop détaillée pour une carte. Préparez un sous-ensemble cohérent, sans supprimer silencieusement des affectations.",
    };
  const digest = createHash("sha256")
    .update(JSON.stringify(result))
    .digest("hex");
  return layoutScenarioPreviewSchema.parse({
    ...result,
    evidence: [
      {
        id: `store-layout-scenario/${digest}`,
        sourceType: "DATA_QUALITY",
        sourceId: result.scenario?.physicalRevisionId ?? storeId,
        sourceVersion: result.scenario?.physicalVersion ?? null,
        factKind: "QUALITY",
        label: "Proposition d’affectation sur le plan du magasin",
        value: result.message,
        detail: result.scenario
          ? `${result.scenario.assignments.length} cibles, ${result.scenario.items.length} références ; semaine du ${result.scenario.weekStart}. Révision physique ${result.scenario.physicalVersion}. ${result.scenario.geometry.missing} points physiques à préciser. Schéma proposé, sans quantité, capacité, chiffre commercial ni image générée.`
          : "Aucune affectation enregistrée comme plan commercial ni installation.",
      },
    ],
  });
}
