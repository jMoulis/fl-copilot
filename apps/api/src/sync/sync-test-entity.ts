import { z } from "zod";

export const syncTestEntityPayloadSchema = z.object({
  id: z.string().uuid(),
  storeId: z.string().uuid(),
  label: z.string().trim().min(1),
  remoteVersion: z.number().int().nonnegative(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export interface SyncTestEntityDocument {
  _id: string;
  storeId: string;
  label: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export function serializeSyncTestEntity(entity: SyncTestEntityDocument) {
  return {
    id: entity._id,
    storeId: entity.storeId,
    label: entity.label,
    remoteVersion: entity.version,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}
