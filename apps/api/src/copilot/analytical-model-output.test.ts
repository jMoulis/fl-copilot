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
  const { rows, details, detailParts } = (
    wire as {
      evidence: {
        rows: unknown[][];
        details: Array<string | number[]>;
        detailParts?: string[];
      };
    }
  ).evidence;
  return rows.map(([, label, value, sourceType, factKind, detail, extra]) => ({
    label,
    value,
    sourceType,
    factKind,
    ...(detail === null
      ? {}
      : {
          detail: Array.isArray(details[Number(detail)])
            ? (details[Number(detail)] as number[])
                .map((part) => detailParts![part])
                .join("")
            : details[Number(detail)],
        }),
    ...((extra as object) ?? {}),
  }));
}
it("builds canonical facts from direct references, deduplicates them and contains an unknown paragraph", () => {
  const p = createAnalyticalModelOutput([]),
    value = fixture(2);
  p.prepare("period", value, 0)!.accept();
  const result = p.bindAnswer({
    narrative:
      "CA {{value:r0}}. {{source:r0}}\n\nValeur {{value:invented}}.\n\n| Produit | Valeur |\n| --- | --- |\n| {{label:r1}} | {{value:r1}} |",
    productId: "canonical-product",
  });
  expect(result.omittedBlocks).toBe(1);
  expect(result.output).toMatchObject({
    productId: "canonical-product",
    facts: value.evidence.map((e) => ({ evidenceId: e.id })),
    narrative: expect.stringContaining("CA {{value:0}}. {{source:0}}"),
  });
  expect(String(result.output.narrative)).toContain(
    "| {{label:1}} | {{value:1}} |",
  );
  expect(String(result.output.narrative)).toContain(
    "Un passage n’a pas pu être vérifié",
  );
  expect(String(result.output.narrative)).not.toContain("invented");
});
it("exposes short initial evidence references without rewriting product IDs or counting them as analytical reads", () => {
  const id = JSON.stringify([
    "period",
    { start: "2026-10-01", end: "2026-10-31" },
  ]);
  const p = createAnalyticalModelOutput([id]);
  const initial = {
    EVIDENCE: [{ id, value: "0" }],
    CONTEXT: { productId: id, candidateId: id },
  };
  expect(p.projectInitial(initial)).toEqual({
    EVIDENCE: [{ id: "i0", value: "0" }],
    CONTEXT: initial.CONTEXT,
  });
  expect(initial.EVIDENCE[0]!.id).toBe(id);
  expect(p.factCount).toBe(0);
  expect(p.bindAnswer({ narrative: "{{value:i0}}" }).output).toMatchObject({
    narrative: "{{value:0}}",
    facts: [{ evidenceId: id }],
  });
});
it("never resolves a rejected read or leaks a reference from another generation", () => {
  const p = createAnalyticalModelOutput([]);
  p.prepare("period", fixture(1), 0);
  expect(p.bindAnswer({ narrative: "{{value:r0}}" }, true)).toMatchObject({
    omittedBlocks: 1,
    output: { facts: [], narrative: "" },
  });
  expect(
    createAnalyticalModelOutput([]).bindAnswer({ narrative: "{{value:i0}}" })
      .omittedBlocks,
  ).toBe(1);
});
it("retains verified facts beyond the obsolete model-list ceiling", () => {
  const p = createAnalyticalModelOutput([]),
    value = fixture(97);
  value.evidence[96]!.label = "Casse enregistrée";
  p.prepare("period", value, 0)!.accept();
  const first = Array.from({ length: 96 }, (_, i) => `{{value:r${i}}}`).join(
    " ",
  );
  const result = p.bindAnswer({
    narrative:
      first +
      "\n\n| Repère | Valeur |\n| --- | --- |\n| Casse | {{value:r96}} |",
  });
  expect(result.output.facts as unknown[]).toHaveLength(97);
  expect(result.omittedBlocks).toBe(0);
  expect(result.output.narrative).toContain("Casse");
});
it("normalizes marker whitespace without guessing or accepting an unknown reference", () => {
  const p = createAnalyticalModelOutput([]);
  p.prepare("period", fixture(1), 0)!.accept();
  const result = p.bindAnswer({
    narrative: "{{value: r0 }}\n\n{{value: r0.unknown }}",
  });
  expect(result.output.facts).toHaveLength(1);
  expect(result.output.narrative).toContain("{{value:0}}");
  expect(result.omittedBlocks).toBe(1);
});
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
    rows: Array<{ metrics: unknown[][] }>;
    metricColumns: string[];
    coverages: unknown[];
  };
  expect(wire.coverages).toEqual([coverage]);
  const restoredRows = wire.rows.map((row) => ({
    ...row,
    metrics: row.metrics.map((cells) =>
      Object.fromEntries(
        wire.metricColumns.map((column, index) => {
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
  const future = {
    ...fixture(1),
    rows: [
      {
        metrics: {
          columns: ["future"],
          rows: [["0"]],
          note: "Keep this field",
        },
      },
    ],
  };
  expect(p.prepare("analytics-query", future, 1)!.wire).toMatchObject({
    rows: future.rows,
  });
});
it("shares repeated prose losslessly, including decimals, labels, custom caveats and whitespace", () => {
  const value = fixture(12);
  for (const [i, entry] of value.evidence.entries())
    entry.detail =
      `Produit ${i}. Prix 1.095592140201805629314922995220393. ` +
      "Prix pondéré sur journées appariées. Null ne signifie pas zéro. " +
      "Quantité de gestion, pas un dénombrement physique. " +
      `Réserve spécifique ${i} : origine non vérifiée.  \nFin.`;
  const wire = createAnalyticalModelOutput([]).prepare(
    "analytics-query",
    value,
    1,
  )!.wire;
  expect(wire).toHaveProperty("evidence.detailParts");
  expect(unpack(wire)).toEqual(semantic(value.evidence));
  expect(JSON.stringify(wire).match(/Null ne signifie pas zéro/g)).toHaveLength(
    1,
  );
});
it("does not add a shared-text dictionary when it would enlarge the result", () => {
  const value = fixture(1);
  value.evidence[0]!.detail = "Court.";
  const wire = createAnalyticalModelOutput([]).prepare(
    "period",
    value,
    0,
  )!.wire;
  expect(wire).not.toHaveProperty("evidence.detailParts");
  expect(unpack(wire)).toEqual(semantic(value.evidence));
});
it.each([
  "analytics-query",
  "period",
  "mongo",
  "commercial-plan",
  "commercial-preparation",
  "store-settings",
  "retail-expertise",
  "recommendation-context",
])(
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
it("keeps small read results verbatim when tabulation would enlarge them", () => {
  const value = { status: "UNAVAILABLE", evidence: [] },
    p = createAnalyticalModelOutput([]),
    result = p.prepare("store-settings", value, 2)!;
  expect(result.wire).toBe(value);
  result.accept();
  expect(p.toModelOutput({ output: value }).value).toBe(value);
  expect(p.factCount).toBe(0);
});
it("shares reference allocation across read families without triggering analytical budgets", () => {
  const p = createAnalyticalModelOutput([]),
    plan = fixture(2),
    original = structuredClone(plan);
  const projected = p.prepare("commercial-plan", plan, 2)!;
  projected.accept();
  expect(p.factCount).toBe(0);
  expect(p.toModelOutput({ output: plan }).value).toBe(projected.wire);
  expect(p.bind({ evidenceId: "r0", productId: "r0" })).toEqual({
    evidenceId: plan.evidence[0]!.id,
    productId: "r0",
  });
  const analytical = fixture(1);
  analytical.evidence[0]!.id = "different-analytical-fact";
  p.prepare("period", analytical, 1)!.accept();
  expect(p.factCount).toBe(1);
  expect(p.bind({ evidenceIds: ["r0", "r2"] })).toEqual({
    evidenceIds: [plan.evidence[0]!.id, analytical.evidence[0]!.id],
  });
  expect(plan).toEqual(original);
  expect(p.bindAnswer({ narrative: "{{source:r0}}" }).omittedBlocks).toBe(0);
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

it("binds exact numeric source names and catalogue labels without admitting literal figures or guessing ambiguous names", () => {
  const transport = createAnalyticalModelOutput([]);
  const source = {
    id: "owned-document",
    label: "PDF original",
    value: "offres45.pdf",
    sourceType: "SOURCE_DOCUMENT",
    factKind: "QUALITY",
  };
  transport.prepare("documents", { evidence: [source] }, 4)!.accept();
  const bound = transport.bindAnswer({
    narrative: "Le fichier offres45.pdf est disponible.",
    recommendations: [],
  });
  expect(bound.omittedBlocks).toBe(0);
  expect(
    renderAnswerText(
      String(bound.output.narrative),
      bound.output.facts as Parameters<typeof renderAnswerText>[1],
      [
        copilotEvidenceSchema.parse({
          ...source,
          sourceId: "owned",
          sourceVersion: null,
        }),
      ],
    ),
  ).toContain("offres45.pdf est disponible");
  const forged = transport.bindAnswer({
    narrative: "Le fichier offres46.pdf affiche un CA de 999 €.",
    recommendations: [],
  });
  expect(() =>
    renderAnswerText(
      String(forged.output.narrative),
      forged.output.facts as Parameters<typeof renderAnswerText>[1],
      [],
    ),
  ).toThrow("INVALID_ANSWER_TEMPLATE");
  const rejected = transport.prepare(
    "documents",
    { evidence: [{ ...source, id: "not-accepted", value: "rejet46.pdf" }] },
    0,
  )!;
  void rejected;
  const unaccepted = transport.bindAnswer({
    narrative: "rejet46.pdf",
    recommendations: [],
  });
  expect(() =>
    renderAnswerText(
      String(unaccepted.output.narrative),
      unaccepted.output.facts as Parameters<typeof renderAnswerText>[1],
      [],
    ),
  ).toThrow("INVALID_ANSWER_TEMPLATE");
  transport
    .prepare(
      "documents",
      { evidence: [{ ...source, id: "another-document" }] },
      2,
    )!
    .accept();
  const ambiguous = transport.bindAnswer({
    narrative: "offres45.pdf",
    recommendations: [],
  });
  expect(ambiguous.output.facts).toHaveLength(0);
});

it("uses a turn reference for an echoed numeric label whose canonical ID contains JSON braces", () => {
  const transport = createAnalyticalModelOutput([]),
    value = fixture(1);
  transport.prepare("period", value, 0)!.accept();
  const bound = transport.bindAnswer({
    narrative: "Repère : Produit 0.",
    recommendations: [],
  });
  expect(bound.omittedBlocks).toBe(0);
  expect(
    renderAnswerText(
      String(bound.output.narrative),
      bound.output.facts as Parameters<typeof renderAnswerText>[1],
      value.evidence,
    ),
  ).toBe("Repère : Produit 0.");
});

it("treats Markdown list ordinals as formatting while still rejecting unsupported figures", () => {
  const transport = createAnalyticalModelOutput([]);
  const output = transport.bindAnswer({
    narrative: "1. Une TG à thème.\n2) Des blocs distincts.\n  3. Du réassort.",
    recommendations: [],
  }).output;
  expect(
    renderAnswerText(
      String(output.narrative),
      output.facts as Parameters<typeof renderAnswerText>[1],
      [],
    ),
  ).toBe("- Une TG à thème.\n- Des blocs distincts.\n  - Du réassort.");
  for (const narrative of [
    "1. CA de 9999 €.",
    "Prix : 1.99 €.",
    "Le 2 novembre 2026.",
    "1. {{value:forged}}",
  ]) {
    const bound = transport.bindAnswer({ narrative, recommendations: [] });
    if (narrative.includes("forged")) expect(bound.omittedBlocks).toBe(1);
    else
      expect(() =>
        renderAnswerText(
          String(bound.output.narrative),
          bound.output.facts as Parameters<typeof renderAnswerText>[1],
          [],
        ),
      ).toThrow("INVALID_ANSWER_TEMPLATE");
  }
});
