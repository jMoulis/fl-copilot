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
  for (const status of [
    "UNCHANGED",
    "BLOCKED",
    "UNAVAILABLE",
    "LIMIT_EXCEEDED",
  ])
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

it("creates stable application-owned TG IDs, removes only named placements, preserves offer selection and versions review cards", async () => {
  const { f, basis, assistant, evidence } = await fixture();
  const sourceIdea = {
    readingId: f.reading.id,
    checksum: f.reading.checksum,
    tgIndex: 0,
  };
  basis.preparation.placements[0].sourceIdea = sourceIdea;
  const input = copilotPreparationPatchSchema.parse({
    weekStart: f.preparation.weekStart,
    patch: {
      tgRemovals: [f.preparation.placements[0].id],
      tgAdditions: [
        { label: "TG nouvelle", theme: "Saison", offerIds: [f.choice.id] },
      ],
    },
  });
  const cards = buildPreparationProposalMessages(assistant, [
    { input, basis, evidence, status: "READY" },
  ]);
  expect(cards).toHaveLength(1);
  const card = readCopilotPreparationProposal(cards[0]);
  expect(card.content.schemaVersion).toBe(2);
  const after = card.request.input.draft;
  expect(after.placements).toHaveLength(1);
  expect(after.placements[0]).toMatchObject({
    label: "TG nouvelle",
    sourceIdea: null,
    offerIds: [f.choice.id],
  });
  expect(after.placements[0].id).not.toBe(f.preparation.placements[0].id);
  expect(readCopilotPreparationProposal(cards[0]).request).toEqual(
    card.request,
  );
  expect(after.offerRefs).toEqual(f.preparation.offerRefs);
  expect(basis.preparation.placements[0].sourceIdea).toEqual(sourceIdea);
  expect(() =>
    readCopilotPreparationProposal({
      ...cards[0],
      text: JSON.stringify({ ...card.content, schemaVersion: 1 }),
    }),
  ).toThrow("VERSION");
  const { preparationAdditionId } = await import("@fl-copilot/domain");
  expect(preparationAdditionId(cards[0].id, 0)).toBe(after.placements[0].id);
  expect(preparationAdditionId(cards[0].id, 1)).not.toBe(
    after.placements[0].id,
  );
});
it("requires explicit complete additions, canonical capacity/unique labels and valid removal IDs without model authority", async () => {
  const { f, basis } = await fixture(),
    tg = f.preparation.placements[0];
  const input = {
    weekStart: f.preparation.weekStart,
    patch: {
      tgCapacity: 2,
      tgAdditions: [{ label: "TG nouvelle", theme: "", offerIds: [] }],
    },
  };
  const { copilotPreparationEditPatchSchema } =
    await import("@fl-copilot/domain");
  expect(copilotPreparationEditPatchSchema.safeParse(input).success).toBe(
    false,
  );
  for (const patch of [
    { tgAdditions: [] },
    { tgRemovals: [] },
    { tgRemovals: [tg.id, tg.id] },
    {
      tgRemovals: [tg.id],
      tgUpdates: [{ placementId: tg.id, theme: "Autre" }],
    },
    { tgAdditions: [{ ...input.patch.tgAdditions[0], id: tg.id }] },
    {
      tgAdditions: [
        { ...input.patch.tgAdditions[0], sourceIdea: tg.sourceIdea },
      ],
    },
  ])
    expect(
      copilotPreparationPatchSchema.safeParse({ ...input, patch }).success,
    ).toBe(false);
  for (const patch of [
    { tgAdditions: input.patch.tgAdditions }, // existing one-TG capacity, no silent increase
    { tgRemovals: [randomUUID()] },
    {
      tgCapacity: 2,
      tgAdditions: [{ ...input.patch.tgAdditions[0], label: tg.label }],
    },
    {
      tgCapacity: 2,
      tgAdditions: [
        { ...input.patch.tgAdditions[0], offerIds: [randomUUID()] },
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
  const r = prepareWeekPatch(
    copilotPreparationPatchSchema.parse(input),
    basis,
    randomUUID(),
  );
  expect(r.input.draft.placements).toHaveLength(2);
  expect(r.input.draft.placements[0]).toEqual(tg);
  expect(r.input.draft.tgCapacity).toBe(2);
});

it("initializes a missing week with exact retained choice versions and no invented capacity, IDs or application timestamps", async () => {
  const { f, assistant, evidence } = await fixture();
  const input = copilotPreparationPatchSchema.parse({
    weekStart: "2026-12-28",
    create: { choiceIds: [f.choice.id] },
    patch: { note: "Préparer la semaine" },
  });
  const basis = {
    preparation: null,
    creationStoreId: f.storeId,
    choices: [
      {
        ...f.choice,
        version: 3,
        saleStart: "2026-12-28",
        saleEnd: "2027-01-03",
      },
    ],
  };
  const cards = buildPreparationProposalMessages(assistant, [
    { input, basis, evidence, status: "READY" },
  ]);
  const r = readCopilotPreparationProposal(cards[0]);
  expect(r.content.schemaVersion).toBe(3);
  expect(r.request.input).toMatchObject({
    expectedVersion: null,
    draft: {
      weekStart: "2026-12-28",
      weekEnd: "2027-01-03",
      tgCapacity: null,
      status: "DRAFT",
      offerRefs: [{ choiceId: f.choice.id, choiceVersion: 3 }],
      placements: [],
    },
  });
  expect(JSON.stringify(r.request)).not.toContain("2000-01-01");
  for (const schemaVersion of [1, 2])
    expect(() =>
      readCopilotPreparationProposal({
        ...cards[0],
        text: JSON.stringify({ ...r.content, schemaVersion }),
      }),
    ).toThrow("VERSION");
  const empty = copilotPreparationPatchSchema.parse({
    weekStart: input.weekStart,
    create: { choiceIds: [] },
    patch: {},
  });
  expect(
    prepareWeekPatch(empty, { ...basis, choices: [] }, randomUUID()).input.draft
      .tgCapacity,
  ).toBeNull();
  const { validatePreparationBasis } = await import("@fl-copilot/domain");
  expect(() =>
    validatePreparationBasis(randomUUID(), empty, { ...basis, choices: [] }),
  ).toThrow("SCOPE");
});
it("keeps new-week creation distinct from edit/layout schemas and rejects unknown choices, scope or revision injection", async () => {
  const { f } = await fixture(),
    input = {
      weekStart: f.preparation.weekStart,
      create: { choiceIds: [f.choice.id] },
      patch: {},
    };
  const {
    copilotPreparationEditPatchSchema,
    copilotPreparationLayoutPatchSchema,
    validatePreparationBasis,
  } = await import("@fl-copilot/domain");
  expect(copilotPreparationEditPatchSchema.safeParse(input).success).toBe(
    false,
  );
  expect(copilotPreparationLayoutPatchSchema.safeParse(input).success).toBe(
    false,
  );
  for (const patch of [
    { tgUpdates: [{ placementId: randomUUID(), theme: "X" }] },
    { tgRemovals: [randomUUID()] },
  ])
    expect(
      copilotPreparationPatchSchema.safeParse({ ...input, patch }).success,
    ).toBe(false);
  for (const extra of [
    { creationStoreId: f.storeId },
    { expectedVersion: 1 },
    { operationId: randomUUID() },
    { sourceReviewed: true },
  ])
    expect(
      copilotPreparationPatchSchema.safeParse({ ...input, ...extra }).success,
    ).toBe(false);
  expect(
    copilotPreparationPatchSchema.safeParse({
      ...input,
      create: { choiceIds: [f.choice.id, f.choice.id] },
    }).success,
  ).toBe(false);
  const parsed = copilotPreparationPatchSchema.parse(input);
  for (const basis of [
    { preparation: f.preparation, choices: [f.choice] },
    { preparation: null, choices: [f.choice] },
    { preparation: null, creationStoreId: f.storeId, choices: [] },
    {
      preparation: null,
      creationStoreId: f.storeId,
      choices: [{ ...f.choice, storeId: randomUUID() }],
    },
  ])
    expect(() => validatePreparationBasis(f.storeId, parsed, basis)).toThrow(
      "SCOPE",
    );
});

it("preserves pinned references and requires explicit TG changes when replacing selected offers", async () => {
  const { f, basis, assistant, evidence } = await fixture();
  const added = { ...f.choice, id: randomUUID(), version: 3 };
  const input = copilotPreparationPatchSchema.parse({
    weekStart: f.preparation.weekStart,
    patch: {
      offerSelection: {
        addChoiceIds: [added.id],
        removeChoiceIds: [f.choice.id],
      },
      tgUpdates: [
        { placementId: f.preparation.placements[0].id, offerIds: [added.id] },
      ],
    },
  });
  const review = { ...basis, choices: [...basis.choices, added] };
  const cards = buildPreparationProposalMessages(assistant, [
    { input, basis: review, evidence, status: "READY" },
  ]);
  const result = readCopilotPreparationProposal(cards[0]);
  expect(result.content.schemaVersion).toBe(4);
  expect(result.request.input.draft.offerRefs).toEqual([
    { choiceId: added.id, choiceVersion: 3 },
  ]);
  expect(result.request.input.draft.placements[0].offerIds).toEqual([added.id]);
  expect(() =>
    prepareWeekPatch(
      { ...input, patch: { offerSelection: input.patch.offerSelection } },
      review,
      randomUUID(),
    ),
  ).toThrow();
  const kept = prepareWeekPatch(
    {
      ...input,
      patch: { offerSelection: { addChoiceIds: [f.choice.id, added.id] } },
    },
    { ...review, choices: [{ ...f.choice, version: 9 }, added] },
    randomUUID(),
  );
  expect(kept.input.draft.offerRefs).toEqual([
    ...f.preparation.offerRefs,
    { choiceId: added.id, choiceVersion: 3 },
  ]);
  expect(() =>
    readCopilotPreparationProposal({
      ...cards[0],
      text: JSON.stringify({ ...result.content, schemaVersion: 3 }),
    }),
  ).toThrow();
});
it("allows explicit missing-reference cleanup but rejects invalid selections and old client schemas", async () => {
  const { f, basis } = await fixture();
  const input = copilotPreparationPatchSchema.parse({
    weekStart: f.preparation.weekStart,
    patch: {
      offerSelection: { removeChoiceIds: [f.choice.id] },
      tgRemovals: [f.preparation.placements[0].id],
    },
  });
  expect(
    prepareWeekPatch(input, { ...basis, choices: [] }, randomUUID()).input.draft
      .offerRefs,
  ).toEqual([]);
  const {
    copilotPreparationCreatePatchSchema,
    copilotPreparationLayoutPatchSchema,
  } = await import("@fl-copilot/domain");
  for (const schema of [
    copilotPreparationCreatePatchSchema,
    copilotPreparationLayoutPatchSchema,
  ])
    expect(schema.safeParse(input).success).toBe(false);
  for (const offerSelection of [
    {},
    { addChoiceIds: [f.choice.id, f.choice.id] },
    { addChoiceIds: [f.choice.id], removeChoiceIds: [f.choice.id] },
  ])
    expect(
      copilotPreparationPatchSchema.safeParse({
        ...input,
        patch: { offerSelection },
      }).success,
    ).toBe(false);
  expect(() =>
    prepareWeekPatch(
      {
        ...input,
        patch: { offerSelection: { removeChoiceIds: [randomUUID()] } },
      },
      basis,
      randomUUID(),
    ),
  ).toThrow();
  expect(
    copilotPreparationPatchSchema.safeParse({
      ...input,
      create: { choiceIds: [] },
    }).success,
  ).toBe(false);
});
