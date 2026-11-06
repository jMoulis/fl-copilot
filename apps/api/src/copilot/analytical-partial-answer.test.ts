import { expect, it } from "vitest";
import { recoverAnalyticalPartialAnswer } from "./analytical-partial-answer";
import { validateCopilotResponse } from "./response-service";
import {
  scoreCopilotPriorities,
  detectCopilotConflicts,
} from "@fl-copilot/analytics-core";
import { randomUUID } from "node:crypto";

const facts = [{ evidenceId: "sales" }];
function partial(narrative: string, selected = facts) {
  return JSON.stringify({
    language: "fr-FR",
    summary: "Une citation « narrative »",
    facts: selected,
    narrative,
  }).slice(0, -2);
}
it("keeps complete paragraphs and a full table, never the unfinished paragraph", () => {
  const first = "Le montant est {{value:0}}. {{source:0}}";
  const table =
    "| Indicateur | Montant |\n| --- | ---: |\n| CA | {{value:0}} |";
  const result = recoverAnalyticalPartialAnswer(
    partial(first + "\n\n" + table + "\n\nUne interprétation interrompue"),
  )!;
  expect(result.narrative).toContain(first + "\n\n" + table);
  expect(result.narrative).not.toContain("interrompue");
  expect(result.narrative).toContain("Cette réponse est partielle");
  expect(result.facts).toEqual(facts);
  expect(result.recommendations).toEqual([]);
});
it("decodes escapes and ignores fake field names inside quoted text", () => {
  const text = partial(
    'Le mot "narrative" et le montant {{value:0}}.\n\nSuite coupée \\',
  ).replace("Une citation « narrative »", 'Le mot \\"narrative\\"');
  const result = recoverAnalyticalPartialAnswer(text);
  expect(result?.narrative).toContain('Le mot "narrative"');
});
it.each([
  partial("Un seul paragraphe {{value:0}} coupé"),
  partial("Un texte sans fait.\n\nUne suite"),
  partial("```\n{{value:0}}\n\nUne suite"),
  '{"language":"fr-FR","facts":[{"evidenceId":"sal',
  '{"language":"fr-FR","facts":[{"evidenceId":"sal","narrative":"{{value:0}}\\n\\nfragment',
  partial("{{value:0}}\n\nSuite", []),
  " ".repeat(100_001),
])("declines unsafe/unhelpful recovery (%#)", (text) => {
  expect(recoverAnalyticalPartialAnswer(text)).toBeUndefined();
});
it("runs recovered prose through the same numerical and source grounding", () => {
  const storeId = randomUUID(),
    request = {
      requestId: randomUUID(),
      storeId,
      userQuestion: "Bilan",
      context: detectCopilotConflicts({
        batch: scoreCopilotPriorities({
          storeId,
          evaluatedAt: "2026-11-06T00:00:00Z",
          candidates: [],
        }),
        intents: [],
      }),
      evidence: [
        {
          id: "sales",
          sourceType: "KPI" as const,
          sourceId: "canonical",
          sourceVersion: null,
          label: "CA",
          value: "0",
          factKind: "OBSERVED" as const,
        },
      ],
    };
  const safe = recoverAnalyticalPartialAnswer(
    partial("Le montant est {{value:0}}. {{source:0}}\n\nSuite coupée"),
  )!;
  expect(() => validateCopilotResponse(safe, request)).not.toThrow();
  const unsafe = recoverAnalyticalPartialAnswer(
    partial("Le montant est 999 euros. {{value:0}}\n\nSuite coupée"),
  )!;
  expect(() => validateCopilotResponse(unsafe, request)).toThrow(
    "UNSUPPORTED_NUMBER",
  );
  const forged = recoverAnalyticalPartialAnswer(
    partial("{{value:0}}\n\nSuite coupée", [{ evidenceId: "invented" }]),
  )!;
  expect(() => validateCopilotResponse(forged, request)).toThrow(
    "UNKNOWN_EVIDENCE",
  );
});

it("retains a fully closed narrative even when later nonessential fields are cut", () => {
  const text =
    JSON.stringify({
      language: "fr-FR",
      facts,
      narrative: "Le montant est {{value:0}}. {{source:0}}",
    }).slice(0, -1) + ',"recommendations":[';
  expect(recoverAnalyticalPartialAnswer(text)?.narrative).toContain(
    "Le montant est {{value:0}}. {{source:0}}",
  );
  expect(recoverAnalyticalPartialAnswer(text)?.recommendations).toEqual([]);
});
