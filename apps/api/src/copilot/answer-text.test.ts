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
