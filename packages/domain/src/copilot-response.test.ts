import { describe, expect, it } from "vitest";
import { copilotResponseSchema } from "./copilot-response";

const response = {
  language: "fr-FR",
  summary: "Les données de vente sont incomplètes.",
  facts: [{ evidenceId: "sales-coverage" }],
  interpretation: [],
  recommendations: [],
  questions: ["Peux-tu importer les ventes manquantes ?"],
};
const recommendation = {
  candidateId: "candidate-1",
  type: "INVESTIGATE_MARGIN_DROP",
  title: "Examiner la marge",
  explanation: "Vérifier les informations disponibles avant de conclure.",
  evidenceIds: ["margin-comparison"],
  confidence: "LOW",
  risks: ["Le coût d’achat est indisponible."],
  missingData: ["Coût d’achat"],
  measurement: {
    objective: "Comparer la marge sur une période complète.",
    evidenceIds: ["margin-comparison"],
    reviewWhen: "Après réception des ventes manquantes.",
  },
};
describe("French copilot response contract", () => {
  it("accepts ordinary clarification without mandatory priorities", () => {
    expect(copilotResponseSchema.parse(response)).toEqual(response);
  });
  it("requires recommendation evidence and measurement without model-authored facts", () => {
    expect(
      copilotResponseSchema.safeParse({
        ...response,
        recommendations: [recommendation],
      }).success,
    ).toBe(true);
    for (const invalid of [
      { ...recommendation, evidenceIds: [] },
      { ...recommendation, type: "CHANGE_OFFICIAL_MARGIN" },
      { ...recommendation, executed: true },
      { ...recommendation, measurement: null },
    ])
      expect(
        copilotResponseSchema.safeParse({
          ...response,
          recommendations: [invalid],
        }).success,
      ).toBe(false);
    expect(
      copilotResponseSchema.safeParse({
        ...response,
        facts: [{ evidenceId: "sales", value: 123 }],
      }).success,
    ).toBe(false);
  });
  it("rejects fourth priorities and non-French language declarations", () => {
    expect(
      copilotResponseSchema.safeParse({
        ...response,
        recommendations: Array(4).fill(recommendation),
      }).success,
    ).toBe(false);
    expect(
      copilotResponseSchema.safeParse({ ...response, language: "en-US" })
        .success,
    ).toBe(false);
  });
});
