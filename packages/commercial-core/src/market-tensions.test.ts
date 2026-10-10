import { it, expect } from "vitest";
import { makeCommercialPlanFixture } from "../../../scripts/commercial-plan-fixture-data";
import { commercialPlanTensions } from "./market-tensions";
import { commercialOfferValidationSource } from "./offer-validation";
import { buildCommercialWeekPlan } from "./week-plan";
let sequence = 0;
const uuid = () =>
  `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
const digest = async (s: string) => {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h.toString(16).padStart(8, "0").repeat(8);
};
const evidence = [
  {
    pageNumber: 1,
    quote: "Tension d’approvisionnement · ITM8 00000870 · semaine 41 de 2026",
    region: null,
    verification: "TEXT_SUPPORTED" as const,
  },
];
const field = (
  name:
    | "marketSignal"
    | "productIdentifier"
    | "weekLabel"
    | "documentYear"
    | "saleStart"
    | "saleEnd",
  rawValue: string,
  confidence = 1,
) => ({
  name,
  rawValue,
  confidence,
  evidence,
  validationStatus: "TO_VALIDATE" as const,
});
async function fixture(
  change?: (
    r: Awaited<ReturnType<typeof makeCommercialPlanFixture>>["reading"],
  ) => void,
) {
  const f = await makeCommercialPlanFixture(digest, uuid);
  change?.(f.reading);
  const validated = {
    ...f.validated,
    ...commercialOfferValidationSource(f.choice, [f.reading]),
  };
  const plan = await buildCommercialWeekPlan(
    {
      preparation: f.preparation,
      version: 1,
      createdAt: f.plan.createdAt,
      validatedAt: f.plan.validatedAt,
    },
    { ...f.context, pages: [f.reading], validated: [validated] },
    digest,
  );
  return {
    ...f,
    validated,
    plan,
    input: {
      plan,
      validated: [validated],
      pages: [f.reading],
      identifiers: [],
    },
  };
}
it("projects a cited item tension through the exact validated offer without creating an actual event or modifying inputs", async () => {
  const f = await fixture((r) =>
      r.reading!.operations[0]!.items[0]!.fields.push(
        field("marketSignal", "Tension d’approvisionnement"),
      ),
    ),
    before = JSON.stringify(f.input);
  const result = commercialPlanTensions(f.input);
  expect(result.tensions[0]).toMatchObject({
    source: "COMMERCIAL_DOCUMENT",
    status: "ANNOUNCED",
    productId: f.product.id,
    association: "VALIDATED_OFFER",
    readingId: f.reading.id,
    pageNumber: 1,
    planningWindow: { start: f.choice.saleStart, end: f.choice.saleEnd },
  });
  expect(JSON.stringify(f.input)).toBe(before);
  expect(f.plan.operations[0]!.actualStart).toBeNull();
});
it("does not turn negation, abundance or low-confidence/uncited extraction into actionable tension", async () => {
  for (const raw of [
    "Pas de tension",
    "Marché abondant",
    "Fin de la tension",
  ]) {
    const f = await fixture((r) =>
      r.reading!.operations[0]!.items[0]!.fields.push(
        field("marketSignal", raw),
      ),
    );
    expect(commercialPlanTensions(f.input).tensions).toEqual([]);
  }
  const f = await fixture((r) =>
    r.reading!.operations[0]!.items[0]!.fields.push(
      field("marketSignal", "Tension", 0.4),
    ),
  );
  expect(commercialPlanTensions(f.input).tensions[0]).toMatchObject({
    status: "REVIEW",
    reason: "EVIDENCE",
  });
  const other = await fixture((r) =>
    r.reading!.operations[0]!.items[0]!.fields.push({
      ...field("marketSignal", "Tension"),
      evidence: [],
    }),
  );
  expect(commercialPlanTensions(other.input).tensions[0]!.status).toBe(
    "REVIEW",
  );
});
it("does not reuse another week or infer which product a multi-product operation warning concerns", async () => {
  const outside = await fixture((r) =>
    r.reading!.operations[0]!.items[0]!.fields.push(
      field("marketSignal", "Tension"),
      field("saleStart", "2026-10-15"),
      field("saleEnd", "2026-10-17"),
    ),
  );
  expect(commercialPlanTensions(outside.input).tensions).toEqual([]);
  const f = await fixture((r) => {
    const op = r.reading!.operations[0]!;
    op.fields.push(field("marketSignal", "Tension"));
    op.items.push({ ...op.items[0]!, label: "Autre produit" });
  });
  expect(commercialPlanTensions(f.input).tensions[0]).toMatchObject({
    status: "REVIEW",
    reason: "IDENTITY",
    productId: null,
  });
});
it("resolves standalone current-week information only by an exact quoted validated identifier, preserving leading zeroes", async () => {
  const f = await fixture((r) =>
    r.reading!.otherInformation.push({
      kind: "INSTRUCTION",
      validationStatus: "TO_VALIDATE",
      label: "Marché",
      fields: [
        field("marketSignal", "Tension"),
        field("productIdentifier", "ITM8 00000870"),
        field("weekLabel", "S41"),
        field("documentYear", "2026"),
      ],
      evidence,
    }),
  );
  const id = {
    storeId: f.storeId,
    productId: f.product.id,
    type: "ITM8",
    value: "00000870",
    status: "VALIDATED",
    syncState: "SYNCED",
  };
  expect(
    commercialPlanTensions({ ...f.input, identifiers: [id] }).tensions[0],
  ).toMatchObject({
    status: "ANNOUNCED",
    association: "EXACT_IDENTIFIER",
    productId: f.product.id,
    planningWindow: null,
  });
  for (const identifier of [
    { ...id, value: "870" },
    { ...id, storeId: uuid() },
    { ...id, status: "TO_REVIEW" },
    { ...id, syncState: "PENDING" },
  ])
    expect(
      commercialPlanTensions({ ...f.input, identifiers: [identifier] })
        .tensions[0]!.reason,
    ).toBe("IDENTITY");
  expect(
    commercialPlanTensions({
      ...f.input,
      identifiers: [id, { ...id, productId: uuid() }],
    }).tensions[0]!.productId,
  ).toBeNull();
});
it("keeps uncertain periods and contradictory signal fields for review instead of fabricating a targeted incident", async () => {
  const f = await fixture((r) =>
    r.reading!.otherInformation.push({
      kind: "INSTRUCTION",
      validationStatus: "TO_VALIDATE",
      label: "Marché",
      fields: [field("marketSignal", "Tension")],
      evidence,
    }),
  );
  expect(commercialPlanTensions(f.input).tensions[0]).toMatchObject({
    status: "REVIEW",
    reason: "PERIOD",
  });
  const conflicting = await fixture((r) =>
    r.reading!.operations[0]!.items[0]!.fields.push(
      field("marketSignal", "Tension"),
      field("marketSignal", "Pas de tension"),
    ),
  );
  expect(commercialPlanTensions(conflicting.input).tensions[0]!.reason).toBe(
    "CONFLICTING_SIGNAL",
  );
});
it("rejects missing, changed, foreign or checksum-mismatched frozen validation/source before projection", async () => {
  const f = await fixture((r) =>
    r.reading!.operations[0]!.items[0]!.fields.push(
      field("marketSignal", "Tension"),
    ),
  );
  for (const input of [
    { ...f.input, validated: [] },
    { ...f.input, pages: [] },
    { ...f.input, pages: [{ ...f.reading, checksum: "changed" }] },
    {
      ...f.input,
      validated: [
        {
          ...f.validated,
          storeId: uuid(),
          choice: { ...f.choice, storeId: uuid() },
        },
      ],
    },
  ])
    expect(commercialPlanTensions(input).status).toBe("SOURCE_UNAVAILABLE");
  const v = {
    ...f.validated,
    sourceFields: f.validated.sourceFields.filter(
      (f) => f.name !== "marketSignal",
    ),
  };
  expect(commercialPlanTensions({ ...f.input, validated: [v] }).status).toBe(
    "SOURCE_UNAVAILABLE",
  );
});
it("deduplicates the same cited operation/item signal and keeps source keys stable under page-order permutation", async () => {
  const f = await fixture((r) => {
    r.reading!.operations[0]!.fields.push(field("marketSignal", "Tension"));
    r.reading!.operations[0]!.items[0]!.fields.push(
      field("marketSignal", "Tension"),
    );
  });
  const first = commercialPlanTensions(f.input);
  expect(first.tensions).toHaveLength(1);
  expect(
    commercialPlanTensions({ ...f.input, pages: [...f.input.pages].reverse() }),
  ).toEqual(first);
});

it("does not infer identity from visual-only or conflicting unmatched identifiers", async () => {
  const f = await fixture((r) =>
    r.reading!.otherInformation.push({
      kind: "INSTRUCTION",
      validationStatus: "TO_VALIDATE",
      label: "Marché",
      fields: [
        field("marketSignal", "Tension"),
        {
          ...field("productIdentifier", "ITM8 00000870"),
          evidence: evidence.map((e) => ({
            ...e,
            verification: "VISUAL_TO_VERIFY" as const,
          })),
        },
        field("weekLabel", "S41"),
        field("documentYear", "2026"),
      ],
      evidence,
    }),
  );
  const identifier = {
    storeId: f.storeId,
    productId: f.product.id,
    type: "ITM8",
    value: "00000870",
    status: "VALIDATED",
    syncState: "SYNCED",
  };
  expect(
    commercialPlanTensions({ ...f.input, identifiers: [identifier] })
      .tensions[0]!.reason,
  ).toBe("IDENTITY");
  f.reading.reading!.otherInformation[0]!.fields[1] = field(
    "productIdentifier",
    "ITM8 00000870",
  );
  f.reading.reading!.otherInformation[0]!.fields.push({
    ...field("productIdentifier", "EAN 00000999"),
    evidence: [{ ...evidence[0]!, quote: "EAN 00000999" }],
  });
  expect(
    commercialPlanTensions({ ...f.input, identifiers: [identifier] })
      .tensions[0]!.reason,
  ).toBe("IDENTITY");
});

it("does not transfer an explicitly later market week onto an offer's current sale period", async () => {
  const f = await fixture((r) =>
    r.reading!.operations[0]!.items[0]!.fields.push(
      field("marketSignal", "Tension attendue en S42"),
    ),
  );
  const t = commercialPlanTensions(f.input).tensions[0]!;
  expect(t.status).toBe("REVIEW");
  expect(t.reason).toBe("PERIOD");
  expect(t.planningWindow).toEqual({
    start: f.choice.saleStart,
    end: f.choice.saleEnd,
  });
});
