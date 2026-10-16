import { z } from "zod";
import {
  copilotEvidenceSchema,
  copilotExternalResearchSourceSchema,
  publicWebResearchResultSchema,
  type PublicWebResearchResult,
} from "@fl-copilot/domain";
export const publicResearchToolResultSchema = z
  .strictObject({
    research: publicWebResearchResultSchema,
    evidence: z.array(copilotEvidenceSchema).length(1),
  })
  .refine(({ research, evidence }) => {
    const e = evidence[0]!;
    return (
      e.id === `public-web-research/${research.requestId}` &&
      e.sourceId === research.requestId &&
      e.value === research.summaryFr &&
      e.externalResearch?.accessedAt === research.accessedAt &&
      e.externalResearch.citations.every((c) =>
        research.citations.some((r) => r.url === c.url && r.title === c.title),
      )
    );
  });
/** Short safe source payload; full exact report stays in evidence and the paid-call journal. */
export function publicResearchToolResult(raw: PublicWebResearchResult) {
  const research = publicWebResearchResultSchema.parse(raw);
  const citations = research.citations
    .filter((c) => c.url.length <= 600 && c.title.length <= 120)
    .filter((c, i, all) => all.findIndex((a) => a.url === c.url) === i)
    .slice(0, 3)
    .map(({ url, title, publishedAt }) => ({ url, title, publishedAt }));
  while (
    citations.length > 1 &&
    !copilotExternalResearchSourceSchema.safeParse({
      kind: "EXTERNAL_RESEARCH",
      accessedAt: research.accessedAt,
      citations,
    }).success
  )
    citations.pop();
  const externalResearch = copilotExternalResearchSourceSchema.parse({
    kind: "EXTERNAL_RESEARCH",
    accessedAt: research.accessedAt,
    citations,
  });
  return publicResearchToolResultSchema.parse({
    research,
    evidence: [
      {
        id: `public-web-research/${research.requestId}`,
        sourceType: "SOURCE_DOCUMENT",
        sourceId: research.requestId,
        sourceVersion: null,
        label: "Recherche web — informations externes",
        value: research.summaryFr,
        factKind: "SOURCE_INSTRUCTION",
        externalResearch,
      },
    ],
  });
}
