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
