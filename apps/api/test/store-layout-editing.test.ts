import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { StoreLayoutContent } from "@fl-copilot/domain";
import { createPilotStoreLayout } from "@fl-copilot/commercial-core";
import {
  addStoreLayoutMobile,
  associateStoreLayoutMobile,
  placeStoreLayoutObject,
  removeStoreLayoutMobile,
} from "@fl-copilot/commercial-core";
const d = (mm: number) => ({ mm, quality: "DECLARED" as const });
function positioned() {
  let c = createPilotStoreLayout(randomUUID);
  const a = c.assemblies[0]!,
    f = c.furniture[0]!;
  Object.assign(f, {
    x: d(2100),
    y: d(1900),
    rotation: 0,
    dimensions: { width: d(700), depth: d(900), height: d(1200) },
  });
  c = addStoreLayoutMobile(c, randomUUID, "Mobile A1", f.id);
  Object.assign(c.furniture.at(-1)!, {
    x: d(2200),
    y: d(2000),
    rotation: 0,
    dimensions: { width: d(500), depth: d(600), height: d(500) },
  });
  return {
    c,
    a: c.assemblies.find((o) => o.id === a.id)!,
    f: c.furniture.find((o) => o.id === f.id)!,
    m: c.furniture.at(-1)!,
  };
}
it("adds only one explicit mobile and one independent unknown selling surface, without changing the pilot", () => {
  const c = createPilotStoreLayout(randomUUID),
    frozen = JSON.stringify(c);
  const next = addStoreLayoutMobile(
      c,
      randomUUID,
      "Mobile légumes",
      c.furniture[0]!.id,
    ),
    m = next.furniture.at(-1)!;
  expect(next.furniture).toHaveLength(20);
  expect(next.surfaces).toHaveLength(33);
  expect(
    new Set([...next.furniture, ...next.surfaces].map((o) => o.id)).size,
  ).toBe(53);
  expect(m).toMatchObject({
    kind: "MOBILE",
    hostId: c.furniture[0]!.id,
    x: { mm: null, quality: "UNKNOWN" },
    rotation: null,
  });
  expect(Object.values(m.dimensions).every((v) => v.mm === null)).toBe(true);
  expect(next.surfaces.at(-1)).toMatchObject({
    furnitureId: m.id,
    kind: "MOBILE_DISPLAY",
    maxLoadKg: null,
  });
  expect(JSON.stringify(c)).toBe(frozen);
});
it("reassociates or detaches an existing mobile without relocating it, changing its surfaces or assuming fit", () => {
  const { c, m } = positioned(),
    target = c.furniture.find((f) => f.kind === "TG")!;
  const next = associateStoreLayoutMobile(c, m.id, target.id);
  expect(next.furniture.at(-1)).toEqual({ ...m, hostId: target.id });
  expect(next.surfaces).toEqual(c.surfaces);
  expect(
    associateStoreLayoutMobile(next, m.id, null).furniture.at(-1)?.hostId,
  ).toBeNull();
  expect(() => associateStoreLayoutMobile(c, m.id, m.id)).toThrow();
  expect(() => associateStoreLayoutMobile(c, m.id, randomUUID())).toThrow();
  expect(() => associateStoreLayoutMobile(c, target.id, null)).toThrow();
});
it("removes the mobile and only its own surface, retaining every principal element and original snapshot", () => {
  const { c, m } = positioned(),
    original = JSON.stringify(c);
  const next = removeStoreLayoutMobile(c, m.id);
  expect(next.furniture).toHaveLength(19);
  expect(next.surfaces).toHaveLength(32);
  expect(next.furniture).toEqual(c.furniture.filter((f) => f.id !== m.id));
  expect(JSON.stringify(c)).toBe(original);
  expect(() => removeStoreLayoutMobile(c, c.furniture[0]!.id)).toThrow();
});
it("translates the assembly's measured children and hosted mobiles exactly once, preserving unknown positions, A/B, surface identities and other groups", () => {
  const { c, a, f, m } = positioned(),
    old = JSON.stringify(c);
  const next = placeStoreLayoutObject(c, "ASSEMBLY", a.id, {
    x: d(2500),
    y: d(2000),
    rotation: 0,
  });
  expect(next.furniture.find((o) => o.id === f.id)).toMatchObject({
    x: d(2600),
    y: d(2200),
    face: f.face,
    order: f.order,
  });
  expect(next.furniture.find((o) => o.id === m.id)).toMatchObject({
    x: d(2700),
    y: d(2300),
  });
  expect(next.furniture[1]).toEqual(c.furniture[1]);
  expect(next.furniture.find((o) => o.kind === "TG")).toEqual(
    c.furniture.find((o) => o.kind === "TG"),
  );
  expect(next.surfaces).toEqual(c.surfaces);
  expect(JSON.stringify(c)).toBe(old);
});
it.each([
  [90, 5000, 1800, 5200, 1900],
  [180, 2970, 4700, 3070, 4900],
  [270, 2200, 2670, 2300, 2770],
] as const)(
  "rotates the entire located hierarchy %s° without swapping face identity",
  (rotation, fx, fy, mx, my) => {
    const { c, a, f, m } = positioned();
    const next = placeStoreLayoutObject(c, "ASSEMBLY", a.id, {
      x: a.x,
      y: a.y,
      rotation,
    });
    expect(next.furniture.find((o) => o.id === f.id)).toMatchObject({
      x: d(fx),
      y: d(fy),
      rotation,
      face: "A",
      order: 1,
    });
    expect(next.furniture.find((o) => o.id === m.id)).toMatchObject({
      x: d(mx),
      y: d(my),
      rotation,
    });
    expect(next.surfaces).toEqual(c.surfaces);
  },
);
it("returns to the same coordinates after four quarter turns including already rotated footprints", () => {
  const { c, a } = positioned();
  let current = c;
  for (const rotation of [90, 180, 270, 0] as const)
    current = placeStoreLayoutObject(current, "ASSEMBLY", a.id, {
      x: a.x,
      y: a.y,
      rotation,
    });
  expect(current).toEqual(c);
});
it("refuses ambiguous rotation atomically while allowing translation of a partially known coordinate", () => {
  const { c, a, f } = positioned();
  f.y = { mm: null, quality: "UNKNOWN" };
  const before = JSON.stringify(c);
  expect(() =>
    placeStoreLayoutObject(c, "ASSEMBLY", a.id, {
      x: a.x,
      y: a.y,
      rotation: 90,
    }),
  ).toThrow(/Complétez/);
  expect(JSON.stringify(c)).toBe(before);
  const moved = placeStoreLayoutObject(c, "ASSEMBLY", a.id, {
    x: d(2500),
    y: a.y,
    rotation: 0,
  });
  expect(moved.furniture.find((o) => o.id === f.id)).toMatchObject({
    x: d(2600),
    y: { mm: null, quality: "UNKNOWN" },
  });
});
it("rejects erasing a known host origin with located descendants, negative transformed placement and nonexistent targets", () => {
  const { c, a, f } = positioned();
  expect(() =>
    placeStoreLayoutObject(c, "ASSEMBLY", a.id, {
      x: { mm: null, quality: "UNKNOWN" },
      y: a.y,
      rotation: 0,
    }),
  ).toThrow(/repère/);
  c.furniture.find((o) => o.id === f.id)!.x = d(100);
  expect(() =>
    placeStoreLayoutObject(c, "ASSEMBLY", a.id, {
      x: d(0),
      y: a.y,
      rotation: 0,
    }),
  ).toThrow(/positif/);
  expect(() =>
    placeStoreLayoutObject(c, "FURNITURE", randomUUID(), {
      x: a.x,
      y: a.y,
      rotation: 0,
    }),
  ).toThrow(/introuvable/);
});
it("moves a TG with its actual associated mobile but leaves other fixtures untouched", () => {
  let c = createPilotStoreLayout(randomUUID);
  const tg = c.furniture.find((f) => f.kind === "TG")!;
  c = addStoreLayoutMobile(c, randomUUID, "Mobile TG", tg.id);
  const m = c.furniture.at(-1)!;
  m.x = d(2100);
  m.y = d(900);
  const next = placeStoreLayoutObject(c, "FURNITURE", tg.id, {
    x: d(2200),
    y: d(1070),
    rotation: 0,
  });
  expect(next.furniture.at(-1)).toMatchObject({
    x: d(2300),
    y: d(1100),
    rotation: null,
  });
  expect(next.assemblies).toEqual(c.assemblies);
  expect(next.furniture[0]).toEqual(c.furniture[0]);
});
it("allows deliberately incomplete placements without turning schematic slots into measurements", () => {
  const c = createPilotStoreLayout(randomUUID),
    a = c.assemblies[0]!;
  const next = placeStoreLayoutObject(c, "ASSEMBLY", a.id, {
    x: a.x,
    y: a.y,
    rotation: 90,
  });
  expect(next.furniture).toEqual(c.furniture);
  expect(next.surfaces).toEqual(c.surfaces);
});
it("rotates a known child orientation even when its coordinates remain unknown", () => {
  const c = createPilotStoreLayout(randomUUID),
    a = c.assemblies[0]!,
    f = c.furniture[0]!;
  f.rotation = 270;
  const next = placeStoreLayoutObject(c, "ASSEMBLY", a.id, {
    x: a.x,
    y: a.y,
    rotation: 90,
  });
  expect(next.furniture[0]).toEqual({ ...f, rotation: 0 });
  expect(next.furniture[0]?.x.mm).toBeNull();
  expect(next.furniture[0]?.y.mm).toBeNull();
});
it("translates a known position without inventing an unknown orientation", () => {
  const { c, a, f } = positioned();
  a.rotation = null;
  const next = placeStoreLayoutObject(c, "ASSEMBLY", a.id, {
    x: d(2500),
    y: a.y,
    rotation: null,
  });
  expect(next.assemblies[0]?.rotation).toBeNull();
  expect(next.furniture.find((o) => o.id === f.id)?.x).toEqual(d(2600));
  expect(() =>
    placeStoreLayoutObject(c, "ASSEMBLY", a.id, {
      x: a.x,
      y: a.y,
      rotation: 90,
    }),
  ).toThrow(/repère/);
});
it("enforces shared capacity and identity limits rather than silently truncating mobiles", () => {
  let c: StoreLayoutContent = createPilotStoreLayout(randomUUID);
  for (let i = c.furniture.length; i < 128; i++)
    c = addStoreLayoutMobile(c, randomUUID, `Mobile ${i}`, null);
  expect(() => addStoreLayoutMobile(c, randomUUID, "De trop", null)).toThrow();
  expect(c.furniture).toHaveLength(128);
  expect(() =>
    addStoreLayoutMobile(
      createPilotStoreLayout(randomUUID),
      () => c.furniture[0]!.id,
      "Collision",
      null,
    ),
  ).toThrow();
});
