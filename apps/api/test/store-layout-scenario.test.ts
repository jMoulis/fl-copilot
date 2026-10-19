import { randomUUID } from "node:crypto";
import { it, expect } from "vitest";
import {
  layoutScenarioInputSchema,
  storeLayoutScenarioSchema,
} from "@fl-copilot/domain";
import {
  prepareStoreLayoutScenario,
  addStoreLayoutMobile,
} from "@fl-copilot/commercial-core";
import { layoutScenarioFixture } from "../../../scripts/test-layout-scenario-fixtures";
import { nextLayout } from "../../../scripts/test-store-layout-fixtures";
import { presentStoreLayoutScenario } from "../src/copilot/store-layout-scenario-tool";
import { buildStoreLayoutScenarioMessages } from "../src/copilot/store-layout-scenario-messages";
import { chatFixture } from "../../../scripts/test-chat-fixtures";
it("binds exact adopted furniture/surface and canonical item versions, preserves dates/lineage and never changes geometry or business state", async () => {
  const f = await layoutScenarioFixture(),
    before = JSON.stringify(f.sources),
    r = prepareStoreLayoutScenario(f.reference.storeId, f.input, f.sources);
  expect(r.status).toBe("READY");
  expect(r.scenario).toMatchObject({
    status: "PROPOSED",
    physicalRevisionId: f.reference.revisionId,
    physicalVersion: f.reference.version,
    storeId: f.reference.storeId,
  });
  expect(r.scenario?.assignments[0]?.targetLabel).toContain("Face A");
  expect(r.scenario?.assignments[1]?.targetLabel).toContain(
    "meuble entier, surfaces non réparties",
  );
  expect(r.scenario?.items.find((i) => i.kind === "OFFER")).toMatchObject({
    id: f.choice.choice.id,
    version: f.choice.choice.version,
    source: f.choice.choice.source,
    saleStart: f.choice.choice.saleStart,
    saleEnd: f.choice.choice.saleEnd,
    productVersion: f.choice.product.version,
  });
  expect(r.scenario?.geometry.status).toBe("INCOMPLETE");
  expect(JSON.stringify(f.sources)).toBe(before);
  expect(JSON.stringify(r)).not.toContain("updatedBy");
  expect(r.scenario).not.toHaveProperty("capacity");
});
it("uses the adopted reference despite a newer draft and refuses a replaced reference or absent adopted source", async () => {
  const f = await layoutScenarioFixture(),
    draft = nextLayout(f.reference);
  draft.content.furniture[0]!.label = "Intention non adoptée";
  const r = prepareStoreLayoutScenario(f.reference.storeId, f.input, {
    ...f.sources,
    layout: { head: draft, reference: f.reference },
  });
  expect(r.status).toBe("READY");
  expect(JSON.stringify(r)).not.toContain("Intention non adoptée");
  const id = randomUUID(),
    adopted = nextLayout(draft, {
      action: "ADOPT_REFERENCE",
      revisionId: id,
      referenceRevisionId: id,
    });
  expect(
    prepareStoreLayoutScenario(f.reference.storeId, f.input, {
      ...f.sources,
      layout: { head: adopted, reference: adopted },
    }).status,
  ).toBe("STALE");
  expect(
    prepareStoreLayoutScenario(f.reference.storeId, f.input, {
      ...f.sources,
      layout: { head: f.first, reference: null },
    }).status,
  ).toBe("NO_REFERENCE");
  expect(
    prepareStoreLayoutScenario(f.reference.storeId, f.input, {
      ...f.sources,
      layout: { head: null, reference: null },
    }).status,
  ).toBe("ABSENT");
});
it("requires exact target ownership, never invents a fourth TG or redirects a surface to another fixture", async () => {
  const f = await layoutScenarioFixture(),
    input = structuredClone(f.input);
  input.assignments = [input.assignments[0]!];
  input.assignments[0]!.furnitureId = f.tg.id;
  expect(
    prepareStoreLayoutScenario(f.reference.storeId, input, f.sources).status,
  ).toBe("BLOCKED");
  input.assignments[0]!.surfaceId = null;
  input.assignments[0]!.furnitureId = randomUUID();
  expect(
    prepareStoreLayoutScenario(f.reference.storeId, input, f.sources).status,
  ).toBe("BLOCKED");
});
it("keeps independent bacs, upper shelves and separately recorded mobiles as exact allocation targets", async () => {
  const f = await layoutScenarioFixture();
  f.reference.content = addStoreLayoutMobile(
    f.reference.content,
    randomUUID,
    "Mobile pommes",
    f.fixed.id,
  );
  const shelf = f.reference.content.surfaces.find(
      (s) => s.furnitureId === f.fixed.id && s.kind === "UPPER_SHELF",
    )!,
    mobile = f.reference.content.furniture.at(-1)!,
    mobileSurface = f.reference.content.surfaces.at(-1)!;
  const input = {
    ...f.input,
    assignments: [
      f.input.assignments[0]!,
      { ...f.input.assignments[0]!, surfaceId: shelf.id },
      {
        ...f.input.assignments[0]!,
        furnitureId: mobile.id,
        surfaceId: mobileSurface.id,
      },
    ],
  };
  const r = prepareStoreLayoutScenario(f.reference.storeId, input, f.sources);
  expect(r.status).toBe("READY");
  expect(r.scenario?.assignments).toHaveLength(3);
  expect(f.reference.content.furniture.at(-1)?.x.mm).toBeNull();
});
it.each([
  "MISSING_PRODUCT",
  "INACTIVE_PRODUCT",
  "WITHDRAWN_OFFER",
  "OUTSIDE_WEEK",
])("does not prepare allocations from %s", async (mode) => {
  const f = await layoutScenarioFixture();
  if (mode === "MISSING_PRODUCT")
    f.sources.products = f.sources.products.filter(
      (p) => p.id !== f.product.id,
    );
  if (mode === "INACTIVE_PRODUCT") f.product.status = "INACTIVE";
  if (mode === "WITHDRAWN_OFFER") f.sources.choices[0]!.status = "WITHDRAWN";
  if (mode === "OUTSIDE_WEEK") f.input.weekStart = "2026-10-19";
  expect(
    prepareStoreLayoutScenario(f.reference.storeId, f.input, f.sources).status,
  ).toBe("BLOCKED");
});
it("rejects foreign private sources and contradictory immutable layout snapshots before projection", async () => {
  const f = await layoutScenarioFixture();
  expect(() =>
    prepareStoreLayoutScenario(randomUUID(), f.input, f.sources),
  ).toThrow("SCOPE");
  f.sources.products[0]!.storeId = randomUUID();
  expect(() =>
    prepareStoreLayoutScenario(f.reference.storeId, f.input, f.sources),
  ).toThrow("SCOPE");
  const g = await layoutScenarioFixture(),
    tampered = structuredClone(g.reference);
  tampered.content.room.width = { mm: 1, quality: "DECLARED" };
  expect(() =>
    prepareStoreLayoutScenario(g.reference.storeId, g.input, {
      ...g.sources,
      layout: { head: g.reference, reference: tampered },
    }),
  ).toThrow("REFERENCE_INVALID");
});
it("rejects duplicate/overlapping targets, whole-versus-surface mixing, empty inputs and model-supplied authority or quantities", async () => {
  const f = await layoutScenarioFixture(),
    a = f.input.assignments[0]!;
  for (const assignments of [[], [a, a], [a, { ...a, surfaceId: null }]])
    expect(
      layoutScenarioInputSchema.safeParse({ ...f.input, assignments }).success,
    ).toBe(false);
  for (const key of [
    "storeId",
    "ownerId",
    "version",
    "query",
    "coordinates",
    "capacity",
    "image",
    "canWrite",
  ])
    expect(
      layoutScenarioInputSchema.safeParse({ ...f.input, [key]: true }).success,
    ).toBe(false);
  expect(
    layoutScenarioInputSchema.safeParse({
      ...f.input,
      assignments: [{ ...a, quantityKg: 10 }],
    }).success,
  ).toBe(false);
});
it("preserves immutable source/card IDs on replay, with no actor or full storage snapshot in the artifact", async () => {
  const f = await layoutScenarioFixture(),
    chat = chatFixture(randomUUID),
    assistant = {
      ...chat.message,
      id: randomUUID(),
      storeId: f.reference.storeId,
      role: "ASSISTANT" as const,
      replyToMessageId: chat.message.id,
      text: "Voici une proposition.",
      attachments: [],
    };
  const p = presentStoreLayoutScenario(f.reference.storeId, f.input, f.sources),
    a = buildStoreLayoutScenarioMessages(assistant, [p]);
  expect(a).toHaveLength(1);
  expect(buildStoreLayoutScenarioMessages(assistant, [p])).toEqual(a);
  expect(a[0]!.text.length).toBeLessThan(16000);
  expect(a[0]!.text).not.toContain(f.reference.updatedBy);
  expect(a[0]!.text).not.toContain('content":');
  const bad = structuredClone(p);
  bad.scenario!.storeId = randomUUID();
  expect(() => buildStoreLayoutScenarioMessages(assistant, [bad])).toThrow(
    "SCOPE",
  );
  const badScenario = structuredClone(p.scenario!);
  badScenario.items = [];
  expect(storeLayoutScenarioSchema.safeParse(badScenario).success).toBe(false);
});

it("refuses a card beyond the durable message budget as a whole, without truncating valid references", async () => {
  const f = await layoutScenarioFixture();
  for (const a of f.reference.content.assemblies)
    a.label = "Îlot " + "a".repeat(114);
  for (const a of f.reference.content.furniture)
    a.label = "Élément " + "b".repeat(110);
  const choices = Array.from({ length: 16 }, (_, i) => ({
    ...f.choice.choice,
    id: randomUUID(),
    rawProductLabel: "Raisin " + "c".repeat(230),
    source: {
      ...f.choice.choice.source,
      operationIndex: i,
      checksum: "d".repeat(200),
    },
  }));
  const input = {
    ...f.input,
    title: "Une proposition " + "e".repeat(100),
    assignments: f.reference.content.furniture.slice(0, 8).map((a, i) => ({
      furnitureId: a.id,
      surfaceId: null,
      items: choices
        .slice(i * 2, i * 2 + 2)
        .map((c) => ({ kind: "OFFER", id: c.id })),
      reason: "Une recommandation " + "f".repeat(220),
    })),
    assumptions: Array.from(
      { length: 4 },
      () => "Hypothèse " + "g".repeat(225),
    ),
  };
  const sources = { ...f.sources, choices };
  expect(
    prepareStoreLayoutScenario(f.reference.storeId, input, sources).status,
  ).toBe("READY");
  const result = presentStoreLayoutScenario(
    f.reference.storeId,
    input,
    sources,
  );
  expect(result.status).toBe("LIMIT_EXCEEDED");
  expect(result.scenario).toBeNull();
  expect(result.input.assignments).toHaveLength(8);
  expect(
    layoutScenarioInputSchema.safeParse({
      ...input,
      assignments: [
        ...input.assignments,
        { ...input.assignments[0]!, furnitureId: f.tg.id },
      ],
    }).success,
  ).toBe(false);
  const extra = structuredClone(input);
  extra.assignments[0]!.items.push({ kind: "PRODUCT", id: randomUUID() });
  expect(layoutScenarioInputSchema.safeParse(extra).success).toBe(false);
});
