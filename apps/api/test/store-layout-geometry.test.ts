import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { storeLayoutGeometrySchema } from "@fl-copilot/domain";
import {
  addStoreLayoutMobile,
  assertStoreLayoutAdoptable,
  checkStoreLayoutGeometry,
  createPilotStoreLayout,
} from "@fl-copilot/commercial-core";
import { completeLayoutGeometry } from "../../../scripts/test-store-layout-fixtures";
const d = (mm: number) => ({ mm, quality: "DECLARED" as const });
function mobileFixture() {
  let c = completeLayoutGeometry();
  const host = c.furniture[0]!;
  host.clearanceBelow = d(600);
  c = addStoreLayoutMobile(c, randomUUID, "Mobile pommes", host.id);
  const m = c.furniture.at(-1)!;
  Object.assign(m, {
    x: d(2100),
    y: d(1800),
    rotation: 0,
    dimensions: { width: d(500), depth: d(600), height: d(500) },
  });
  return { c, host: c.furniture[0]!, m };
}
it("checks the complete 19-object inventory without counting group envelopes or sales surfaces as extra furniture", () => {
  const c = completeLayoutGeometry(),
    snapshot = JSON.stringify(c),
    r = checkStoreLayoutGeometry(c);
  expect(r.status).toBe("CHECKED");
  expect(r.authority).toBe("PROVISIONAL");
  expect(r.issues).toEqual([]);
  expect(r.counts).toEqual({
    assemblies: 2,
    fixed: 16,
    tg: 3,
    mobiles: 0,
    furniture: 19,
    located: 19,
  });
  expect(r.footprints).toHaveLength(21);
  expect(JSON.stringify(c)).toBe(snapshot);
  expect(c.surfaces.every((s) => s.dimensions.width.mm === null)).toBe(true);
});
it("never substitutes drawing slots for unknown fixed-element geometry or promotes reference measures", () => {
  const c = createPilotStoreLayout(randomUUID),
    r = checkStoreLayoutGeometry(c);
  expect(r.status).toBe("INCOMPLETE");
  expect(r.counts.located).toBe(3);
  expect(r.footprints).toHaveLength(5);
  expect(r.issues.filter((i) => i.code === "MISSING_GEOMETRY")).toHaveLength(
    16,
  );
  expect(
    r.issues.some(
      (i) => i.code === "REFERENCE_UNCONFIRMED" && i.targets.includes("room"),
    ),
  ).toBe(true);
  expect(() => assertStoreLayoutAdoptable(c)).not.toThrow();
});
it.each([90, 180, 270] as const)(
  "uses absolute rotated footprints at %s°",
  (rotation) => {
    const c = completeLayoutGeometry(),
      f = c.furniture.find((f) => f.kind === "TG")!;
    f.rotation = rotation;
    const box = checkStoreLayoutGeometry(c).footprints.find(
      (b) => b.id === f.id,
    )!;
    expect([box.width, box.depth]).toEqual(
      rotation === 180 ? [1770, 830] : [830, 1770],
    );
    expect([box.x, box.y]).toEqual([f.x.mm, f.y.mm]);
  },
);
it("allows edge contact but detects even a one millimetre physical overlap", () => {
  const c = completeLayoutGeometry(),
    f = c.furniture.find((f) => f.kind === "TG")!;
  expect(
    checkStoreLayoutGeometry(c).issues.some((i) => i.code === "COLLISION"),
  ).toBe(false);
  f.y = d(f.y.mm! + 1);
  const r = checkStoreLayoutGeometry(c);
  expect(r.status).toBe("BLOCKED");
  expect(r.issues.filter((i) => i.code === "COLLISION")).toHaveLength(2);
  expect(() => assertStoreLayoutAdoptable(c)).toThrow(
    "STORE_LAYOUT_GEOMETRY_BLOCKED",
  );
});
it("preserves zero origins and rejects known room overflow even with incomplete placement", () => {
  const c = completeLayoutGeometry(),
    f = c.furniture.find((f) => f.kind === "TG")!;
  f.x = d(0);
  f.y = d(0);
  expect(
    checkStoreLayoutGeometry(c).issues.some((i) => i.code === "OUT_OF_BOUNDS"),
  ).toBe(false);
  f.x = { mm: null, quality: "UNKNOWN" };
  f.rotation = null;
  f.dimensions.width = d(13000);
  f.dimensions.depth = d(14000);
  expect(
    checkStoreLayoutGeometry(c).issues.some(
      (i) => i.code === "OUT_OF_BOUNDS" && i.targets.includes(f.id),
    ),
  ).toBe(true);
  f.dimensions.depth = d(100);
  expect(
    checkStoreLayoutGeometry(c).issues.some(
      (i) => i.code === "OUT_OF_BOUNDS" && i.targets.includes(f.id),
    ),
  ).toBe(false);
  f.x = d(11500);
  f.dimensions.width = { mm: null, quality: "UNKNOWN" };
  expect(
    checkStoreLayoutGeometry(c).issues.some(
      (i) => i.code === "OUT_OF_BOUNDS" && i.targets.includes(f.id),
    ),
  ).toBe(true);
});
it("checks known fixed placement against its island without requiring unknown stock, height or shelf loads", () => {
  const c = completeLayoutGeometry(),
    f = c.furniture[0]!;
  f.x = d(1900);
  const r = checkStoreLayoutGeometry(c);
  expect(
    r.issues.some(
      (i) => i.code === "OUTSIDE_ASSEMBLY" && i.targets.includes(f.id),
    ),
  ).toBe(true);
  f.dimensions.width = { mm: null, quality: "UNKNOWN" };
  expect(
    checkStoreLayoutGeometry(c).issues.some(
      (i) => i.code === "OUTSIDE_ASSEMBLY" && i.targets.includes(f.id),
    ),
  ).toBe(true);
  f.x = { mm: null, quality: "UNKNOWN" };
  f.rotation = null;
  f.dimensions.width = d(10000);
  f.dimensions.depth = d(11000);
  expect(
    checkStoreLayoutGeometry(c).issues.some(
      (i) => i.code === "OUTSIDE_ASSEMBLY" && i.targets.includes(f.id),
    ),
  ).toBe(true);
});
it("does not report group envelope overlaps as physical collisions when every actual element is located and disjoint", () => {
  const c = completeLayoutGeometry();
  for (const a of c.assemblies) {
    a.x = d(2000);
    a.y = d(1700);
    a.dimensions.width = d(6270);
  }
  expect(checkStoreLayoutGeometry(c).status).toBe("CHECKED");
});
it("marks envelope overlap as uncertain when actual member positions are missing", () => {
  const c = createPilotStoreLayout(randomUUID);
  c.assemblies[1]!.x = c.assemblies[0]!.x;
  const r = checkStoreLayoutGeometry(c);
  expect(r.status).toBe("INCOMPLETE");
  expect(r.issues.some((i) => i.code === "ENVELOPE_OVERLAP")).toBe(true);
  expect(r.issues.some((i) => i.code === "COLLISION")).toBe(false);
});
it("accepts a separately identified mobile under a host only with known adequate height and clearance", () => {
  const { c, m } = mobileFixture(),
    r = checkStoreLayoutGeometry(c);
  expect(r.status).toBe("CHECKED");
  expect(r.counts).toMatchObject({ furniture: 20, mobiles: 1, located: 20 });
  expect(r.footprints.find((b) => b.id === m.id)).toMatchObject({
    width: 500,
    depth: 600,
  });
});
it.each(["height", "clearance"] as const)(
  "keeps mobile fit unverified when %s is unknown",
  (field) => {
    const { c, host, m } = mobileFixture();
    if (field === "height")
      m.dimensions.height = { mm: null, quality: "UNKNOWN" };
    else host.clearanceBelow = { mm: null, quality: "UNKNOWN" };
    const r = checkStoreLayoutGeometry(c);
    expect(r.status).toBe("INCOMPLETE");
    expect(
      r.issues.some(
        (i) => i.code === "VERTICAL_FIT_UNKNOWN" && i.targets.includes(m.id),
      ),
    ).toBe(true);
    expect(r.issues.some((i) => i.code === "COLLISION")).toBe(false);
  },
);
it("blocks a real mobile/fixture vertical intersection and leaves reference heights unconfirmed", () => {
  const { c, host, m } = mobileFixture();
  m.dimensions.height = d(601);
  expect(
    checkStoreLayoutGeometry(c).issues.some(
      (i) => i.code === "CLEARANCE_EXCEEDED",
    ),
  ).toBe(true);
  m.dimensions.height = { mm: 500, quality: "REFERENCE" };
  expect(checkStoreLayoutGeometry(c).status).toBe("INCOMPLETE");
  expect(host.clearanceBelow.mm).toBe(600);
});
it("does not waive overlap checks against a second fixture merely because a mobile has a host", () => {
  const { c, m } = mobileFixture(),
    neighbor = c.furniture.find(
      (f) =>
        f.assemblyId === c.assemblies[0]!.id && f.face === "B" && f.order === 1,
    )!;
  m.x = d(2700);
  neighbor.clearanceBelow = d(400);
  const r = checkStoreLayoutGeometry(c);
  expect(
    r.issues.some(
      (i) => i.code === "CLEARANCE_EXCEEDED" && i.targets.includes(neighbor.id),
    ),
  ).toBe(true);
  expect(
    r.issues.some(
      (i) => i.code === "HOST_POSITION_UNCONFIRMED" && i.severity === "NOTICE",
    ),
  ).toBe(true);
});
it("rejects contradictory clearance and uses total height only to prove an impossible under-furniture fit", () => {
  const { c, host, m } = mobileFixture();
  host.dimensions.height = d(550);
  expect(
    checkStoreLayoutGeometry(c).issues.some(
      (i) => i.code === "CLEARANCE_INCONSISTENT",
    ),
  ).toBe(true);
  host.clearanceBelow = { mm: null, quality: "UNKNOWN" };
  m.dimensions.height = d(551);
  expect(
    checkStoreLayoutGeometry(c).issues.some(
      (i) => i.code === "CLEARANCE_EXCEEDED",
    ),
  ).toBe(true);
  m.dimensions.height = d(400);
  expect(checkStoreLayoutGeometry(c).status).toBe("INCOMPLETE");
  expect(host.clearanceBelow.mm).toBeNull();
});
it("still detects two overlapping mobiles even when both fit below the same host", () => {
  const fixture = mobileFixture(),
    m = fixture.m;
  let c = fixture.c;
  c = addStoreLayoutMobile(c, randomUUID, "Second mobile", m.hostId);
  const second = c.furniture.at(-1)!;
  Object.assign(second, {
    x: m.x,
    y: m.y,
    rotation: m.rotation,
    dimensions: m.dimensions,
  });
  const r = checkStoreLayoutGeometry(c);
  expect(r.issues.filter((i) => i.code === "COLLISION")).toHaveLength(1);
  expect(r.issues.find((i) => i.code === "COLLISION")?.targets).toEqual([
    m.id,
    second.id,
  ]);
});
it("does not infer under-host fit from association when the mobile has no recorded position", () => {
  let c = completeLayoutGeometry();
  c = addStoreLayoutMobile(c, randomUUID, "Mobile inconnu", c.furniture[0]!.id);
  const r = checkStoreLayoutGeometry(c);
  expect(r.status).toBe("INCOMPLETE");
  expect(
    r.issues.some(
      (i) => i.code === "HOST_POSITION_UNCONFIRMED" && i.severity === "MISSING",
    ),
  ).toBe(true);
});
it("never invents an expected island/TG/mobile count and treats an empty inventory as unknown", () => {
  const c = completeLayoutGeometry();
  c.furniture = [];
  c.surfaces = [];
  expect(checkStoreLayoutGeometry(c).status).toBe("INCOMPLETE");
  expect(checkStoreLayoutGeometry(c).counts.furniture).toBe(0);
  c.assemblies = [];
  expect(
    checkStoreLayoutGeometry(c).issues.some(
      (i) => i.code === "INVENTORY_EMPTY",
    ),
  ).toBe(true);
});
it("checks all 128 furniture objects and all 8 128 collision pairs without truncation or eight-object batches", () => {
  const c = completeLayoutGeometry(),
    template = c.furniture.find((f) => f.kind === "TG")!;
  c.assemblies = [];
  c.surfaces = [];
  c.furniture = Array.from({ length: 128 }, (_, i) => ({
    ...template,
    id: randomUUID(),
    label: `TG ${i}`,
    x: d(0),
    y: d(0),
    dimensions: { ...template.dimensions, width: d(100), depth: d(100) },
  }));
  const r = checkStoreLayoutGeometry(c);
  expect(r.counts.located).toBe(128);
  expect(r.footprints).toHaveLength(128);
  expect(r.issues.filter((i) => i.code === "COLLISION")).toHaveLength(8128);
  expect(storeLayoutGeometrySchema.parse(r)).toEqual(r);
});
