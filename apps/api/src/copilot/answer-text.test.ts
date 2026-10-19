import { expect, it } from "vitest";
import { renderAnswerText } from "./answer-text";
const e = [
  {
    id: "sales",
    sourceId: "verified-period",
    sourceType: "KPI" as const,
    sourceVersion: null,
    label: "CA publié (€)",
    value: "12345.67",
    factKind: "OBSERVED" as const,
  },
];
const facts = [{ evidenceId: "sales" }];
it("places exact canonical values in natural prose/tables and builds source destinations on the server", () => {
  const text = renderAnswerText(
    "Voici le bilan.\n\n| Indicateur | Montant |\n| --- | --- |\n| CA | {{value:0}} € |\n\n{{source:0}}",
    facts,
    e,
  );
  expect(text).toContain("12\u202f345,67 €");
  expect(text).not.toContain("Faits disponibles");
  const url = /copilot-source:([^)]*)/.exec(text)![1]!;
  expect(JSON.parse(decodeURIComponent(url))).toMatchObject({
    label: "CA publié (€)",
    value: "12345.67",
    sourceId: "verified-period",
  });
});
it("rejects invented figures, unknown references and model-authored destinations", () => {
  for (const text of [
    "CA : 999 €",
    "{{value:1}}",
    "[Source](https://evil.invalid)",
    "{{unexpected}}",
  ])
    expect(() => renderAnswerText(text, facts, e)).toThrow();
});
it("does not expose unfinished evidence placeholders while streaming", () => {
  expect(renderAnswerText("Le CA est {{value:", facts, e, true)).toBe(
    "Le CA est ",
  );
  expect(
    renderAnswerText("Le CA est {{value:0}} €.", facts, e, true),
  ).toContain("12\u202f345,67 €.");
});
it("escapes document labels and values without turning source text into Markdown", () => {
  const text = renderAnswerText("{{value:0}}", facts, [
    { ...e[0]!, value: "a|[click](bad) <img>" },
  ]);
  expect(text).toContain("a\\|\\[click\\]");
});
it("withholds ambiguous evidence versions even before the final response", () => {
  expect(() =>
    renderAnswerText(
      "{{value:0}}",
      facts,
      [...e, { ...e[0]!, value: "99" }],
      true,
    ),
  ).toThrow("AMBIGUOUS_ANSWER_EVIDENCE");
});
it("keeps a concise qualification in the answer and the calendar inventory behind its source link", () => {
  const detail =
    "0 jours complets, 7 partiels ; journées absentes : 2026-10-01, 2026-10-08";
  const text = renderAnswerText("{{value:0}} {{source:0}}", facts, [
    { ...e[0]!, value: "Ce cumul est partiel.", detail },
  ]);
  expect(text.startsWith("Ce cumul est partiel.")).toBe(true);
  expect(
    JSON.parse(decodeURIComponent(/copilot-source:([^)]*)/.exec(text)![1]!))
      .value,
  ).toBe(detail);
});
it("renders a comparative table with more than twenty-four verified values while still rejecting invented figures", async () => {
  const { copilotResponseSchema } = await import("@fl-copilot/domain");
  const evidence = Array.from({ length: 30 }, (_, i) => ({
    ...e[0]!,
    id: `table/${i}`,
    label: "Montant renseigné",
    value: `${i}.00`,
  }));
  const facts = evidence.map((v) => ({ evidenceId: v.id }));
  const narrative =
    "| Montant |\n| --- |\n" +
    facts.map((_, i) => `| {{value:${i}}} € |`).join("\n");
  const response = copilotResponseSchema.parse({
    language: "fr-FR",
    summary: "Voici les montants renseignés.",
    facts,
    narrative,
    interpretation: [],
    recommendations: [],
    questions: [],
  });
  expect(
    renderAnswerText(response.narrative!, response.facts, evidence),
  ).toContain("29,00 €");
  expect(() =>
    renderAnswerText(narrative + "Total : 999 €", facts, evidence),
  ).toThrow("INVALID_ANSWER_TEMPLATE");
});

it("keeps every destination of a long comparative answer without increasing readable-message allowance", async () => {
  const { renderAnswerContent } = await import("./answer-text");
  const { largeAnalyticalContext } =
    await import("../../../../scripts/test-analytics-destination-fixtures");
  const { readAnswerSource } =
    await import("../../../mobile/src/copilot/answer-source");
  const context = largeAnalyticalContext();
  const evidence = ["sales", "margin", "waste", "wasteCost"].map(
    (metric, i) => ({
      ...e[0]!,
      id: `long/${i}`,
      analyticsContext: {
        ...context,
        metric: metric as "sales" | "margin" | "waste" | "wasteCost",
      },
    }),
  );
  const facts = evidence.map((v) => ({ evidenceId: v.id }));
  const narrative = facts
    .map((_, i) => `{{value:${i}}} € {{source:${i}}}`)
    .join("\n");
  const legacy = renderAnswerText(narrative, facts, evidence);
  expect(legacy).not.toContain("analyticsContext"); // reproduces the former over-16k fallback
  const rich = renderAnswerContent(narrative, facts, evidence);
  expect(rich.text.length).toBeLessThan(16000);
  expect(rich.analyticsDestinations!.productSets).toHaveLength(1);
  const links = [...rich.text.matchAll(/copilot-source:([^)]*)/g)];
  expect(links).toHaveLength(4);
  for (let i = 0; i < links.length; i++)
    expect(
      readAnswerSource(links[i]![1]!, rich.analyticsDestinations)
        .analyticsContext,
    ).toEqual(evidence[i]!.analyticsContext);
  expect(() => renderAnswerContent("x".repeat(16001), [], [])).toThrow(
    "ANSWER_TEXT_TOO_LARGE",
  );
});
