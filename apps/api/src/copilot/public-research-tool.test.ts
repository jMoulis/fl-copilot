import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  copilotPublicResearchInputSchema,
  copilotEvidenceSchema,
} from "@fl-copilot/domain";
import {
  publicResearchToolResult,
  publicResearchToolResultSchema,
} from "./public-research-tool";
import { renderAnswerText } from "./answer-text";
const raw = () => ({
  requestId: randomUUID(),
  query: "Saisonnalité des poires en France",
  purpose: "PRODUCE" as const,
  kind: "EXTERNAL_RESEARCH" as const,
  summaryFr: "Les périodes varient selon les variétés.",
  accessedAt: "2026-10-16T10:00:00.000Z",
  model: "test-model",
  inputTokens: 10,
  outputTokens: 20,
  citations: [
    {
      url: "https://www.interfel.com/",
      title: "Interfel",
      start: 0,
      end: 12,
      publishedAt: null,
    },
  ],
});
it("keeps exact public findings external and renders only verified, bounded source destinations", () => {
  const research = raw();
  const result = publicResearchToolResult(research);
  const evidence = result.evidence[0]!;
  expect(evidence.value).toBe(research.summaryFr);
  expect(evidence.factKind).toBe("SOURCE_INSTRUCTION");
  expect(
    copilotEvidenceSchema.safeParse({ ...evidence, sourceType: "KPI" }).success,
  ).toBe(false);
  const text = renderAnswerText(
    "{{value:0}} {{source:0}}",
    [{ evidenceId: evidence.id }],
    result.evidence,
  );
  const payload = JSON.parse(
    decodeURIComponent(/copilot-source:([^)]*)/.exec(text)![1]!),
  );
  expect(payload.externalResearch).toMatchObject({
    kind: "EXTERNAL_RESEARCH",
    accessedAt: research.accessedAt,
    citations: [{ url: research.citations[0]!.url }],
  });
  expect(payload.value).not.toBe(research.summaryFr);
  expect(text.length).toBeLessThan(16000);
  expect(
    publicResearchToolResultSchema.safeParse({
      ...result,
      research: { ...research, summaryFr: "Forged report" },
    }).success,
  ).toBe(false);
});
it("rejects model authority, private identifiers and metrics before research", () => {
  for (const query of [
    "Mon CA est 1200€",
    "notre marge 20%",
    `produit ${randomUUID()}`,
    "EAN 1234567890123",
    "secret api_key=private",
    "https://fl-copilot.vercel.app/api",
  ]) {
    expect(
      copilotPublicResearchInputSchema.safeParse({ query, purpose: "MARKET" })
        .success,
    ).toBe(false);
  }
  expect(
    copilotPublicResearchInputSchema.safeParse({
      query: "Calendrier des vacances scolaires 2026 en France",
      purpose: "CALENDAR",
    }).success,
  ).toBe(true);
  expect(
    copilotPublicResearchInputSchema.safeParse({
      query: "Saison des poires",
      purpose: "PRODUCE",
      storeId: randomUUID(),
    }).success,
  ).toBe(false);
});
it("deduplicates bounded safe citations and refuses a report without a displayable source", () => {
  const research = raw();
  research.citations.push(research.citations[0]!);
  expect(
    publicResearchToolResult(research).evidence[0]!.externalResearch?.citations,
  ).toHaveLength(1);
  expect(() =>
    publicResearchToolResult({
      ...research,
      citations: [
        {
          ...research.citations[0]!,
          url: "https://www.interfel.com/" + "a".repeat(601),
        },
      ],
    }),
  ).toThrow();
});
