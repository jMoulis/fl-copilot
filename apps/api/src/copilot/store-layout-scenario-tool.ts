import { createHash } from "node:crypto";
import {
  layoutScenarioPreviewSchema,
  layoutScenarioCardSchema,
} from "@fl-copilot/domain";
import { prepareStoreLayoutScenario } from "@fl-copilot/commercial-core";
export { readStoreLayoutScenarioSources } from "../commercial/physical-allocation-sources";
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
