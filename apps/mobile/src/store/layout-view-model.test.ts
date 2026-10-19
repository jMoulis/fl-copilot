import { randomUUID } from "node:crypto";
import { it, expect } from "vitest";
import {
  addStoreLayoutMobile,
  createPilotStoreLayout,
} from "@fl-copilot/commercial-core";
import {
  layoutFixture,
  nextLayout,
} from "../../../../scripts/test-store-layout-fixtures";
import {
  layoutDrawing,
  layoutViewport,
  layoutChanges,
  layoutMeasurementLabel,
  layoutNumber,
  parseLayoutMeasure,
  patchLayoutEdit,
  undoLayoutEdit,
  visibleLayout,
} from "./layout-view-model";
it("accepts the room origin and zero clearance without accepting zero-sized furniture or promoting unchanged reference coordinates", () => {
  const previous = { mm: 0, quality: "REFERENCE" as const };
  expect(parseLayoutMeasure("0", previous, false, true)).toEqual(previous);
  expect(
    parseLayoutMeasure("0", { mm: null, quality: "UNKNOWN" }, false, true),
  ).toEqual({ mm: 0, quality: "DECLARED" });
  expect(() => parseLayoutMeasure("0", previous, false)).toThrow();
  expect(() => parseLayoutMeasure("-1", previous, false, true)).toThrow();
});
it("includes a newly added mobile's host and exact qualified placement in the adoption comparison", () => {
  const c = createPilotStoreLayout(randomUUID),
    host = c.furniture[0]!;
  const next = addStoreLayoutMobile(c, randomUUID, "Mobile pommes", host.id),
    mobile = next.furniture.at(-1)!;
  mobile.x = { mm: 1200, quality: "DECLARED" };
  mobile.rotation = 90;
  const change = layoutChanges(c, next).find((v) => v.key === mobile.id)!;
  expect(change.after).toContain(host.label);
  expect(change.after).toContain("120 cm · déclaré");
  expect(change.after).toContain("orientation 90°");
  expect(change.after).toContain("mesures à préciser");
  expect(change.after).not.toContain(host.id);
});
it("renders all 19 principal elements without inventing surveyed module measurements", () => {
  const c = createPilotStoreLayout(randomUUID),
    snapshot = JSON.stringify(c),
    d = layoutDrawing(c);
  expect(d.groups).toHaveLength(2);
  expect(d.fixtures).toHaveLength(19);
  expect(d.fixtures.filter((f) => f.schematic)).toHaveLength(16);
  expect(new Set(d.fixtures.map((f) => f.id)).size).toBe(19);
  expect(d.width).toBe(11500);
  expect(d.height).toBe(8500);
  expect(JSON.stringify(c)).toBe(snapshot);
  expect(c.furniture[0]?.dimensions.width.mm).toBeNull();
});
it.each([0, 90, 180, 270] as const)(
  "keeps face and order identities through the assembly orientation %s",
  (rotation) => {
    const c = createPilotStoreLayout(randomUUID);
    c.assemblies[0]!.rotation = rotation;
    const d = layoutDrawing(c),
      group = d.groups[0]!;
    const children = d.fixtures.filter(
      (f) => c.furniture.find((x) => x.id === f.id)?.assemblyId === group.id,
    );
    expect(children).toHaveLength(8);
    for (const f of children) {
      expect(f.x).toBeGreaterThanOrEqual(group.x);
      expect(f.y).toBeGreaterThanOrEqual(group.y);
      expect(f.x + f.width).toBeLessThanOrEqual(group.x + group.width + 0.001);
      expect(f.y + f.height).toBeLessThanOrEqual(
        group.y + group.height + 0.001,
      );
    }
    const a = children.find((f) => f.label.includes("Face A · Élément 1"))!,
      b = children.find((f) => f.label.includes("Face B · Élément 1"))!;
    expect([a.x, a.y]).not.toEqual([b.x, b.y]);
  },
);
it("uses explicit furniture placement without replacing it with a group envelope, and retains room overflows in view", () => {
  const c = createPilotStoreLayout(randomUUID),
    f = c.furniture[0]!;
  Object.assign(f, {
    x: { mm: 12000, quality: "DECLARED" },
    y: { mm: 2000, quality: "DECLARED" },
    rotation: 90,
    dimensions: {
      width: { mm: 500, quality: "DECLARED" },
      depth: { mm: 800, quality: "DECLARED" },
      height: { mm: null, quality: "UNKNOWN" },
    },
  });
  const d = layoutDrawing(c),
    draw = d.fixtures.find((x) => x.id === f.id)!;
  expect(draw).toMatchObject({
    x: 12000,
    y: 2000,
    width: 800,
    height: 500,
    schematic: false,
  });
  expect(d.width).toBeGreaterThan(12800);
});
it("keeps optional hosted mobiles available for the front/list without treating their projected overlap as a collision", () => {
  const c = createPilotStoreLayout(randomUUID),
    host = c.furniture[0]!;
  c.furniture.push({
    ...host,
    id: randomUUID(),
    kind: "MOBILE",
    assemblyId: null,
    face: null,
    order: null,
    hostId: host.id,
    label: "Mobile de vente",
  });
  const drawing = layoutDrawing(c);
  expect(drawing.fixtures).toHaveLength(19);
  expect(c.furniture.filter((f) => f.hostId === host.id)).toHaveLength(1);
  const mobile = c.furniture.at(-1)!;
  mobile.hostId = null;
  expect(layoutDrawing(c).fixtures).toHaveLength(20);
});
it("limits viewport transformations without changing any furniture and returns to the complete view", () => {
  expect(layoutViewport({ scale: 9, x: 99, y: -99 })).toEqual({
    scale: 4,
    x: 1.5,
    y: -1.5,
  });
  expect(layoutViewport({ scale: 0, x: 1, y: 1 })).toEqual({
    scale: 1,
    x: 0,
    y: 0,
  });
  expect(layoutViewport({ scale: NaN, x: Infinity, y: NaN })).toEqual({
    scale: 1,
    x: 0,
    y: 0,
  });
});
it("parses French centimetres exactly, preserves unconfirmed reference values and qualifies explicit field changes", () => {
  const old = { mm: 450, quality: "REFERENCE" as const };
  expect(layoutNumber(old)).toBe("45");
  expect(parseLayoutMeasure("45,0", old, false)).toEqual(old);
  expect(parseLayoutMeasure("45,1", old, false)).toEqual({
    mm: 451,
    quality: "DECLARED",
  });
  expect(parseLayoutMeasure("45", old, true)).toEqual({
    mm: 450,
    quality: "MEASURED",
  });
  expect(parseLayoutMeasure("", old, true)).toEqual({
    mm: null,
    quality: "UNKNOWN",
  });
  expect(layoutMeasurementLabel(old)).toContain("à confirmer");
  expect(layoutMeasurementLabel({ mm: null, quality: "UNKNOWN" })).toBe(
    "À préciser",
  );
});
it.each(["0", "-3", "2.35", "2e3", "Infinity", "5,2,3", "10000,1"])(
  "rejects a measurement instead of guessing from %s",
  (text) => {
    expect(() =>
      parseLayoutMeasure(text, { mm: null, quality: "UNKNOWN" }, false),
    ).toThrow();
  },
);
it("keeps pending edit content anchored to its original revision across a background update and supports bounded undo/cancellation", () => {
  const head = layoutFixture(),
    original = head.content,
    edit = { baseRevisionId: head.revisionId, content: original, undo: [] };
  const c = {
      ...original,
      room: {
        ...original.room,
        width: { mm: 12000, quality: "DECLARED" as const },
      },
    },
    changed = patchLayoutEdit(edit, c),
    remote = nextLayout(head);
  expect(changed.baseRevisionId).not.toBe(remote.revisionId);
  expect(changed.content).toEqual(c);
  expect(original.room.width.mm).toBe(11500);
  expect(undoLayoutEdit(changed)).toEqual(edit);
  expect(patchLayoutEdit(edit, original)).toBe(edit);
});
it("compares qualifications and physical fields while remaining independent of array order", () => {
  const p = createPilotStoreLayout(randomUUID),
    next = structuredClone(p);
  next.surfaces[1]!.dimensions.depth = { mm: 450, quality: "MEASURED" };
  const diff = layoutChanges(p, next);
  expect(diff).toHaveLength(1);
  expect(diff[0]?.before).toContain("à confirmer");
  expect(diff[0]?.after).toContain("relevé sur place");
  next.surfaces.reverse();
  expect(layoutChanges(p, next)).toEqual(diff);
});
it("shows the adopted reference after discarding a saved draft, without presenting its abandoned geometry as active", () => {
  const p = layoutFixture(),
    id = randomUUID(),
    reference = nextLayout(p, {
      action: "ADOPT_REFERENCE",
      revisionId: id,
      referenceRevisionId: id,
    }),
    draft = nextLayout(reference),
    discard = nextLayout(draft, { action: "DISCARD_DRAFT" });
  expect(visibleLayout(draft, reference)).toEqual(draft);
  expect(visibleLayout(discard, reference)).toEqual(reference);
  expect(
    visibleLayout({ ...discard, referenceRevisionId: null }, null),
  ).toBeNull();
});
