import { expect, it } from "vitest";
import { createAnalyticalModelOutput } from "./analytical-model-output";
import { factDigest } from "./fact-context";
import { renderAnswerText } from "./answer-text";
import { copilotEvidenceSchema } from "@fl-copilot/domain";

function fixture(count = 120) {
  const evidence = Array.from({ length: count }, (_, i) => ({
    id: JSON.stringify([
      "department-period",
      "unchanged-canonical-source-".repeat(8),
      i,
    ]),
    sourceId: "immutable-canonical-source-".repeat(8),
    sourceVersion: null,
    sourceType: "KPI" as const,
    factKind: "DERIVED" as const,
    label: `Produit ${Math.floor(i / 4)}`,
    value: i === 0 ? null : i === 1 ? "0" : "123.4500",
    detail:
      `Couverture exacte du groupe ${Math.floor(i / 4)}. ` +
      "Période partielle ; quantités et prix appariés, aucune conversion. ".repeat(
        8,
      ),
  }));
  return {
    query: {
      currentPeriod: { start: "2026-10-01", end: "2026-10-31" },
      referencePeriod: { start: "2025-10-02", end: "2025-11-01" },
      metrics: ["sales", "margin", "waste"],
    },
    rows: [
      {
        label: "Poire",
        quantity: null,
        unit: "KG",
        coverage: { partialDays: 7, missingDays: 2 },
      },
    ],
    hasMore: true,
    nextOffset: 10,
    unresolvedProductIds: ["missing"],
    evidence,
  };
}
function semantic(entries: object[]) {
  return entries.map((entry) =>
    Object.fromEntries(
      Object.entries(entry).filter(
        ([key]) => !["id", "sourceId", "sourceVersion"].includes(key),
      ),
    ),
  );
}
function unpack(wire: unknown) {
  const { rows, details } = (
    wire as { evidence: { rows: unknown[][]; details: string[] } }
  ).evidence;
  return rows.map(([, label, value, sourceType, factKind, detail, extra]) => ({
    label,
    value,
    sourceType,
    factKind,
    ...(detail === null ? {} : { detail: details[Number(detail)] }),
    ...((extra as object) ?? {}),
  }));
}
it("shares exact query coverages without losing nulls, zeroes, dates, warnings or evidence references", () => {
  const coverage = {
    expectedDays: 31,
    availableDays: 20,
    partialDays: 1,
    missingDays: 10,
    missingDateExamples: ["2026-10-01", "2026-10-03"],
  };
  const value = {
    ...fixture(2),
    rows: Array.from({ length: 20 }, (_, i) => ({
      key: `canonical-product-${i}`,
      label: `Produit ${i}`,
      productCount: 1,
      salesMeasures: { quantity: { value: "1.50", unit: "KG" } },
      metrics: ["sales", "margin", "waste"].map((metric) => ({
        metric,
        current: "0",
        reference: null,
        change: null,
        changePercent: null,
        currentCoverage: coverage,
        referenceCoverage: null,
        warnings: ["PARTIAL_REFERENCE"],
        evidenceIds: { current: fixture(2).evidence[0]!.id, reference: null },
      })),
    })),
  };
  const before = structuredClone(value),
    p = createAnalyticalModelOutput([]);
  const prepared = p.prepare("analytics-query", value, 1)!;
  prepared.accept();
  const wire = prepared.wire as unknown as {
    rows: Array<{ metrics: { columns: string[]; rows: unknown[][] } }>;
    coverages: unknown[];
  };
  expect(wire.coverages).toEqual([coverage]);
  const restoredRows = wire.rows.map((row) => ({
    ...row,
    metrics: row.metrics.rows.map((cells) =>
      Object.fromEntries(
        row.metrics.columns.map((column, index) => {
          const coverageColumn =
            column === "currentCoverageIndex" ||
            column === "referenceCoverageIndex";
          const cell = cells[index];
          return [
            coverageColumn ? column.replace(/Index$/, "") : column,
            coverageColumn && cell !== null
              ? wire.coverages[Number(cell)]
              : cell,
          ];
        }),
      ),
    ),
  }));
  expect(p.bind(restoredRows)).toEqual(value.rows);
  expect(unpack(prepared.wire)).toEqual(semantic(value.evidence));
  expect(value).toEqual(before);
  expect(Buffer.byteLength(JSON.stringify(prepared.wire))).toBeLessThan(
    Buffer.byteLength(JSON.stringify(value)) * 0.7,
  );
});
it("keeps heterogeneous metric objects and non-query shapes unchanged", () => {
  const value = {
    ...fixture(1),
    rows: [
      { metrics: [{ current: null }, { current: "0", optional: "present" }] },
    ],
  };
  const p = createAnalyticalModelOutput([]);
  expect(p.prepare("analytics-query", value, 1)!.wire).toMatchObject({
    rows: value.rows,
  });
  expect(p.prepare("period", value, 1)!.wire).toMatchObject({
    rows: value.rows,
  });
});
it.each(["analytics-query", "period", "mongo"])(
  "preserves every exact field while sharing repeated evidence metadata: %s",
  (family) => {
    const value = fixture(),
      copy = structuredClone(value),
      digest = factDigest(value);
    const projection = createAnalyticalModelOutput([]),
      p = projection.prepare(family, value, 2)!;
    expect(unpack(p.wire)).toEqual(semantic(value.evidence));
    expect(p.wire).toMatchObject({
      query: value.query,
      rows: value.rows,
      hasMore: true,
      nextOffset: 10,
      unresolvedProductIds: ["missing"],
      remainingReads: 2,
    });
    expect(JSON.stringify(p.wire)).not.toContain("unchanged-canonical-source-");
    expect(JSON.stringify(p.wire)).not.toContain("immutable-canonical-source-");
    expect(value).toEqual(copy);
    expect(factDigest(value)).toBe(digest);
    const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v));
    expect(bytes(p.wire)).toBeLessThan(bytes(value) * 0.6);
    expect(projection.toModelOutput({ output: value }).value).toBe(value);
    p.accept();
    expect(projection.toModelOutput({ output: value }).value).toBe(p.wire);
  },
);
it("restores canonical references before rendering, without changing prose, candidate IDs or unknown references", () => {
  const raw = fixture(2),
    p = createAnalyticalModelOutput(["r0"]);
  const prepared = p.prepare("period", raw, 1)!;
  prepared.accept();
  const result = p.bind({
    facts: [{ evidenceId: "r1" }, { evidenceId: "r2" }],
    narrative: "Montant {{value:1}} €. {{source:1}}",
    candidateId: "r1",
    questions: ["r1"],
    nested: { evidenceIds: ["r2", "unknown"] },
  }) as { facts: Array<{ evidenceId: string }>; narrative: string };
  expect(result).toMatchObject({
    facts: [
      { evidenceId: raw.evidence[0]!.id },
      { evidenceId: raw.evidence[1]!.id },
    ],
    candidateId: "r1",
    questions: ["r1"],
    nested: { evidenceIds: [raw.evidence[1]!.id, "unknown"] },
  });
  const evidence = raw.evidence.map((e) => copilotEvidenceSchema.parse(e));
  expect(renderAnswerText(result.narrative, result.facts, evidence)).toContain(
    "0 €",
  );
  expect(renderAnswerText(result.narrative, result.facts, evidence)).toContain(
    "copilot-source:",
  );
  expect(p.bind({ facts: [{ evidenceId: "r999" }] })).toEqual({
    facts: [{ evidenceId: "r999" }],
  });
  expect(
    createAnalyticalModelOutput([]).bind({ facts: [{ evidenceId: "r1" }] }),
  ).toEqual({ facts: [{ evidenceId: "r1" }] });
});
it("does not expose or bind a rejected budget preview, and reuses references across repeated reads", () => {
  const p = createAnalyticalModelOutput([]),
    value = fixture(1);
  p.prepare("period", value, 2);
  expect(p.bind({ evidenceId: "r0" })).toEqual({ evidenceId: "r0" });
  const first = p.prepare("period", value, 2)!;
  first.accept();
  const second = p.prepare("period", structuredClone(value), 1)!;
  second.accept();
  expect(second.wire).toMatchObject({
    evidence: {
      rows: [
        [
          "r0",
          ...(
            first.wire as { evidence: { rows: unknown[][] } }
          ).evidence.rows[0]!.slice(1),
        ],
      ],
    },
  });
  expect(p.bind({ evidenceId: "r0" })).toEqual({
    evidenceId: value.evidence[0]!.id,
  });
});
it("refuses a canonical/ref collision before any new output can be accepted", () => {
  const p = createAnalyticalModelOutput([]),
    value = fixture(1);
  p.prepare("period", value, 2)!.accept();
  expect(() =>
    p.prepare("mongo", { evidence: [{ ...value.evidence[0], id: "r0" }] }, 1),
  ).toThrow("COLLISION");
  expect(() =>
    p.prepare(
      "product-preview",
      { evidence: [{ ...value.evidence[0], id: "r0" }] },
      1,
    ),
  ).toThrow("COLLISION");
});
it("keeps absent details distinct from empty strings, and preserves chart/extra fields", () => {
  const value = fixture(2);
  delete (value.evidence[0] as { detail?: string }).detail;
  value.evidence[1]!.detail = "";
  Object.assign(value.evidence[1]!, {
    chart: { series: [{ name: "CA", points: [{ value: "0" }] }] },
  });
  expect(
    unpack(
      createAnalyticalModelOutput([]).prepare("analytics-query", value, 0)!
        .wire,
    ),
  ).toEqual(semantic(value.evidence));
});
it("leaves nonanalytical workflows in their existing model shape", () => {
  const value = fixture(1),
    p = createAnalyticalModelOutput([]),
    result = p.prepare("store-settings", value, 2)!;
  expect(result.wire).toBe(value);
  result.accept();
  expect(p.toModelOutput({ output: value }).value).toBe(value);
});

it("rewrites nested evidence references without altering product and document identifiers", () => {
  const value = fixture(1),
    id = value.evidence[0]!.id;
  Object.assign(value, {
    chartEvidenceId: id,
    rows: [
      {
        productId: "canonical-product",
        sourceDocumentId: "canonical-document",
        evidenceIds: { current: id, reference: null },
        nested: { evidenceId: id },
      },
    ],
  });
  const p = createAnalyticalModelOutput([]),
    prepared = p.prepare("analytics-query", value, 1)!;
  prepared.accept();
  expect(prepared.wire).toMatchObject({
    chartEvidenceId: "r0",
    rows: [
      {
        productId: "canonical-product",
        sourceDocumentId: "canonical-document",
        evidenceIds: { current: "r0", reference: null },
        nested: { evidenceId: "r0" },
      },
    ],
  });
  expect(p.factCount).toBe(1);
  expect(p.bind({ facts: [{ evidenceId: "r0" }] })).toEqual({
    facts: [{ evidenceId: id }],
  });
});
