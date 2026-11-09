import { expect, it } from "vitest";
import {
  copilotPreparationPatchSchema,
  copilotLegacyPreparationPatchSchema,
} from "./copilot-preparation-proposal";
let sequence = 0;
const randomUUID = () =>
  `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
import {
  commercialTgPresentationSchema,
  resizeTgPresentationZone,
  dropsCommercialTgPresentation,
} from "./commercial-tg-presentation";
import {
  preparationRequestSchema,
  reviewPreparationSurfaceShares,
  readReviewedPreparationRequest,
} from "./copilot-commercial-preparation";
const presentation = {
  zones: [
    { label: "Clémentine", sharePct: 60, role: "ACCROCHE" },
    { label: "Orange", sharePct: 25, role: "RELAIS" },
    { label: "Kaki", sharePct: 15, role: "GAMME" },
  ],
  reason: "Un thème de saison",
  counterPromotion: { label: "Banane", reason: "Hors TG" },
};
it("validates a full surface without counting the separate counter-promotion, rejects empty/duplicate/fractional/partial zones", () => {
  expect(commercialTgPresentationSchema.parse(presentation).zones).toHaveLength(
    3,
  );
  for (const zones of [
    [],
    presentation.zones.slice(1),
    presentation.zones.map((z) => ({ ...z, sharePct: z.sharePct + 0.1 })),
    presentation.zones.map((z) => ({ ...z, label: "orange" })),
  ])
    expect(
      commercialTgPresentationSchema.safeParse({ ...presentation, zones })
        .success,
    ).toBe(false);
});
it("keeps all products and an exact integer total through repeated surface adjustments, without changing the source proposal", () => {
  let next = commercialTgPresentationSchema.parse(presentation);
  for (let round = 0; round < 100; round++) {
    next = resizeTgPresentationZone(next, round % 3, 1 + (round % 98));
    expect(next.zones.reduce((sum, z) => sum + z.sharePct, 0)).toBe(100);
    expect(
      next.zones.every((z) => Number.isInteger(z.sharePct) && z.sharePct > 0),
    ).toBe(true);
    expect(next.zones.map((z) => z.label)).toEqual(
      presentation.zones.map((z) => z.label),
    );
    expect(next.counterPromotion).toEqual(presentation.counterPromotion);
  }
  expect(presentation.zones.map((z) => z.sharePct)).toEqual([60, 25, 15]);
  expect(() => resizeTgPresentationZone(presentation, 0, 99)).toThrow();
});
it("allows native review to change only surface proportions and audits the exact saved request", () => {
  const id = randomUUID(),
    original = preparationRequestSchema.parse({
      operationId: randomUUID(),
      schemaVersion: 1,
      tool: "commercial.preparation.save",
      input: {
        expectedVersion: null,
        draft: {
          weekStart: "2026-11-09",
          weekEnd: "2026-11-15",
          status: "DRAFT",
          tgCapacity: 1,
          offerRefs: [],
          placements: [
            {
              id,
              label: "TG1",
              theme: "Vitamines",
              offerIds: [],
              sourceIdea: null,
              presentation,
            },
          ],
          note: "",
        },
      },
    });
  const reviewed = reviewPreparationSurfaceShares(original, [
    { placementId: id, shares: [70, 20, 10] },
  ]);
  expect(readReviewedPreparationRequest(original, reviewed)).toEqual(reviewed);
  expect(
    original.input.draft.placements[0]!.presentation!.zones[0]!.sharePct,
  ).toBe(60);
  for (const mutation of [
    (r: typeof reviewed) => {
      r.input.draft.placements[0]!.theme = "Autre thème";
    },
    (r: typeof reviewed) => {
      r.input.draft.placements[0]!.presentation!.zones[0]!.label = "Pomme";
    },
    (r: typeof reviewed) => {
      r.operationId = randomUUID();
    },
    (r: typeof reviewed) => {
      r.input.draft.placements[0]!.presentation!.counterPromotion = null;
    },
  ]) {
    const altered: typeof reviewed = JSON.parse(JSON.stringify(reviewed));
    mutation(altered);
    expect(() => readReviewedPreparationRequest(original, altered)).toThrow(
      "REVIEW_INVALID",
    );
  }
  expect(() =>
    reviewPreparationSurfaceShares(original, [
      { placementId: id, shares: [60, 20, 10] },
    ]),
  ).toThrow();
  expect(() =>
    reviewPreparationSurfaceShares(original, [
      { placementId: randomUUID(), shares: [70, 20, 10] },
    ]),
  ).toThrow();
  expect(() =>
    reviewPreparationSurfaceShares(original, [
      { placementId: id, shares: [100] },
    ]),
  ).toThrow();
});
it("preserves legacy plans without inventing percentages and requires an explicit removal of a known presentation", () => {
  const id = randomUUID();
  expect(dropsCommercialTgPresentation([{ id, presentation }], [{ id }])).toBe(
    true,
  );
  expect(
    dropsCommercialTgPresentation(
      [{ id, presentation }],
      [{ id, presentation: null }],
    ),
  ).toBe(false);
  expect(dropsCommercialTgPresentation([{ id }], [{ id }])).toBe(false);
});

it("does not advertise visual allocations to older native confirmation cards", () => {
  const input = {
    weekStart: "2026-11-09",
    create: { choiceIds: [] },
    patch: {
      tgCapacity: 1,
      tgAdditions: [
        { label: "TG1", theme: "Vitamines", offerIds: [], presentation },
      ],
    },
  };
  expect(copilotPreparationPatchSchema.safeParse(input).success).toBe(true);
  expect(copilotLegacyPreparationPatchSchema.safeParse(input).success).toBe(
    false,
  );
});
