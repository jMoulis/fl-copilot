import {
  runAtomicLocalMutation,
  type AtomicMutationDatabase,
} from "./atomic-local-mutation";

export interface CreateSyncTestEntityInput {
  id: string;
  commandId: string;
  storeId: string;
  deviceId: string;
  label: string;
  createdAt?: string;
}

export interface SyncTestEntity {
  id: string;
  storeId: string;
  label: string;
  remoteVersion: number;
  createdAt: string;
  updatedAt: string;
}

export async function createSyncTestEntity(
  database: AtomicMutationDatabase,
  input: CreateSyncTestEntityInput,
  now: () => string = () => new Date().toISOString(),
) {
  const timestamp = input.createdAt ?? now();
  const entity: SyncTestEntity = {
    id: input.id,
    storeId: input.storeId,
    label: input.label,
    remoteVersion: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  return runAtomicLocalMutation(
    database,
    {
      async mutate(transaction) {
        await transaction.runAsync(
          `
            INSERT INTO sync_test_entities (
              id, store_id, label, remote_version, created_at, updated_at
            ) VALUES (?, ?, ?, 0, ?, ?)
          `,
          entity.id,
          entity.storeId,
          entity.label,
          entity.createdAt,
          entity.updatedAt,
        );
        return entity;
      },
      outbox: {
        commandId: input.commandId,
        storeId: input.storeId,
        deviceId: input.deviceId,
        commandType: "SYNC_TEST_ENTITY_UPSERT",
        entityType: "sync_test_entity",
        entityId: input.id,
        expectedRemoteVersion: null,
        payload: entity,
        createdAt: timestamp,
      },
    },
    now,
  );
}
