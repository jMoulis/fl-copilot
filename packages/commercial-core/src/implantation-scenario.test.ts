import { expect, it } from "vitest";
import { implantationScenarioInputSchema } from "@fl-copilot/domain";
import { implantationFixture } from "../../../scripts/test-implantation-fixtures";
import { checkImplantationScenario } from "./implantation-scenario";

it("checks declared rectangles, rotated footprints and counts without upgrading assumptions", () => {
  const input = implantationFixture(),
    before = JSON.parse(JSON.stringify(input));
  const result = checkImplantationScenario(input);
  expect(result).toMatchObject({
    status: "CHECKED",
    authority: "PROVISIONAL",
    counts: { TG: 1, ISLAND: 1 },
    issues: [],
  });
  expect(result.footprints.find((f) => f.id === "island")).toMatchObject({
    widthMm: 1000,
    depthMm: 2000,
  });
  expect(input).toEqual(before);
  expect(checkImplantationScenario(input)).toEqual(result);
});
it.each([
  ["bounds", "OUT_OF_BOUNDS"],
  ["rotation", "OUT_OF_BOUNDS"],
  ["fixture", "COLLISION"],
  ["obstacle", "COLLISION"],
  ["passage", "RESERVED_AREA_BLOCKED"],
  ["entrance", "RESERVED_AREA_BLOCKED"],
  ["obstacle-passage", "RESERVED_AREA_BLOCKED"],
  ["narrow", "PASSAGE_TOO_NARROW"],
  ["height", "HEIGHT_EXCEEDED"],
  ["load", "LOAD_EXCEEDED"],
  ["count", "COUNT_MISMATCH"],
])("identifies %s with affected targets (%s)", (mode, code) => {
  const f = implantationFixture(),
    tg = f.fixtures[0]!,
    island = f.fixtures[1]!,
    aisle = f.reservedAreas![0]!;
  if (mode === "bounds") tg.xMm = 5000;
  if (mode === "rotation") {
    island.xMm = 0;
    island.yMm = 3500;
  }
  if (mode === "fixture") island.xMm = 0;
  if (mode === "obstacle") tg.xMm = 5000;
  if (mode === "passage" || mode === "entrance") {
    tg.yMm = 2500;
    aisle.kind = mode === "entrance" ? "ENTRANCE" : "PASSAGE";
  }
  if (mode === "obstacle-passage") f.obstacles![0]!.yMm = 2500;
  if (mode === "narrow") aisle.minimumWidthMm = 1501;
  if (mode === "height") tg.heightMm = 1801;
  if (mode === "load") tg.loadKg = 100.01;
  if (mode === "count") f.expectedCounts.TG = 4;
  const r = checkImplantationScenario(f);
  expect(r.status).toBe("BLOCKED");
  expect(r.issues).toContainEqual(
    expect.objectContaining({
      code,
      severity: "BLOCKING",
      targets: expect.any(Array),
    }),
  );
});
it("treats exact edges, declared minimum widths, heights and loads as within constraints", () => {
  const f = implantationFixture();
  Object.assign(f.fixtures[0]!, {
    xMm: 4800,
    yMm: 1700,
    heightMm: 1800,
    loadKg: 100,
  });
  expect(checkImplantationScenario(f).status).toBe("CHECKED");
});
it("allows adjoining reservations and overlapping fixed obstacles without inventing fixture collisions", () => {
  const f = implantationFixture();
  f.obstacles!.push({ ...f.obstacles![0]!, id: "column-base" });
  f.reservedAreas!.push({
    ...f.reservedAreas![0]!,
    id: "entrance",
    kind: "ENTRANCE",
  });
  expect(checkImplantationScenario(f).status).toBe("CHECKED");
});
it("retains unknown dimensions/capacities/counts instead of substituting zero", () => {
  const f = implantationFixture();
  f.space.widthMm = null;
  f.space.maxHeightMm = null;
  f.expectedCounts.TG = null;
  f.fixtures[0]!.widthMm = null;
  f.fixtures[1]!.loadKg = null;
  f.reservedAreas![0]!.minimumWidthMm = null;
  const r = checkImplantationScenario(f);
  expect(r.status).toBe("INCOMPLETE");
  expect(r.footprints.some((x) => x.id === "tg")).toBe(false);
  expect(r.issues.map((i) => i.targets[0])).toEqual(
    expect.arrayContaining([
      "space.widthMm",
      "space.maxHeightMm",
      "expectedCounts.TG",
      "tg.widthMm",
      "island.loadKg",
      "aisle.minimumWidthMm",
    ]),
  );
  expect(r.input.fixtures[1]!.loadKg).toBeNull();
});
it("reports known impossibilities even while other information is missing", () => {
  const f = implantationFixture();
  f.fixtures[0]!.widthMm = null;
  f.fixtures[1]!.loadKg = 201;
  const r = checkImplantationScenario(f);
  expect(r.status).toBe("BLOCKED");
  expect(r.issues.map((i) => i.severity)).toEqual(
    expect.arrayContaining(["MISSING", "BLOCKING"]),
  );
});
it("distinguishes unknown access/obstacles from an explicitly empty hypothetical inventory", () => {
  const f = implantationFixture();
  f.obstacles = null;
  f.reservedAreas = null;
  const r = checkImplantationScenario(f);
  expect(r.status).toBe("INCOMPLETE");
  expect(r.issues.map((i) => i.code)).toEqual([
    "INVENTORY_UNKNOWN",
    "INVENTORY_UNKNOWN",
  ]);
  f.obstacles = [];
  f.reservedAreas = [];
  expect(checkImplantationScenario(f)).toMatchObject({
    status: "CHECKED",
    authority: "PROVISIONAL",
  });
});
it("preserves a known zero loading limit", () => {
  const f = implantationFixture();
  f.fixtures[0]!.maxLoadKg = 0;
  f.fixtures[0]!.loadKg = 0;
  expect(checkImplantationScenario(f).status).toBe("CHECKED");
  f.fixtures[0]!.loadKg = 0.01;
  expect(checkImplantationScenario(f).issues).toContainEqual(
    expect.objectContaining({ code: "LOAD_EXCEEDED" }),
  );
});
it.each(["width", "position", "rotation", "passage"])(
  "detects already impossible partial geometry (%s)",
  (mode) => {
    const f = implantationFixture(),
      tg = f.fixtures[0]!;
    if (mode === "width") {
      tg.xMm = null;
      tg.widthMm = 6001;
      tg.depthMm = null;
    }
    if (mode === "position") {
      tg.xMm = 6000;
      tg.widthMm = null;
    }
    if (mode === "rotation") {
      tg.rotation = 90;
      tg.depthMm = 6001;
      tg.yMm = null;
    }
    if (mode === "passage") {
      f.reservedAreas![0]!.widthMm = 1400;
      f.reservedAreas![0]!.depthMm = null;
    }
    const r = checkImplantationScenario(f);
    expect(r.status).toBe("BLOCKED");
    expect(r.issues).toContainEqual(
      expect.objectContaining({
        code: mode === "passage" ? "PASSAGE_TOO_NARROW" : "OUT_OF_BOUNDS",
      }),
    );
    expect(r.issues).toContainEqual(
      expect.objectContaining({ severity: "MISSING" }),
    );
  },
);
it("keeps a maximally dense bounded scenario within the result contract", () => {
  const f = implantationFixture();
  f.fixtures = Array.from({ length: 8 }, (_, i) => ({
    ...f.fixtures[0]!,
    id: `tg${i}`,
    xMm: 0,
    yMm: 0,
    maxLoadKg: null,
  }));
  f.obstacles = Array.from({ length: 6 }, (_, i) => ({
    ...f.obstacles![0]!,
    id: `obstacle${i}`,
    xMm: 0,
    yMm: 0,
  }));
  f.reservedAreas = Array.from({ length: 4 }, (_, i) => ({
    ...f.reservedAreas![0]!,
    id: `passage${i}`,
    xMm: 0,
    yMm: 0,
  }));
  const r = checkImplantationScenario(f);
  expect(r.footprints).toHaveLength(18);
  expect(r.status).toBe("BLOCKED");
  expect(r.issues.length).toBeLessThanOrEqual(200);
});
it.each([
  "negative",
  "zero",
  "fraction",
  "unbounded",
  "duplicate",
  "too-many",
  "angle",
  "scope",
])("rejects unsupported or unsafe input (%s)", (mode) => {
  const f = implantationFixture();
  if (mode === "negative") f.fixtures[0]!.xMm = -1;
  if (mode === "zero") f.space.widthMm = 0;
  if (mode === "fraction") f.fixtures[0]!.widthMm = 1200.5;
  if (mode === "unbounded") f.space.depthMm = Infinity;
  if (mode === "duplicate") f.obstacles![0]!.id = "tg";
  if (mode === "too-many")
    for (let i = 0; i < 7; i++)
      f.fixtures.push({ ...f.fixtures[0]!, id: `tg${i}` });
  const raw =
    mode === "scope"
      ? { ...f, storeId: "model-chosen" }
      : mode === "angle"
        ? { ...f, fixtures: [{ ...f.fixtures[0], rotation: 45 }] }
        : f;
  expect(implantationScenarioInputSchema.safeParse(raw).success).toBe(false);
  expect(() => checkImplantationScenario(raw)).toThrow();
});
