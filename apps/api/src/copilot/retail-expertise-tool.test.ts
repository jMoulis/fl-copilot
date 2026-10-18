import { expect, it } from "vitest";
import { copilotEvidenceSchema } from "@fl-copilot/domain";
import {
  readRetailExpertise,
  retailExpertiseToolResultSchema,
} from "./retail-expertise-tool";
import { renderAnswerText } from "./answer-text";
import { readAnswerSource } from "../../../mobile/src/copilot/answer-source";
const now = "2026-10-18T17:00:00.000Z";
it("preserves reviewed edition and links through prose/streaming to a device-readable offline source snapshot", () => {
  const result = readRetailExpertise(
    { topics: ["VISIBILITY", "SEASONALITY"] },
    now,
  );
  expect(result.evidence).toHaveLength(2);
  for (const [index, evidence] of result.evidence.entries()) {
    expect(evidence).toMatchObject({
      sourceType: "SOURCE_DOCUMENT",
      factKind: "SOURCE_INSTRUCTION",
      sourceVersion: 1,
    });
    const text = renderAnswerText(
      "Cette piste reste à vérifier dans le magasin. {{source:0}}",
      [{ evidenceId: evidence.id }],
      result.evidence,
    );
    const decoded = readAnswerSource(/copilot-source:([^)]*)/.exec(text)![1]!);
    expect(decoded.retailExpertise).toEqual(result.cards[index]!.citation);
    expect(decoded.value).toContain(result.cards[index]!.applicationHypothesis);
    expect(decoded.externalResearch).toBeUndefined();
    expect(
      renderAnswerText(
        "{{source:0}}",
        [{ evidenceId: evidence.id }],
        result.evidence,
        true,
      ),
    ).toContain("copilot-source:");
  }
});
it.each([
  "FOREIGN_TOPIC",
  "EDITED_FINDING",
  "EDITED_HYPOTHESIS",
  "EDITED_SOURCE",
  "EDITED_EVIDENCE",
  "WRONG_EDITION",
  "STALE_AS_CURRENT",
])("refuses a forged curated payload (%s)", (mode) => {
  const result = readRetailExpertise({ topics: ["VISIBILITY"] }, now);
  if (mode === "FOREIGN_TOPIC") result.input.topics = ["SEASONALITY"];
  if (mode === "EDITED_FINDING")
    result.cards[0]!.sourceFinding = "Guaranteed uplift";
  if (mode === "EDITED_HYPOTHESIS")
    result.cards[0]!.applicationHypothesis = "Guaranteed uplift";
  if (mode === "EDITED_SOURCE")
    result.cards[0]!.citation.sources[0]!.url = "https://other.example/";
  if (mode === "EDITED_EVIDENCE")
    result.evidence[0]!.value = "Invented official facts";
  if (mode === "WRONG_EDITION") Object.assign(result, { edition: "made-up" });
  if (mode === "STALE_AS_CURRENT")
    result.evaluatedAt = "2027-04-18T00:00:00.000Z";
  expect(retailExpertiseToolResultSchema.safeParse(result).success).toBe(false);
});
it("prevents expertise metadata from becoming a measured KPI or live research", () => {
  const evidence = readRetailExpertise({ topics: ["SUBSTITUTION"] }, now)
    .evidence[0]!;
  for (const patch of [
    { sourceType: "KPI" },
    { factKind: "OBSERVED" },
    { sourceVersion: null },
    { sourceId: "other" },
    { id: "other" },
  ])
    expect(
      copilotEvidenceSchema.safeParse({ ...evidence, ...patch }).success,
    ).toBe(false);
  const result = readRetailExpertise(
    { topics: ["SUBSTITUTION"] },
    "2027-04-18T00:00:00.000Z",
  );
  expect(result).toMatchObject({
    status: "REVALIDATION_REQUIRED",
    cards: [],
    evidence: [],
  });
  expect(() =>
    renderAnswerText("Cette TG apportera 15 %.", [], [evidence]),
  ).toThrow();
});
