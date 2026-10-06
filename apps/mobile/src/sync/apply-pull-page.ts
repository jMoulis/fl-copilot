import { applyWastePublication } from "../documents/waste-receipt-publication";
import {
  SYNC_PROTOCOL_VERSION,
  type SyncPullResponse,
} from "@fl-copilot/sync-contracts";
import type { AtomicMutationDatabase } from "./atomic-local-mutation";
import { synchronizedTestEntitySchema } from "./sync-test-entity-schema";
import { applyProductMasterChange } from "../products/apply-product-master";

export async function applyPullPage(
  database: AtomicMutationDatabase,
  storeId: string,
  page: SyncPullResponse,
) {
  await database.withExclusiveTransactionAsync(async (transaction) => {
    for (const change of page.changes) {
      if (change.entityType === "waste_receipt_publication") {
        if (change.operation !== "UPSERT")
          throw new Error(
            "Published waste cannot be deleted through generic sync.",
          );
        await applyWastePublication(transaction, storeId, change.entity);
        continue;
      }
      if (await applyProductMasterChange(transaction, storeId, change)) {
        continue;
      }
      if (change.entityType !== "sync_test_entity") {
        throw new Error(
          `Unsupported synchronized entity type: ${change.entityType}`,
        );
      }
      if (change.operation === "DELETE") {
        await transaction.runAsync(
          `
            DELETE FROM sync_test_entities
            WHERE id = ? AND store_id = ? AND remote_version <= ?
          `,
          change.entityId,
          storeId,
          change.entityVersion,
        );
        continue;
      }

      const entity = synchronizedTestEntitySchema.parse(change.entity);
      if (
        entity.id !== change.entityId ||
        entity.storeId !== storeId ||
        entity.remoteVersion !== change.entityVersion
      ) {
        throw new Error("Synchronized entity does not match its envelope.");
      }
      await transaction.runAsync(
        `
          INSERT INTO sync_test_entities (
            id, store_id, label, remote_version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            store_id = excluded.store_id,
            label = excluded.label,
            remote_version = excluded.remote_version,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at
          WHERE excluded.remote_version >= sync_test_entities.remote_version
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
        ) VALUES (?, ?, ?, ?, NULL)
        ON CONFLICT(store_id) DO UPDATE SET
          cursor = excluded.cursor,
          last_successful_sync_at = excluded.last_successful_sync_at,
          protocol_version = excluded.protocol_version
      `,
      storeId,
      page.nextCursor,
      page.serverTime,
      SYNC_PROTOCOL_VERSION,
    );
  });
}
