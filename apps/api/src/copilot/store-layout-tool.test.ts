import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { expect, it, vi } from "vitest";
import {
  layoutFixture,
  nextLayout,
} from "../../../../scripts/test-store-layout-fixtures";
import { copilotStoreLayoutInputSchema } from "@fl-copilot/domain";
import { addStoreLayoutMobile } from "@fl-copilot/commercial-core";
import {
  presentCopilotStoreLayout,
  readCopilotStoreLayoutSnapshot,
} from "./store-layout-tool";
import { readActivityStage } from "./read-activity";
import { renderAnswerText } from "./answer-text";
import { factReadFromTool } from "./fact-context";
const input = {
  view: "REFERENCE" as const,
  expectedRevisionId: null,
  targetId: null,
  cursor: null,
  limit: 20,
};
function fixture() {
  const first = layoutFixture(),
    revisionId = randomUUID(),
    reference = nextLayout(first, {
      revisionId,
      referenceRevisionId: revisionId,
      action: "ADOPT_REFERENCE",
    });
  return { first, reference, snapshot: { head: reference, reference } };
}
it("returns the adopted pilot inventory, qualified dimensions and independent surface counts without actor metadata", () => {
  const { reference, snapshot } = fixture(),
    r = presentCopilotStoreLayout(reference.storeId, input, snapshot);
  expect(r.status).toBe("READY");
  expect(r.items).toHaveLength(19);
  expect(r.assemblies).toHaveLength(2);
  expect(r.geometry?.counts).toMatchObject({
    fixed: 16,
    tg: 3,
    mobiles: 0,
    furniture: 19,
    surfaces: 32,
    located: 3,
  });
  expect(r.geometry?.status).toBe("INCOMPLETE");
  expect(r.geometry?.issuesTruncated).toBe(true);
  expect(r.surfaces.filter((s) => s.count === 2)).toHaveLength(16);
  expect(r.evidence[1]?.value).toContain("référence à confirmer");
  expect(
    r.evidence.every(
      (e) =>
        e.sourceId === reference.revisionId &&
        e.sourceVersion === reference.version,
    ),
  ).toBe(true);
  expect(JSON.stringify(r)).not.toContain("updatedBy");
  expect(JSON.stringify(r)).not.toContain(reference.updatedBy);
});
it("does not replace an adopted reference with a newer draft or revive an abandoned one", () => {
  const { reference } = fixture(),
    draft = nextLayout(reference);
  draft.content.furniture[0]!.label =
    "Meuble déplacé seulement dans le brouillon";
  const ref = presentCopilotStoreLayout(reference.storeId, input, {
    head: draft,
    reference,
  });
  expect(ref.selected?.revisionId).toBe(reference.revisionId);
  expect(JSON.stringify(ref)).not.toContain(draft.content.furniture[0]!.label);
  const readDraft = presentCopilotStoreLayout(
    reference.storeId,
    { ...input, view: "DRAFT" },
    { head: draft, reference },
  );
  expect(readDraft.selected?.revisionId).toBe(draft.revisionId);
  expect(readDraft.evidence[0]?.value).toContain("Brouillon non adopté");
  const abandoned = nextLayout(draft, { action: "DISCARD_DRAFT" });
  expect(
    presentCopilotStoreLayout(
      reference.storeId,
      { ...input, view: "DRAFT" },
      { head: abandoned, reference },
    ).status,
  ).toBe("NO_DRAFT");
  expect(
    presentCopilotStoreLayout(reference.storeId, input, {
      head: abandoned,
      reference,
    }).selected?.revisionId,
  ).toBe(reference.revisionId);
});
it("keeps absence distinct from zero inventory and does not expose unadopted furniture in the default read", () => {
  const { first } = fixture();
  expect(
    presentCopilotStoreLayout(first.storeId, input, {
      head: null,
      reference: null,
    }),
  ).toMatchObject({ status: "ABSENT", geometry: null, room: null, items: [] });
  const r = presentCopilotStoreLayout(first.storeId, input, {
    head: first,
    reference: null,
  });
  expect(r.status).toBe("NO_REFERENCE");
  expect(r.geometry).toBeNull();
  expect(r.items).toEqual([]);
  expect(r.head?.draftAvailable).toBe(true);
  expect(r.evidence).toHaveLength(1);
});
it("drills into exact assemblies, fixed surfaces and optional hosted mobiles without duplicating their identities", () => {
  const { reference } = fixture();
  reference.content = addStoreLayoutMobile(
    reference.content,
    randomUUID,
    "Mobile pommes",
    reference.content.furniture[0]!.id,
  );
  const snapshot = { head: reference, reference },
    group = reference.content.assemblies[0]!;
  const assembly = presentCopilotStoreLayout(
    reference.storeId,
    { ...input, targetId: group.id },
    snapshot,
  );
  expect(assembly.target?.type).toBe("ASSEMBLY");
  expect(assembly.items).toHaveLength(8);
  const fixed = reference.content.furniture[0]!,
    details = presentCopilotStoreLayout(
      reference.storeId,
      { ...input, targetId: fixed.id },
      snapshot,
    );
  expect(details.items.filter((i) => i.type === "SURFACE")).toHaveLength(2);
  expect(details.items.filter((i) => i.type === "FURNITURE")).toHaveLength(1);
  const surface = reference.content.surfaces.find(
    (s) => s.furnitureId === fixed.id,
  )!;
  const exact = presentCopilotStoreLayout(
    reference.storeId,
    { ...input, targetId: surface.id },
    snapshot,
  );
  expect(exact.target).toEqual({ type: "SURFACE", entity: surface });
  expect(exact.items).toEqual([]);
  expect(exact.evidence.at(-1)?.value).toContain(fixed.label);
});
it("paginates one immutable selection without omission, duplicates or silently following a changed revision", () => {
  const { reference, snapshot } = fixture();
  const first = presentCopilotStoreLayout(
    reference.storeId,
    { ...input, limit: 7 },
    snapshot,
  );
  const nextInput = {
    ...input,
    limit: 7,
    expectedRevisionId: reference.revisionId,
    cursor: first.nextCursor,
  };
  const second = presentCopilotStoreLayout(
    reference.storeId,
    nextInput,
    snapshot,
  );
  const third = presentCopilotStoreLayout(
    reference.storeId,
    { ...nextInput, cursor: second.nextCursor },
    snapshot,
  );
  expect(
    new Set(
      [...first.items, ...second.items, ...third.items].map((i) => i.entity.id),
    ).size,
  ).toBe(19);
  expect(third.nextCursor).toBeNull();
  const next = nextLayout(reference),
    id = randomUUID(),
    newer = nextLayout(next, {
      action: "ADOPT_REFERENCE",
      revisionId: id,
      referenceRevisionId: id,
    });
  const stale = presentCopilotStoreLayout(reference.storeId, nextInput, {
    head: newer,
    reference: newer,
  });
  expect(stale.status).toBe("STALE");
  expect(stale.items).toEqual([]);
  expect(stale.geometry).toBeNull();
  expect(
    presentCopilotStoreLayout(
      reference.storeId,
      { ...nextInput, cursor: randomUUID() },
      snapshot,
    ).status,
  ).toBe("CURSOR_INVALID");
});
it("rejects unpinned cursors, unknown authority/query fields and excessive page sizes", () => {
  for (const patch of [
    { cursor: randomUUID() },
    { storeId: randomUUID() },
    { query: {} },
    { limit: 21 },
    { write: true },
  ])
    expect(
      copilotStoreLayoutInputSchema.safeParse({ ...input, ...patch }).success,
    ).toBe(false);
});
it("refuses foreign or contradictory snapshots before returning any private plan data", () => {
  const { reference, snapshot } = fixture();
  expect(() =>
    presentCopilotStoreLayout(randomUUID(), input, snapshot),
  ).toThrow(/SCOPE/);
  expect(() =>
    presentCopilotStoreLayout(reference.storeId, input, {
      head: reference,
      reference: fixture().reference,
    }),
  ).toThrow(/SCOPE/);
  const forged = structuredClone(reference);
  forged.content.furniture[0]!.label =
    "Snapshot changé sous une identité immuable";
  expect(() =>
    presentCopilotStoreLayout(reference.storeId, input, {
      head: reference,
      reference: forged,
    }),
  ).toThrow(/REFERENCE/);
  expect(() =>
    presentCopilotStoreLayout(reference.storeId, input, {
      ...snapshot,
      evidence: [],
    }),
  ).toThrow();
  const missing = presentCopilotStoreLayout(
    reference.storeId,
    { ...input, targetId: randomUUID() },
    snapshot,
  );
  expect(missing.status).toBe("TARGET_NOT_FOUND");
  expect(missing.target).toBeNull();
  expect(missing.items).toEqual([]);
});
it("preserves zero coordinates and unknown versus declared measurements in human source links", () => {
  const { reference } = fixture(),
    tg = reference.content.furniture.find((f) => f.kind === "TG")!;
  tg.x = { mm: 0, quality: "DECLARED" };
  tg.y = { mm: null, quality: "UNKNOWN" };
  const r = presentCopilotStoreLayout(
    reference.storeId,
    { ...input, targetId: tg.id },
    { head: reference, reference },
  );
  const e = r.evidence.at(-1)!;
  expect(e.value).toContain("0 cm (déclaré)");
  expect(e.value).toContain("depuis le haut inconnu");
  const text = renderAnswerText(
    "{{value:0}} {{source:0}}",
    [{ evidenceId: e.id }],
    r.evidence,
  );
  expect(text).toContain("0 cm (déclaré)");
  expect(text).toContain("copilot-source:");
  expect(readActivityStage(JSON.stringify(["store-layout", input]))).toBe(
    "CONTEXT",
  );
  expect(
    factReadFromTool(JSON.stringify(["store-layout", input]), r),
  ).toBeNull();
});
it("rejects a reference changing during the historical lookup and keeps every query store-scoped", async () => {
  const { reference } = fixture(),
    head = nextLayout(reference),
    changed = nextLayout(head);
  const headFind = vi
    .fn()
    .mockResolvedValueOnce({ ...head, _id: head.id })
    .mockResolvedValueOnce({ revisionId: changed.revisionId });
  const historyFind = vi.fn().mockResolvedValue({
    _id: reference.revisionId,
    id: reference.revisionId,
    storeId: reference.storeId,
    plan: reference,
    version: 1,
  });
  const db = {
    collection: (name: string) => ({
      findOne: name === "storeLayouts" ? headFind : historyFind,
    }),
  } as unknown as Db;
  await expect(
    readCopilotStoreLayoutSnapshot(db, head.storeId),
  ).rejects.toThrow("STORE_LAYOUT_SOURCE_CHANGED");
  expect(headFind.mock.calls[0]?.[0]).toEqual({
    _id: head.storeId,
    storeId: head.storeId,
  });
  expect(historyFind.mock.calls[0]?.[0]).toEqual({
    _id: reference.revisionId,
    storeId: head.storeId,
  });
});
it("returns no invented reference when its immutable synchronized snapshot is unavailable", async () => {
  const { reference } = fixture(),
    head = nextLayout(reference);
  const db = {
    collection: (name: string) => ({
      findOne: vi.fn(async () =>
        name === "storeLayouts" ? { ...head, _id: head.id } : null,
      ),
    }),
  } as unknown as Db;
  await expect(
    readCopilotStoreLayoutSnapshot(db, head.storeId),
  ).rejects.toThrow("STORE_LAYOUT_REFERENCE_UNAVAILABLE");
});
