import { createHash, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  commercialOfferChoiceSchema,
  commercialOriginalOfferSourceSchema,
  commercialValidatedOfferSchema,
  commercialWeekPreparationSchema,
} from "@fl-copilot/domain";
import { makeCommercialChoiceFixture } from "../../../../scripts/commercial-choice-fixture-data";
import { makeCommercialPlanFixture } from "../../../../scripts/commercial-plan-fixture-data";
import {
  commercialChoiceId,
  commercialChoiceDuplicateKey,
  commercialChoiceSameSource,
} from "@fl-copilot/commercial-core";
import {
  commercialOfferValidationSource,
  commercialValidatedOfferId,
} from "@fl-copilot/commercial-core";
import { commercialWeekPreparationId } from "@fl-copilot/commercial-core";
import {
  buildCommercialWeekPlan,
  commercialPlanIssues,
} from "@fl-copilot/commercial-core";

const digest = async (value: string) =>
  createHash("sha256").update(value).digest("hex");
const original = (sourceDocumentId: string) =>
  commercialOriginalOfferSourceSchema.parse({
    kind: "PDF_ORIGINAL",
    sourceDocumentId,
    checksum: `sha256:${"a".repeat(64)}`,
    pageNumber: 2,
    excerpt:
      "Prospectus S44 — Raisin blanc vrac — du 26/10/2026 au 01/11/2026 — moins de 2,20 € le kg",
  });

it("preserves the exact legacy identity and accepts a real original address without fake extraction coordinates", async () => {
  const f = await makeCommercialChoiceFixture(
    {
      storeId: "11111111-1111-4111-8111-111111111111",
      readingId: "22222222-2222-4222-8222-222222222222",
    },
    digest,
    randomUUID,
  );
  expect(f.choice.id).toBe("90141bd7-2fa9-8505-81cb-b2df96c0f911");
  const source = original(f.sourceDocumentId);
  const choice = commercialOfferChoiceSchema.parse({
    ...f.choice,
    id: await commercialChoiceId(f.storeId, source, digest),
    source,
  });
  expect(choice.source).toEqual(source);
  expect(choice.source).not.toHaveProperty("readingId");
  expect(choice.source).not.toHaveProperty("operationIndex");
  expect(choice.source).not.toHaveProperty("itemIndex");
  expect(await commercialChoiceId(f.storeId, source, digest)).toBe(choice.id);
  expect(commercialChoiceDuplicateKey(choice)).toBe(
    commercialChoiceDuplicateKey(f.choice),
  );
  expect(
    commercialChoiceSameSource(choice, {
      ...choice,
      version: 2,
      note: "Reviewed",
    }),
  ).toBe(true);
  expect(
    commercialChoiceSameSource(choice, {
      ...choice,
      source: { ...source, pageNumber: 3 },
    }),
  ).toBe(false);
});

it("requires an actual immutable hash/page/excerpt and rejects invented source approval or AI provenance", () => {
  const source = original(randomUUID());
  for (const patch of [
    { checksum: "unknown" },
    { pageNumber: 0 },
    { pageNumber: 17 },
    { excerpt: " " },
    { readingId: randomUUID() },
    { approved: true },
    { confidence: 1 },
    { responseId: "fabricated" },
  ])
    expect(
      commercialOriginalOfferSourceSchema.safeParse({ ...source, ...patch })
        .success,
    ).toBe(false);
});

it("keeps explicit applicability and critical-field decisions mandatory for original-backed choices", async () => {
  const f = await makeCommercialChoiceFixture({}, digest, randomUUID);
  for (const patch of [
    { applicabilityConfirmed: false },
    { criticalFieldsConfirmed: false },
    { saleStart: "2026-02-31" },
    { productId: "" },
  ])
    expect(
      commercialOfferChoiceSchema.safeParse({
        ...f.choice,
        source: original(f.sourceDocumentId),
        ...patch,
      }).success,
    ).toBe(false);
});

it("builds a future week's plan from an explicitly reviewed original offer without any extraction page", async () => {
  const f = await makeCommercialPlanFixture(digest, randomUUID),
    source = original(f.sourceDocumentId);
  const choice = commercialOfferChoiceSchema.parse({
    ...f.choice,
    id: await commercialChoiceId(f.storeId, source, digest),
    source,
    operationKind: "PROSPECTUS",
    operationLabel: "Prospectus S44",
    saleStart: "2026-10-26",
    saleEnd: "2026-11-01",
  });
  const reviewed = commercialOfferValidationSource(choice, []);
  expect(reviewed).toEqual({
    sourceFields: [],
    evidence: [{ pageNumber: 2, quote: source.excerpt, region: null }],
  });
  const validation = commercialValidatedOfferSchema.parse({
    ...f.validated,
    id: await commercialValidatedOfferId(
      f.storeId,
      choice.id,
      choice.version,
      digest,
    ),
    choice,
    ...reviewed,
  });
  const preparation = commercialWeekPreparationSchema.parse({
    ...f.preparation,
    id: await commercialWeekPreparationId(f.storeId, "2026-10-26", digest),
    weekStart: "2026-10-26",
    weekEnd: "2026-11-01",
    offerRefs: [{ choiceId: choice.id, choiceVersion: choice.version }],
    placements: f.preparation.placements.map((p) => ({
      ...p,
      offerIds: [choice.id],
    })),
  });
  const context = {
    ...f.context,
    preparation,
    choices: [choice],
    validated: [validation],
    pages: [],
    originalSources: [
      {
        sourceDocumentId: source.sourceDocumentId,
        storeId: f.storeId,
        checksum: source.checksum,
      },
    ],
  };
  expect(commercialPlanIssues(preparation, context)).toEqual([]);
  const before = JSON.stringify(context);
  const plan = await buildCommercialWeekPlan(
    {
      preparation,
      version: 1,
      createdAt: "2026-10-24T12:00:00Z",
      validatedAt: "2026-10-24T12:00:00Z",
    },
    context,
    digest,
  );
  expect(plan.offers[0]?.sourceReference).toEqual(source);
  expect(plan.offers[0]?.customerMechanism).toEqual(choice.mechanism);
  expect(plan.operations[0]).toMatchObject({
    plannedStart: "2026-10-26",
    plannedEnd: "2026-11-01",
    announcedStart: null,
    announcedEnd: null,
    actualStart: null,
    actualEnd: null,
  });
  expect(JSON.stringify(context)).toBe(before);
  expect(
    commercialPlanIssues(preparation, { ...context, originalSources: [] }),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "SOURCE_INVALID" }),
    ]),
  );
});
