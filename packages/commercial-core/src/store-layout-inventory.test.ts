import { describe, expect, it } from "vitest";
import { storeLayoutContentSchema } from "@fl-copilot/domain";
import { createPilotStoreLayout } from "./store-layout-pilot";
import { addStoreLayoutMobile } from "./store-layout-editing";
import {
  addStoreLayoutInventory,
  addStoreLayoutTgSurface,
  duplicateStoreLayoutInventory,
  removeStoreLayoutInventory,
  renameStoreLayoutInventory,
} from "./store-layout-inventory";

let counter = 0;
const uuid = () =>
  `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
function fixture() {
  let content = createPilotStoreLayout(uuid);
  const fixed = content.furniture.find((f) => f.kind === "FIXED")!;
  content = addStoreLayoutMobile(content, uuid, "Mobile présent", fixed.id);
  const mobile = content.furniture.at(-1)!;
  mobile.x = { mm: 2300, quality: "MEASURED" };
  content.furniture.find((f) => f.id === fixed.id)!.dimensions.width = {
    mm: 900,
    quality: "MEASURED",
  };
  content.surfaces.find((s) => s.furnitureId === fixed.id)!.maxLoadKg = 80;
  return {
    content,
    fixed: content.furniture.find((f) => f.id === fixed.id)!,
    mobile,
  };
}
describe("explicit physical inventory", () => {
  it("adds an empty island then one elementary fixed object with its own two surfaces, without guessing mobiles or measures", () => {
    const { content } = fixture(),
      before = JSON.stringify(content);
    const island = addStoreLayoutInventory(
      content,
      { kind: "ASSEMBLY", label: "Îlot ajouté" },
      uuid,
    );
    const result = addStoreLayoutInventory(
      island.content,
      {
        kind: "FIXED",
        label: "Élément A1",
        assemblyId: island.id,
        face: "A",
        order: 1,
      },
      uuid,
    );
    const f = result.content.furniture.find((f) => f.id === result.id)!;
    expect(f).toMatchObject({
      kind: "FIXED",
      assemblyId: island.id,
      face: "A",
      order: 1,
      hostId: null,
      sourceKey: null,
      rotation: null,
      x: { mm: null, quality: "UNKNOWN" },
    });
    expect(
      Object.values(f.dimensions).every(
        (m) => m.mm === null && m.quality === "UNKNOWN",
      ),
    ).toBe(true);
    expect(
      result.content.surfaces
        .filter((s) => s.furnitureId === f.id)
        .map((s) => s.kind)
        .sort(),
    ).toEqual(["BAC", "UPPER_SHELF"]);
    expect(result.content.furniture.filter((f) => f.kind === "MOBILE")).toEqual(
      content.furniture.filter((f) => f.kind === "MOBILE"),
    );
    expect(result.content.room).toEqual(content.room);
    expect(JSON.stringify(content)).toBe(before);
  });
  it.each([
    { face: "A", order: 1 },
    { face: "A", order: 0 },
    { face: "A", order: 65 },
    { face: "C", order: 5 },
    { face: "B", order: 1.5 },
  ])(
    "refuses occupied or invalid face slot %j without changing the source",
    (slot) => {
      const { content, fixed } = fixture(),
        before = JSON.stringify(content);
      expect(() =>
        addStoreLayoutInventory(
          content,
          {
            kind: "FIXED",
            label: "Nouveau",
            assemblyId: fixed.assemblyId!,
            ...slot,
          } as Parameters<typeof addStoreLayoutInventory>[1],
          uuid,
        ),
      ).toThrow();
      expect(JSON.stringify(content)).toBe(before);
    },
  );
  it("requires a declared existing island and a new slot before duplicating a fixed element", () => {
    const { content, fixed } = fixture(),
      target = { kind: "FURNITURE" as const, id: fixed.id };
    expect(() =>
      duplicateStoreLayoutInventory(
        content,
        target,
        { label: "Copie", copyDimensions: false },
        uuid,
      ),
    ).toThrow(/emplacement/);
    expect(() =>
      duplicateStoreLayoutInventory(
        content,
        target,
        {
          label: "Copie",
          copyDimensions: false,
          slot: { assemblyId: uuid(), face: "A", order: 5 },
        },
        uuid,
      ),
    ).toThrow(/îlot/);
    expect(() =>
      duplicateStoreLayoutInventory(
        content,
        target,
        {
          label: "Copie",
          copyDimensions: false,
          slot: { assemblyId: fixed.assemblyId!, face: "A", order: 1 },
        },
        uuid,
      ),
    ).toThrow(/occupé/);
  });
  it("copies fixed structure to fresh identities, with unknown location and no host mobile, load or measured certainty", () => {
    const { content, fixed, mobile } = fixture(),
      before = JSON.stringify(content);
    for (const copyDimensions of [false, true]) {
      const r = duplicateStoreLayoutInventory(
        content,
        { kind: "FURNITURE", id: fixed.id },
        {
          label: "Copie A5",
          copyDimensions,
          slot: { assemblyId: fixed.assemblyId!, face: "A", order: 5 },
        },
        uuid,
      );
      const f = r.content.furniture.find((f) => f.id === r.id)!;
      expect(f.id).not.toBe(fixed.id);
      expect(f.sourceKey).toBeNull();
      expect(f.x.mm).toBeNull();
      expect(f.y.mm).toBeNull();
      expect(f.rotation).toBeNull();
      expect(f.dimensions.width).toEqual(
        copyDimensions
          ? { mm: 900, quality: "DECLARED" }
          : { mm: null, quality: "UNKNOWN" },
      );
      const surfaces = r.content.surfaces.filter((s) => s.furnitureId === r.id);
      expect(surfaces).toHaveLength(2);
      expect(
        surfaces.every(
          (s) =>
            s.maxLoadKg === null &&
            !content.surfaces.some((old) => old.id === s.id),
        ),
      ).toBe(true);
      expect(r.content.furniture.filter((f) => f.kind === "MOBILE")).toEqual([
        mobile,
      ]);
    }
    expect(JSON.stringify(content)).toBe(before);
  });
  it("duplicates both island faces and separate upper shelves without creating a mobile or a fourth TG", () => {
    const { content, fixed, mobile } = fixture(),
      before = JSON.stringify(content);
    const r = duplicateStoreLayoutInventory(
      content,
      { kind: "ASSEMBLY", id: fixed.assemblyId! },
      { label: "Nouvel îlot", copyDimensions: true },
      uuid,
    );
    const children = r.content.furniture.filter((f) => f.assemblyId === r.id);
    expect(children).toHaveLength(8);
    expect(children.filter((f) => f.face === "A")).toHaveLength(4);
    expect(children.filter((f) => f.face === "B")).toHaveLength(4);
    expect(
      children.every(
        (f) =>
          f.label.startsWith("Nouvel îlot · Face") &&
          f.x.mm === null &&
          f.y.mm === null &&
          f.rotation === null,
      ),
    ).toBe(true);
    expect(
      r.content.surfaces.filter((s) =>
        children.some((f) => f.id === s.furnitureId),
      ),
    ).toHaveLength(16);
    expect(r.content.furniture.filter((f) => f.kind === "MOBILE")).toEqual([
      mobile,
    ]);
    expect(r.content.furniture.filter((f) => f.kind === "TG")).toHaveLength(3);
    expect(
      storeLayoutContentSchema.parse(JSON.parse(JSON.stringify(r.content))),
    ).toEqual(r.content);
    expect(JSON.stringify(content)).toBe(before);
  });
  it("keeps TG composition unknown until a selling surface is explicitly added, renamed or removed", () => {
    const { content, fixed } = fixture();
    const tg = addStoreLayoutInventory(
      content,
      { kind: "TG", label: "TG déclarée" },
      uuid,
    );
    expect(tg.content.surfaces.filter((s) => s.furnitureId === tg.id)).toEqual(
      [],
    );
    const surface = addStoreLayoutTgSurface(
      tg.content,
      tg.id,
      "Plateau",
      "OTHER",
      uuid,
    );
    expect(
      surface.content.surfaces.find((s) => s.id === surface.id),
    ).toMatchObject({
      kind: "OTHER",
      maxLoadKg: null,
      dimensions: { width: { mm: null, quality: "UNKNOWN" } },
    });
    const renamed = renameStoreLayoutInventory(
      surface.content,
      { kind: "SURFACE", id: surface.id },
      " Plateau entrée ",
    );
    expect(renamed.surfaces.find((s) => s.id === surface.id)?.label).toBe(
      "Plateau entrée",
    );
    expect(
      removeStoreLayoutInventory(renamed, { kind: "SURFACE", id: surface.id }),
    ).toEqual(tg.content);
    expect(() =>
      addStoreLayoutTgSurface(
        content,
        fixed.id,
        "Autre étagère",
        "UPPER_SHELF",
        uuid,
      ),
    ).toThrow(/TG/);
    expect(() =>
      addStoreLayoutTgSurface(
        tg.content,
        tg.id,
        "Invalid",
        "MOBILE_DISPLAY" as "OTHER",
        uuid,
      ),
    ).toThrow(/surface/);
  });
  it("removing a fixed element or island detaches existing mobiles without deleting or moving them", () => {
    const { content, fixed, mobile } = fixture(),
      before = JSON.stringify(content);
    for (const target of [
      { kind: "FURNITURE" as const, id: fixed.id },
      { kind: "ASSEMBLY" as const, id: fixed.assemblyId! },
    ]) {
      const next = removeStoreLayoutInventory(content, target);
      expect(next.furniture.find((f) => f.id === mobile.id)).toEqual({
        ...mobile,
        hostId: null,
      });
      expect(next.surfaces.filter((s) => s.furnitureId === mobile.id)).toEqual(
        content.surfaces.filter((s) => s.furnitureId === mobile.id),
      );
      expect(next.furniture.some((f) => f.id === fixed.id)).toBe(false);
      expect(next.surfaces.some((s) => s.furnitureId === fixed.id)).toBe(false);
      expect(next.furniture.filter((f) => f.kind === "TG")).toEqual(
        content.furniture.filter((f) => f.kind === "TG"),
      );
      storeLayoutContentSchema.parse(next);
    }
    expect(JSON.stringify(content)).toBe(before);
  });
  it("refuses isolated required-surface removal, foreign IDs and invalid labels", () => {
    const { content, fixed, mobile } = fixture();
    for (const id of [fixed.id, mobile.id])
      expect(() =>
        removeStoreLayoutInventory(content, {
          kind: "SURFACE",
          id: content.surfaces.find((s) => s.furnitureId === id)!.id,
        }),
      ).toThrow(/obligatoires/);
    expect(() =>
      removeStoreLayoutInventory(content, {
        kind: "ASSEMBLY",
        id: uuid(),
      }),
    ).toThrow(/introuvable/);
    expect(() =>
      renameStoreLayoutInventory(
        content,
        { kind: "FURNITURE", id: fixed.id },
        " ",
      ),
    ).toThrow();
    expect(() =>
      duplicateStoreLayoutInventory(
        content,
        { kind: "SURFACE", id: content.surfaces[0]!.id },
        { label: "Copie", copyDimensions: false },
        uuid,
      ),
    ).toThrow(/surface/);
    expect(() =>
      addStoreLayoutInventory(
        content,
        { kind: "TG", label: "X" },
        () => fixed.id,
      ),
    ).toThrow(/distinctes/);
  });
  it("applies the existing inventory limits atomically rather than truncating an addition", () => {
    let c = createPilotStoreLayout(uuid);
    while (c.assemblies.length < 32)
      c = addStoreLayoutInventory(
        c,
        { kind: "ASSEMBLY", label: "Îlot" },
        uuid,
      ).content;
    const before = JSON.stringify(c);
    expect(() =>
      addStoreLayoutInventory(c, { kind: "ASSEMBLY", label: "En trop" }, uuid),
    ).toThrow();
    expect(JSON.stringify(c)).toBe(before);
  });
});
