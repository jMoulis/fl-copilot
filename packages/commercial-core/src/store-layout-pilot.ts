import {
  storeLayoutContentSchema,
  type StoreLayoutContent,
} from "@fl-copilot/domain";
/** Called only for an explicitly selected pilot reference; never auto-seeds every store. */
export function createPilotStoreLayout(id: () => string): StoreLayoutContent {
  const unknown = { mm: null, quality: "UNKNOWN" as const },
    ref = (mm: number) => ({ mm, quality: "REFERENCE" as const });
  const dimensions = { width: unknown, depth: unknown, height: unknown };
  const c: StoreLayoutContent = {
    schemaVersion: 1,
    provenance: {
      kind: "FLEG_REFERENCE",
      reference:
        "jMoulis/fleg@8ea2ab98241bf0680b99bbe8adf6cbdd0af633ea/schemas/reference-layout.json",
    },
    room: { width: ref(11500), depth: ref(8500) },
    assemblies: [],
    furniture: [],
    surfaces: [],
  };
  for (let a = 0; a < 2; a++) {
    const assemblyId = id();
    c.assemblies.push({
      id: assemblyId,
      label: `Îlot ${a + 1}`,
      sourceKey: `island-${a + 1}`,
      x: ref(a === 0 ? 2000 : 6500),
      y: ref(1700),
      rotation: 0,
      dimensions: { width: ref(1770), depth: ref(4100), height: unknown },
    });
    for (const face of ["A", "B"] as const)
      for (let order = 1; order <= 4; order++) {
        const furnitureId = id();
        c.furniture.push({
          id: furnitureId,
          label: `Îlot ${a + 1} · Face ${face} · Élément ${order}`,
          kind: "FIXED",
          assemblyId,
          face,
          order,
          hostId: null,
          x: unknown,
          y: unknown,
          rotation: null,
          dimensions,
          clearanceBelow: unknown,
          sourceKey: `island-${a + 1}/${face}/${order}`,
        });
        c.surfaces.push(
          {
            id: id(),
            furnitureId,
            kind: "BAC",
            label: "Bac aluminium",
            dimensions,
            maxLoadKg: null,
          },
          {
            id: id(),
            furnitureId,
            kind: "UPPER_SHELF",
            label: "Étagère supérieure",
            dimensions: { ...dimensions, depth: ref(450) },
            maxLoadKg: null,
          },
        );
      }
  }
  for (let t = 0; t < 3; t++)
    c.furniture.push({
      id: id(),
      label: `TG ${t + 1}`,
      kind: "TG",
      assemblyId: null,
      face: null,
      order: null,
      hostId: null,
      x: ref(t === 2 ? 6500 : 2000),
      y: ref(t === 0 ? 870 : 5800),
      rotation: 0,
      dimensions: { width: ref(1770), depth: ref(830), height: unknown },
      clearanceBelow: unknown,
      sourceKey: `tg-${t + 1}`,
    });
  return storeLayoutContentSchema.parse(c);
}
