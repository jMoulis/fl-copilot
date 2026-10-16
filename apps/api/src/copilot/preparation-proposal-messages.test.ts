import { randomUUID } from "node:crypto";
import { it, expect } from "vitest";
import { commercialPlanFixture } from "../../../../scripts/test-commercial-plan-fixtures";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import {
  copilotPreparationPatchSchema,
  prepareWeekPatch,
  readCopilotPreparationProposal,
} from "@fl-copilot/domain";
import { buildPreparationProposalMessages } from "./preparation-proposal-messages";
async function fixture() {
  const f = await commercialPlanFixture(),
    c = chatFixture(randomUUID);
  const input = copilotPreparationPatchSchema.parse({
    weekStart: f.preparation.weekStart,
    patch: {
      note: "Mettre le raisin en avant",
      tgUpdates: [
        {
          placementId: f.preparation.placements[0].id,
          theme: "Raisin de saison",
          offerIds: [],
        },
      ],
    },
  });
  const basis = { preparation: f.preparation, choices: [f.choice] };
  const evidence = [
    {
      id: "prep",
      sourceId: f.preparation.id,
      sourceVersion: 1,
      sourceType: "DATA_QUALITY" as const,
      label: "Brouillon",
      value: "Préparé",
      factKind: "QUALITY" as const,
    },
  ];
  const assistant = {
    ...c.message,
    id: randomUUID(),
    storeId: f.storeId,
    role: "ASSISTANT" as const,
    replyToMessageId: c.message.id,
    attachments: [],
  };
  return { f, input, basis, assistant, evidence };
}
it("patches only requested TG fields while preserving identities, refs, sources and other placements", async () => {
  const { f, input, basis } = await fixture();
  const sourceIdea = {
    readingId: f.reading.id,
    checksum: f.reading.checksum,
    tgIndex: 0,
  };
  const second = {
    ...f.preparation.placements[0],
    id: randomUUID(),
    label: "TG sortie",
  };
  basis.preparation = {
    ...basis.preparation,
    tgCapacity: 2,
    placements: [{ ...basis.preparation.placements[0], sourceIdea }, second],
  };
  const r = prepareWeekPatch(input, basis, randomUUID());
  expect(r.input.expectedVersion).toBe(1);
  expect(r.input.draft.offerRefs).toEqual(f.preparation.offerRefs);
  expect(r.input.draft.placements[0]).toMatchObject({
    sourceIdea,
    theme: "Raisin de saison",
    offerIds: [],
  });
  expect(r.input.draft.placements[1]).toEqual(second);
  expect(r.input.draft.note).toBe(input.patch.note);
});
it("rejects scope/version/source/confirmation injection, duplicates, unknown TGs, incompatible capacity and unselected offers", async () => {
  const { input, basis } = await fixture();
  for (const extra of [
    { storeId: randomUUID() },
    { expectedVersion: 1 },
    { sourceReviewed: true },
    { canPrepareCommercialWeek: true },
  ])
    expect(
      copilotPreparationPatchSchema.safeParse({ ...input, ...extra }).success,
    ).toBe(false);
  for (const patch of [
    {},
    { tgUpdates: [{ placementId: input.patch.tgUpdates![0].placementId }] },
    { tgUpdates: [...input.patch.tgUpdates!, ...input.patch.tgUpdates!] },
  ])
    expect(
      copilotPreparationPatchSchema.safeParse({ ...input, patch }).success,
    ).toBe(false);
  for (const patch of [
    { tgCapacity: 0 },
    { tgUpdates: [{ placementId: randomUUID(), theme: "X" }] },
    {
      tgUpdates: [
        {
          placementId: input.patch.tgUpdates![0].placementId,
          offerIds: [randomUUID()],
        },
      ],
    },
  ])
    expect(() =>
      prepareWeekPatch(
        copilotPreparationPatchSchema.parse({ ...input, patch }),
        basis,
        randomUUID(),
      ),
    ).toThrow();
});
it("builds stable scoped cards and keeps only the latest preview per week; no unchanged or blocked action", async () => {
  const { input, basis, assistant, evidence } = await fixture();
  const preview = { input, basis, evidence, status: "READY" };
  const cards = buildPreparationProposalMessages(assistant, [preview]);
  expect(buildPreparationProposalMessages(assistant, [preview])).toEqual(cards);
  expect(
    readCopilotPreparationProposal(cards[0]).request.input.draft.note,
  ).toBe(input.patch.note);
  for (const status of ["UNCHANGED", "BLOCKED", "UNAVAILABLE"])
    expect(
      buildPreparationProposalMessages(assistant, [
        preview,
        { ...preview, status },
      ]),
    ).toEqual([]);
  expect(() =>
    buildPreparationProposalMessages({ ...assistant, storeId: randomUUID() }, [
      preview,
    ]),
  ).toThrow("SCOPE");
});
