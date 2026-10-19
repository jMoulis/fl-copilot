import { randomUUID } from "node:crypto";
import { it, expect } from "vitest";
import { copilotLayoutEditInputSchema } from "@fl-copilot/domain";
import {
  layoutFixture,
  nextLayout,
  completeLayoutGeometry,
} from "../../../scripts/test-store-layout-fixtures";
import { prepareStoreLayoutEdit } from "@fl-copilot/commercial-core";
import { addStoreLayoutMobile } from "@fl-copilot/commercial-core";
function fixture() {
  const first = layoutFixture(),
    id = randomUUID(),
    head = nextLayout(first, {
      revisionId: id,
      referenceRevisionId: id,
      action: "ADOPT_REFERENCE",
    });
  const input = {
    action: "EDIT" as const,
    expectedRevisionId: head.revisionId,
    targetId: null,
    patch: { widthCm: 1140.5 },
  };
  return { head, input, snapshot: { head, reference: head } };
}
it("patches only requested cm fields, preserves IDs/source qualifications, and never adopts a reference", () => {
  const f = fixture(),
    r = prepareStoreLayoutEdit(f.head.storeId, f.input, f.snapshot);
  expect(r.status).toBe("READY");
  expect(r.after?.room.width).toEqual({ mm: 11405, quality: "DECLARED" });
  expect(r.after?.room.depth).toEqual(f.head.content.room.depth);
  expect(r.after?.furniture).toEqual(f.head.content.furniture);
  expect(f.head.content.room.width.quality).toBe("REFERENCE");
  expect(r.changes).toHaveLength(1);
  expect(r.basis?.sourceRevisionId).toBe(f.head.revisionId);
});
it("reuses the active newer draft, refuses stale/foreign snapshots and never resurrects abandoned content", () => {
  const f = fixture(),
    draft = nextLayout(f.head);
  draft.content.furniture[0]!.label = "Intention abandonnée";
  const input = { ...f.input, expectedRevisionId: draft.revisionId };
  expect(
    prepareStoreLayoutEdit(f.head.storeId, input, {
      head: draft,
      reference: f.head,
    }).after?.furniture[0]?.label,
  ).toBe("Intention abandonnée");
  const abandoned = nextLayout(draft, { action: "DISCARD_DRAFT" }),
    r = prepareStoreLayoutEdit(
      f.head.storeId,
      { ...input, expectedRevisionId: abandoned.revisionId },
      { head: abandoned, reference: f.head },
    );
  expect(r.status).toBe("READY");
  expect(r.after?.furniture).toEqual(f.head.content.furniture);
  expect(r.basis?.sourceRevisionId).toBe(f.head.revisionId);
  expect(
    prepareStoreLayoutEdit(f.head.storeId, f.input, {
      head: draft,
      reference: f.head,
    }).status,
  ).toBe("STALE");
  expect(() =>
    prepareStoreLayoutEdit(randomUUID(), input, {
      head: draft,
      reference: f.head,
    }),
  ).toThrow("SCOPE");
});
it("preserves declared/measured equal values but explicit reference confirmation becomes declared", () => {
  const f = fixture(),
    input = { ...f.input, patch: { widthCm: 1150 } };
  expect(prepareStoreLayoutEdit(f.head.storeId, input, f.snapshot).status).toBe(
    "READY",
  );
  f.head.content.room.width.quality = "MEASURED";
  expect(prepareStoreLayoutEdit(f.head.storeId, input, f.snapshot).status).toBe(
    "UNCHANGED",
  );
  expect(
    prepareStoreLayoutEdit(
      f.head.storeId,
      { ...input, patch: { widthCm: null } },
      f.snapshot,
    ).after?.room.width,
  ).toEqual({ mm: null, quality: "UNKNOWN" });
});
it("moves a whole island and hosted mobile once without drawing fallbacks; refuses ambiguous rotation atomically", () => {
  const f = fixture();
  f.head.content = completeLayoutGeometry();
  const a = f.head.content.assemblies[0]!,
    child = f.head.content.furniture.find((x) => x.assemblyId === a.id)!;
  f.head.content = addStoreLayoutMobile(
    f.head.content,
    randomUUID,
    "Mobile",
    child.id,
  );
  const input = {
    ...f.input,
    targetId: a.id,
    patch: { xCm: a.x.mm! / 10 + 10, yCm: a.y.mm! / 10 + 20 },
  };
  const r = prepareStoreLayoutEdit(f.head.storeId, input, f.snapshot);
  expect(r.status).toBe("READY");
  expect(r.after?.furniture.find((x) => x.id === child.id)?.x.mm).toBe(
    child.x.mm! + 100,
  );
  expect(r.after?.furniture.at(-1)?.x.mm).toBeNull();
  expect(r.after?.furniture.at(-1)?.rotation).toBeNull();
  const mobile = f.head.content.furniture.at(-1)!;
  mobile.x = { mm: 1, quality: "DECLARED" };
  const frozen = JSON.stringify(f.head);
  expect(
    prepareStoreLayoutEdit(
      f.head.storeId,
      { ...input, patch: { rotation: 90 } },
      f.snapshot,
    ).status,
  ).toBe("BLOCKED");
  expect(JSON.stringify(f.head)).toBe(frozen);
});
it("adds stable independent mobile/surface IDs, associates without moving, removes only a mobile, preserves history", () => {
  const f = fixture(),
    created = { furnitureId: randomUUID(), surfaceId: randomUUID() },
    host = f.head.content.furniture[0]!.id;
  const r = prepareStoreLayoutEdit(
    f.head.storeId,
    {
      action: "ADD_MOBILE",
      expectedRevisionId: f.head.revisionId,
      label: "Mobile pommes",
      hostId: host,
      patch: { widthCm: 80, depthCm: 60 },
    },
    f.snapshot,
    created,
  );
  expect(r.status).toBe("READY");
  expect(r.after?.furniture).toHaveLength(20);
  expect(r.after?.surfaces.at(-1)?.id).toBe(created.surfaceId);
  expect(r.after?.furniture.at(-1)?.dimensions.width).toEqual({
    mm: 800,
    quality: "DECLARED",
  });
  expect(r.after?.furniture.at(-1)).toMatchObject({
    id: created.furnitureId,
    hostId: host,
    x: { mm: null },
  });
  f.head.content = r.after!;
  const assoc = prepareStoreLayoutEdit(
    f.head.storeId,
    {
      action: "ASSOCIATE_MOBILE",
      expectedRevisionId: f.head.revisionId,
      targetId: created.furnitureId,
      hostId: null,
    },
    f.snapshot,
  );
  expect(assoc.after?.furniture.at(-1)?.hostId).toBeNull();
  expect(assoc.after?.furniture.at(-1)?.x.mm).toBeNull();
  const removed = prepareStoreLayoutEdit(
    f.head.storeId,
    {
      action: "REMOVE_MOBILE",
      expectedRevisionId: f.head.revisionId,
      targetId: created.furnitureId,
    },
    f.snapshot,
  );
  expect(removed.after?.furniture).toHaveLength(19);
  expect(removed.after?.surfaces).toHaveLength(32);
  expect(f.head.content.furniture).toHaveLength(20);
  expect(
    prepareStoreLayoutEdit(
      f.head.storeId,
      {
        action: "REMOVE_MOBILE",
        expectedRevisionId: f.head.revisionId,
        targetId: host,
      },
      f.snapshot,
    ).status,
  ).toBe("BLOCKED");
});
it("edits a single selling surface without inferring floor footprint, stock or capacity", () => {
  const f = fixture(),
    s = f.head.content.surfaces[0]!,
    r = prepareStoreLayoutEdit(
      f.head.storeId,
      { ...f.input, targetId: s.id, patch: { depthCm: 40, maxLoadKg: 20 } },
      f.snapshot,
    );
  expect(r.status).toBe("READY");
  expect(r.after?.surfaces[0]).toMatchObject({
    dimensions: { depth: { mm: 400, quality: "DECLARED" } },
    maxLoadKg: 20,
  });
  expect(r.after?.furniture).toEqual(f.head.content.furniture);
  expect(r.after?.surfaces[1]).toEqual(f.head.content.surfaces[1]);
  expect(
    prepareStoreLayoutEdit(
      f.head.storeId,
      { ...f.input, targetId: s.id, patch: { xCm: 3 } },
      f.snapshot,
    ).status,
  ).toBe("BLOCKED");
});
it("shows impossible geometry without refusing a saveable draft, and supports zero coordinates but not zero dimensions", () => {
  const f = fixture();
  f.head.content = completeLayoutGeometry();
  const tg = f.head.content.furniture.find((x) => x.kind === "TG")!;
  const r = prepareStoreLayoutEdit(
    f.head.storeId,
    { ...f.input, targetId: tg.id, patch: { xCm: 0, yCm: 0, widthCm: 10000 } },
    f.snapshot,
  );
  expect(r.status).toBe("READY");
  expect(r.geometry?.status).toBe("BLOCKED");
  expect(r.after?.furniture.find((x) => x.id === tg.id)?.x).toEqual({
    mm: 0,
    quality: "DECLARED",
  });
  expect(
    prepareStoreLayoutEdit(
      f.head.storeId,
      { ...f.input, patch: { widthCm: 0 } },
      f.snapshot,
    ).status,
  ).toBe("BLOCKED");
});
it("strictly rejects invented authority, query, IDs and measured quality; unknown targets and absent/abandoned empty plans are explicit", () => {
  const f = fixture();
  for (const field of [
    "storeId",
    "ownerId",
    "query",
    "created",
    "measured",
    "canWrite",
  ])
    expect(
      copilotLayoutEditInputSchema.safeParse({
        ...f.input,
        [field]: randomUUID(),
      }).success,
    ).toBe(false);
  expect(
    copilotLayoutEditInputSchema.safeParse({
      ...f.input,
      patch: { widthCm: 12.34 },
    }).success,
  ).toBe(false);
  expect(
    prepareStoreLayoutEdit(
      f.head.storeId,
      { ...f.input, targetId: randomUUID() },
      f.snapshot,
    ).status,
  ).toBe("BLOCKED");
  expect(
    prepareStoreLayoutEdit(f.head.storeId, f.input, {
      head: null,
      reference: null,
    }).status,
  ).toBe("ABSENT");
  const bare = nextLayout(layoutFixture(f.head.storeId), {
    action: "DISCARD_DRAFT",
  });
  expect(
    prepareStoreLayoutEdit(
      f.head.storeId,
      { ...f.input, expectedRevisionId: bare.revisionId },
      { head: bare, reference: null },
    ).status,
  ).toBe("BLOCKED");
});
