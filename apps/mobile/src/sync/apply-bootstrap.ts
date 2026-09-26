import { z } from "zod";
import type { BootstrapResponse } from "@fl-copilot/sync-contracts";
import type { AtomicMutationDatabase } from "./atomic-local-mutation";
import { synchronizedTestEntitySchema } from "./sync-test-entity-schema";

const bootstrapStoreSchema = z.object({ id: z.string().uuid() });

export async function applyBootstrap(
  database: AtomicMutationDatabase,
  storeId: string,
  bootstrap: BootstrapResponse,
) {
  const store = bootstrapStoreSchema.parse(bootstrap.store);
  if (store.id !== storeId) {
    throw new Error("Bootstrap store does not match the local store.");
  }
  assertOnlyProofEntities(bootstrap);
  const entities = bootstrap.entities.syncTestEntities.map((entity) => {
    const parsed = synchronizedTestEntitySchema.parse(entity);
    if (parsed.storeId !== storeId) {
      throw new Error("Bootstrap entity belongs to another store.");
    }
    return parsed;
  });

  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync(
      "DELETE FROM sync_test_entities WHERE store_id = ?",
      storeId,
    );
    for (const entity of entities) {
      await transaction.runAsync(
        `
          INSERT INTO sync_test_entities (
            id, store_id, label, remote_version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `,
        entity.id,
        entity.storeId,
        entity.label,
        entity.remoteVersion,
        entity.createdAt,
        entity.updatedAt,
      );
    }
    await transaction.runAsync(
      `
        INSERT INTO sync_inbox_state (
          store_id, cursor, last_successful_sync_at, protocol_version,
          bootstrap_revision
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(store_id) DO UPDATE SET
          cursor = excluded.cursor,
          last_successful_sync_at = excluded.last_successful_sync_at,
          protocol_version = excluded.protocol_version,
          bootstrap_revision = excluded.bootstrap_revision
      `,
      storeId,
      bootstrap.cursor,
      bootstrap.serverTime,
      bootstrap.protocolVersion,
      bootstrap.snapshotRevision,
    );
  });
}

function assertOnlyProofEntities(bootstrap: BootstrapResponse) {
  if (
    Object.entries(bootstrap.entities).some(
      ([name, entities]) => name !== "syncTestEntities" && entities.length > 0,
    )
  ) {
    throw new Error("Bootstrap contains unsupported entity types.");
  }
}
