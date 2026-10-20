import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { addStoreLayoutMobile } from "@fl-copilot/commercial-core";
import { completeLayoutGeometry } from "../../../../scripts/test-store-layout-fixtures";
import {
  dragStoreLayoutObject,
  layoutDragHit,
  layoutMapPoint,
  type LayoutMapFrame,
} from "./layout-drag";
import {
  layoutDrawing,
  patchLayoutEdit,
  undoLayoutEdit,
  type LayoutViewport,
} from "./layout-view-model";
const frame: LayoutMapFrame = {
  width: 390,
  height: 350,
  factor: 0.02,
  ox: 10,
  oy: 20,
};
const viewport: LayoutViewport = { scale: 2, x: 0.2, y: -0.2 };
it.each([1, 2, 4])(
  "maps a selected target correctly after centre-based zoom %s and panning",
  (scale) => {
    const v = { ...viewport, scale },
      x = 1500,
      y = 2400;
    const sx =
      frame.width / 2 +
      (frame.ox + x * frame.factor - frame.width / 2) * scale +
      v.x * frame.width;
    const sy =
      frame.height / 2 +
      (frame.oy + y * frame.factor - frame.height / 2) * scale +
      v.y * frame.height;
    const point = layoutMapPoint(frame, v, sx, sy);
    expect(point.x).toBeCloseTo(x);
    expect(point.y).toBeCloseTo(y);
    const rectangles = [
      {
        id: "selected",
        label: "Selected",
        x: 1000,
        y: 2000,
        width: 1000,
        height: 1000,
        schematic: false,
        kind: "TG" as const,
      },
    ];
    expect(layoutDragHit(rectangles, "selected", frame, v, sx, sy)).toBe(true);
    expect(layoutDragHit(rectangles, "other", frame, v, sx, sy)).toBe(false);
    expect(layoutDragHit(rectangles, "selected", frame, v, sx + 3000, sy)).toBe(
      false,
    );
  },
);
it("translates from recorded positions at the current zoom, moves a hosted mobile once and leaves dimensions, other furniture and source untouched", () => {
  let c = completeLayoutGeometry();
  const host = c.furniture[0]!;
  c = addStoreLayoutMobile(c, randomUUID, "Mobile", host.id);
  const mobile = c.furniture.at(-1)!;
  mobile.x = { mm: host.x.mm! + 10, quality: "MEASURED" };
  mobile.y = { mm: host.y.mm! + 20, quality: "MEASURED" };
  const original = JSON.stringify(c),
    after = dragStoreLayoutObject(c, host.id, 20, 0, frame, viewport);
  const target = after.furniture.find((v) => v.id === host.id)!;
  expect(target.x).toEqual({ mm: host.x.mm! + 500, quality: "DECLARED" });
  expect(target.y).toEqual(host.y);
  expect(target.dimensions).toEqual(host.dimensions);
  expect(target.rotation).toBe(host.rotation);
  expect(after.furniture.at(-1)!.x).toEqual({
    mm: mobile.x.mm! + 500,
    quality: "DECLARED",
  });
  expect(after.furniture.at(-1)!.hostId).toBe(host.id);
  expect(after.furniture[1]).toEqual(c.furniture[1]);
  expect(after.surfaces).toEqual(c.surfaces);
  expect(JSON.stringify(c)).toBe(original);
});
it("keeps successive island previews relative to one starting snapshot and creates one undo step only on application", () => {
  const c = completeLayoutGeometry(),
    a = c.assemblies[0]!;
  const first = dragStoreLayoutObject(c, a.id, 10, 12, frame, viewport),
    last = dragStoreLayoutObject(c, a.id, 20, 24, frame, viewport);
  expect(first.assemblies[0]!.x.mm).toBe(a.x.mm! + 250);
  expect(last.assemblies[0]!.x.mm).toBe(a.x.mm! + 500);
  for (const f of c.furniture.filter((v) => v.assemblyId === a.id))
    expect(last.furniture.find((v) => v.id === f.id)!.x.mm).toBe(f.x.mm! + 500);
  const edit = { baseRevisionId: randomUUID(), content: c, undo: [] };
  expect(edit.undo).toHaveLength(0);
  const changed = patchLayoutEdit(edit, last);
  expect(changed.undo).toHaveLength(1);
  expect(undoLayoutEdit(changed)).toEqual(edit);
  expect(dragStoreLayoutObject(c, a.id, 0.001, 0.001, frame, viewport)).toBe(c);
});
it("never saves drawing fallbacks or invents an unknown child position, even when its schematic box is selectable", () => {
  const c = completeLayoutGeometry(),
    f = c.furniture[0]!;
  f.x = { mm: null, quality: "UNKNOWN" };
  expect(layoutDrawing(c).fixtures.find((v) => v.id === f.id)!.schematic).toBe(
    true,
  );
  expect(() => dragStoreLayoutObject(c, f.id, 20, 20, frame, viewport)).toThrow(
    "Précisez d’abord",
  );
  const after = dragStoreLayoutObject(
    c,
    f.assemblyId!,
    20,
    20,
    frame,
    viewport,
  );
  expect(after.furniture.find((v) => v.id === f.id)!.x.mm).toBeNull();
  expect(f.x.mm).toBeNull();
});
it("rejects invalid frames, stale targets, nonfinite deltas and out-of-range positions atomically instead of clamping them", () => {
  const c = completeLayoutGeometry(),
    id = c.furniture[0]!.id,
    original = JSON.stringify(c);
  for (const f of [
    { ...frame, factor: 0 },
    { ...frame, width: NaN },
  ])
    expect(() => dragStoreLayoutObject(c, id, 20, 20, f, viewport)).toThrow();
  expect(() =>
    dragStoreLayoutObject(c, id, 20, 20, frame, { ...viewport, scale: 0 }),
  ).toThrow();
  for (const delta of [NaN, Infinity, -100000, 100000])
    expect(() =>
      dragStoreLayoutObject(c, id, delta, 0, frame, viewport),
    ).toThrow();
  expect(() =>
    dragStoreLayoutObject(c, randomUUID(), 10, 10, frame, viewport),
  ).toThrow("Choisissez");
  expect(JSON.stringify(c)).toBe(original);
});
