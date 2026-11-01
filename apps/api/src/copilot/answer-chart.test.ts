import { z } from "zod";
import { expect, it } from "vitest";
import {
  copilotEvidenceSchema,
  copilotAnswerSourceSchema,
} from "@fl-copilot/domain";
import { renderAnswerContent, renderAnswerText } from "./answer-text";
const context = {
  schemaVersion: 1 as const,
  period: {
    kind: "range" as const,
    current: { start: "2026-10-01", end: "2026-10-02" },
    reference: null,
    aggregation: "SUM" as const,
    basis: "OBSERVED_PRODUCTS" as const,
  },
  metric: "sales" as const,
  filters: { category: null, nature: null, productId: null },
};
const evidence = copilotEvidenceSchema.parse({
  id: "chart",
  sourceId: "query-current",
  sourceType: "KPI",
  sourceVersion: null,
  label: "CA net",
  value: null,
  detail: "Période du calcul",
  analyticsContext: context,
  factKind: "DERIVED",
  chart: {
    version: 1,
    type: "LINE",
    title: "CA net",
    unit: "EUR",
    labels: ["2026-10-01", "2026-10-02"],
    series: [
      {
        label: "Période étudiée",
        period: context.period.current,
        points: [
          { value: "0", status: "AVAILABLE" },
          { value: null, status: "UNAVAILABLE" },
        ],
      },
    ],
  },
});
it("renders an immutable sourced graph through the existing message/citation protocol", () => {
  const content = renderAnswerContent(
    "Voici l’évolution.\n\n{{chart:0}}",
    [{ evidenceId: "chart" }],
    [evidence],
  );
  const source = copilotAnswerSourceSchema.parse(
    JSON.parse(
      decodeURIComponent(/copilot-source:([^)]*)/.exec(content.text)![1]!),
    ),
  );
  expect(content.text).toContain("[Graphique]");
  expect(source.chart).toEqual(evidence.chart);
  expect(source.analyticsIndex).toBe(0);
  expect(content.analyticsDestinations).toBeDefined();
  // Installed clients' original permissive source schema strips the new optional field.
  const legacySource = z
    .object({
      label: z.string(),
      value: z.unknown(),
      sourceId: z.string(),
      analyticsIndex: z.number().optional(),
    })
    .parse(source);
  expect(legacySource.sourceId).toBe(evidence.sourceId);
  expect(legacySource).not.toHaveProperty("chart");
});
it("refuses a model-authored chart URL, invented index, or chart token on a scalar", () => {
  for (const text of ["[Graphique](https://evil.invalid)", "{{chart:1}}"])
    expect(() =>
      renderAnswerText(text, [{ evidenceId: "chart" }], [evidence]),
    ).toThrow();
  expect(() =>
    renderAnswerText(
      "{{chart:0}}",
      [{ evidenceId: "plain" }],
      [{ ...evidence, id: "plain", chart: undefined }],
    ),
  ).toThrow("UNKNOWN_ANSWER_CHART");
});
it("automatically cites the numeric read actually used, even if an older coverage read was already cited", () => {
  const numeric = { ...evidence, id: "numeric", value: "12", chart: undefined };
  const old = {
    ...numeric,
    id: "old",
    sourceId: "query-full-month",
    analyticsContext: {
      ...context,
      period: {
        ...context.period,
        current: { start: "2026-10-01", end: "2026-10-31" },
      },
    },
  };
  const text = renderAnswerText(
    "Couverture {{source:0}}\n\nCA : {{value:1}}",
    [{ evidenceId: "old" }, { evidenceId: "numeric" }],
    [old, numeric],
  );
  expect(
    [...text.matchAll(/copilot-source:([^)]*)/g)].map(
      (m) => JSON.parse(decodeURIComponent(m[1]!)).sourceId,
    ),
  ).toEqual(["query-full-month", "query-current"]);
});

it("rejects mismatched periods and caps embedded charts while retaining normal source links", () => {
  const wrong = structuredClone(evidence);
  wrong.chart!.series[0]!.period.start = "2026-09-30";
  expect(copilotEvidenceSchema.safeParse(wrong).success).toBe(false);
  const content = renderAnswerText(
    "{{chart:0}}\n\n{{chart:0}}\n\n{{chart:0}}",
    [{ evidenceId: "chart" }],
    [evidence],
  );
  expect(content.match(/\[Graphique\]/g)).toHaveLength(2);
  expect(content.match(/\[Source\]/g)).toHaveLength(1);
});
