import { z } from "zod";
import {
  copilotEvidenceSchema,
  retailExpertiseCardSchema,
  retailExpertiseInputSchema,
  readRetailExpertiseReference,
  RETAIL_EXPERTISE_EDITION,
} from "@fl-copilot/domain";
export const retailExpertiseToolResultSchema = z
  .strictObject({
    input: retailExpertiseInputSchema,
    edition: z.literal(RETAIL_EXPERTISE_EDITION),
    evaluatedAt: z.iso.datetime(),
    status: z.enum(["CURRENT", "NOT_YET_REVIEWED", "REVALIDATION_REQUIRED"]),
    cards: z.array(retailExpertiseCardSchema).max(2),
    evidence: z.array(copilotEvidenceSchema).max(2),
  })
  .superRefine((result, context) => {
    const expected = readRetailExpertiseReference(
      result.input,
      result.evaluatedAt,
    );
    if (
      result.status !== expected.status ||
      JSON.stringify(result.cards) !== JSON.stringify(expected.cards) ||
      result.evidence.length !== result.cards.length
    )
      context.addIssue({
        code: "custom",
        message: "Invalid curated reference snapshot",
      });
    for (const [index, card] of result.cards.entries()) {
      const evidence = result.evidence[index];
      if (
        !evidence ||
        evidence.id !==
          `retail-expertise/${card.citation.referenceId}/v${card.citation.version}` ||
        evidence.sourceId !== card.citation.referenceId ||
        evidence.sourceVersion !== card.citation.version ||
        JSON.stringify(evidence.retailExpertise) !==
          JSON.stringify(card.citation) ||
        evidence.label !== `Repère métier — ${card.title}` ||
        evidence.value !== card.sourceFinding ||
        evidence.detail !== referenceDetail(card)
      )
        context.addIssue({
          code: "custom",
          message: "Invalid curated reference evidence",
        });
    }
  });
function referenceDetail(card: z.infer<typeof retailExpertiseCardSchema>) {
  return [
    card.title,
    `Enseignement de la source : ${card.sourceFinding}`,
    `Piste de travail de l’application, à vérifier : ${card.applicationHypothesis}`,
    ...card.limits,
    `Vérification proposée : ${card.measurement}`,
  ].join("\n\n");
}
/** Pure local lookup. No remote fetch, paid call, store facts or mutation. */
export function readRetailExpertise(
  raw: unknown,
  asOf = new Date().toISOString(),
) {
  const reference = readRetailExpertiseReference(raw, asOf);
  return retailExpertiseToolResultSchema.parse({
    ...reference,
    evidence: reference.cards.map((card) => ({
      id: `retail-expertise/${card.citation.referenceId}/v${card.citation.version}`,
      sourceType: "SOURCE_DOCUMENT",
      sourceId: card.citation.referenceId,
      sourceVersion: card.citation.version,
      label: `Repère métier — ${card.title}`,
      value: card.sourceFinding,
      detail: referenceDetail(card),
      factKind: "SOURCE_INSTRUCTION",
      retailExpertise: card.citation,
    })),
  });
}
