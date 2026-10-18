import type { OutboxDatabase } from "../sync/outbox-repository";
export async function recordProductMasterRemote(
  db: OutboxDatabase,
  storeId: string,
  entityType: string,
  entityId: string,
  version: number,
  operation: "UPSERT" | "DELETE",
  entity: unknown,
) {
  await db.runAsync(
    `INSERT INTO product_master_remote_snapshots(store_id,entity_type,entity_id,version,operation,payload_json) VALUES(?,?,?,?,?,?) ON CONFLICT(store_id,entity_type,entity_id) DO UPDATE SET version=excluded.version,operation=excluded.operation,payload_json=excluded.payload_json WHERE excluded.version>product_master_remote_snapshots.version OR (excluded.version=product_master_remote_snapshots.version AND product_master_remote_snapshots.operation!='DELETE')`,
    storeId,
    entityType,
    entityId,
    version,
    operation,
    operation === "UPSERT" ? JSON.stringify(entity) : null,
  );
}
