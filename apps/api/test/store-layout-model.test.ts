import { randomUUID } from "node:crypto";
import { it, expect } from "vitest";
import {
  storeLayoutContentSchema,
  layoutMeasurementSchema,
  validateStoreLayoutTransition,
  storeLayoutRevisionSchema,
} from "@fl-copilot/domain";
import { createPilotStoreLayout } from "../../../packages/commercial-core/src/store-layout-pilot";
import {
  layoutFixture,
  nextLayout,
} from "../../../scripts/test-store-layout-fixtures";
it("seeds only an explicitly selected reference: 2×8 single-face elements, individual bac/shelf, 3 TG and no invented mobiles", () => {
  const p = createPilotStoreLayout(randomUUID);
  expect(p.assemblies).toHaveLength(2);
  expect(p.assemblies[0]?.sourceKey).toBe("island-1");
  expect(p.furniture.find((f) => f.sourceKey === "tg-1")?.y).toEqual({
    mm: 870,
    quality: "REFERENCE",
  });
  expect(p.furniture).toHaveLength(19);
  expect(p.surfaces).toHaveLength(32);
  for (const a of p.assemblies)
    for (const face of ["A", "B"])
      expect(
        p.furniture.filter((f) => f.assemblyId === a.id && f.face === face),
      ).toHaveLength(4);
  expect(p.furniture.filter((f) => f.kind === "TG")).toHaveLength(3);
  expect(p.furniture.filter((f) => f.kind === "MOBILE")).toHaveLength(0);
  expect(p.furniture[0]?.dimensions.width).toEqual({
    mm: null,
    quality: "UNKNOWN",
  });
  expect(p.room.width).toEqual({ mm: 11500, quality: "REFERENCE" });
  expect(p.assemblies[0]?.dimensions.depth).toEqual({
    mm: 4100,
    quality: "REFERENCE",
  });
  expect(
    p.surfaces
      .filter((s) => s.kind === "UPPER_SHELF")
      .every((s) => s.dimensions.depth.quality === "REFERENCE"),
  ).toBe(true);
  expect(JSON.stringify(p)).not.toContain("MEASURED");
});
it("requires honest measures and keeps zero coordinates distinct from unknown dimensions", () => {
  expect(
    layoutMeasurementSchema.safeParse({ mm: null, quality: "MEASURED" })
      .success,
  ).toBe(false);
  expect(
    layoutMeasurementSchema.safeParse({ mm: 10, quality: "UNKNOWN" }).success,
  ).toBe(false);
  const p = createPilotStoreLayout(randomUUID);
  p.furniture[0]!.x = { mm: 0, quality: "MEASURED" };
  expect(storeLayoutContentSchema.safeParse(p).success).toBe(true);
  p.furniture[0]!.dimensions.width = { mm: 0, quality: "MEASURED" };
  expect(storeLayoutContentSchema.safeParse(p).success).toBe(false);
});
it.each(["duplicate", "missing-shelf", "orphan", "wrong-face", "mobile-host"])(
  "rejects broken hierarchy: %s",
  (kind) => {
    const p = createPilotStoreLayout(randomUUID);
    if (kind === "duplicate") p.surfaces[0]!.id = p.furniture[0]!.id;
    if (kind === "missing-shelf") p.surfaces.splice(1, 1);
    if (kind === "orphan") p.surfaces[0]!.furnitureId = randomUUID();
    if (kind === "wrong-face") p.furniture[1]!.order = 1;
    if (kind === "mobile-host") p.furniture[0]!.hostId = p.furniture[1]!.id;
    expect(storeLayoutContentSchema.safeParse(p).success).toBe(false);
  },
);
it("does not confuse an explicit reference with a draft, preserves stable furniture IDs on edit/restore, requires the reviewed exact draft", () => {
  const p = layoutFixture(),
    n = nextLayout(p);
  n.content.furniture[0]!.label = "Modifié";
  expect(validateStoreLayoutTransition(p, n).content.furniture[0]?.id).toBe(
    p.content.furniture[0]?.id,
  );
  const rid = randomUUID(),
    ref = nextLayout(n, {
      action: "ADOPT_REFERENCE",
      revisionId: rid,
      referenceRevisionId: rid,
    });
  expect(validateStoreLayoutTransition(n, ref).referenceRevisionId).toBe(rid);
  expect(() =>
    validateStoreLayoutTransition(n, { ...ref, content: p.content }),
  ).toThrow("REVIEW_REQUIRED");
  const restore = nextLayout(ref, {
    action: "RESTORE_AS_DRAFT",
    restoredFromRevisionId: p.revisionId,
    content: p.content,
  });
  expect(
    validateStoreLayoutTransition(ref, restore, p).referenceRevisionId,
  ).toBe(rid);
  expect(() =>
    validateStoreLayoutTransition(ref, restore, {
      ...p,
      storeId: randomUUID(),
    }),
  ).toThrow("RESTORE_INVALID");
  expect(() =>
    validateStoreLayoutTransition(
      ref,
      nextLayout(ref, { referenceRevisionId: null }),
    ),
  ).toThrow("REFERENCE_CHANGED");
  expect(
    storeLayoutRevisionSchema.safeParse({
      id: p.revisionId,
      storeId: randomUUID(),
      plan: p,
      version: 1,
    }).success,
  ).toBe(false);
});

it("records an optional mobile below one host without inventing vertical clearance or a collision verdict", () => {
  const p = createPilotStoreLayout(randomUUID),
    host = p.furniture[0]!,
    mobileId = randomUUID();
  p.furniture.push({
    ...host,
    id: mobileId,
    kind: "MOBILE",
    assemblyId: null,
    face: null,
    order: null,
    hostId: host.id,
    sourceKey: null,
    label: "Mobile sous élément 1",
  });
  p.surfaces.push({
    ...p.surfaces[0]!,
    id: randomUUID(),
    furnitureId: mobileId,
    kind: "MOBILE_DISPLAY",
    label: "Surface mobile",
  });
  expect(storeLayoutContentSchema.safeParse(p).success).toBe(true);
  expect(p.furniture.filter((f) => f.kind === "MOBILE")).toHaveLength(1);
  expect(p.furniture.at(-1)?.clearanceBelow).toEqual({
    mm: null,
    quality: "UNKNOWN",
  });
  p.furniture.at(-1)!.hostId = mobileId;
  expect(storeLayoutContentSchema.safeParse(p).success).toBe(false);
});
