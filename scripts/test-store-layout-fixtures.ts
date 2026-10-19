import { randomUUID } from "node:crypto";
import { createPilotStoreLayout } from "../packages/commercial-core/src/store-layout-pilot";
import {
  storeLayoutSchema,
  type StoreLayout,
} from "../packages/domain/src/store-layout";
export function layoutFixture(
  storeId = randomUUID(),
  updatedBy = randomUUID(),
): StoreLayout {
  return storeLayoutSchema.parse({
    id: storeId,
    storeId,
    revisionId: randomUUID(),
    parentRevisionId: null,
    referenceRevisionId: null,
    restoredFromRevisionId: null,
    action: "SAVE_DRAFT",
    content: createPilotStoreLayout(randomUUID),
    version: 1,
    createdAt: "2026-10-19T12:00:00.000Z",
    updatedAt: "2026-10-19T12:00:00.000Z",
    updatedBy,
  });
}
export function nextLayout(
  p: StoreLayout,
  patch: Partial<StoreLayout> = {},
): StoreLayout {
  return storeLayoutSchema.parse({
    ...p,
    revisionId: randomUUID(),
    parentRevisionId: p.revisionId,
    version: p.version + 1,
    action: "SAVE_DRAFT",
    restoredFromRevisionId: null,
    ...patch,
  });
}

/** Synthetic declared rectangles for geometry tests, never a real pilot survey or production fallback. */
export function completeLayoutGeometry() {
  const c = createPilotStoreLayout(randomUUID);
  const declared = (mm: number) => ({ mm, quality: "DECLARED" as const });
  for (const m of Object.values(c.room)) m.quality = "DECLARED";
  for (const a of c.assemblies) {
    for (const m of [a.x, a.y, a.dimensions.width, a.dimensions.depth])
      m.quality = "DECLARED";
    for (const f of c.furniture.filter((f) => f.assemblyId === a.id)) {
      f.x = declared(a.x.mm! + (f.face === "B" ? 885 : 0));
      f.y = declared(a.y.mm! + (f.order! - 1) * 1025);
      f.rotation = 0;
      f.dimensions.width = declared(885);
      f.dimensions.depth = declared(1025);
    }
  }
  for (const f of c.furniture.filter((f) => f.kind === "TG"))
    for (const m of [f.x, f.y, f.dimensions.width, f.dimensions.depth])
      m.quality = "DECLARED";
  return c;
}
