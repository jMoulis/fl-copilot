import { copilotPriorityBatchSchema } from "@fl-copilot/domain";
import { scoreCopilotPriorities } from "@fl-copilot/analytics-core";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
/** Local derived audit, not a user command or remotely synchronized operational entity. */
export class CopilotPriorityRepository {
  constructor(
    private db: AtomicMutationDatabase & OutboxDatabase,
    private digest: (s: string) => Promise<string>,
  ) {}
  async evaluate(input: Parameters<typeof scoreCopilotPriorities>[0]) {
    const batch = scoreCopilotPriorities(input),
      payload = JSON.stringify(batch),
      id = (await this.digest(payload)).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(id))
      throw Error("COPILOT_PRIORITY_DIGEST_INVALID");
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const old = await tx.getFirstAsync<{
        store_id: string;
        payload_json: string;
      }>(
        "SELECT store_id,payload_json FROM copilot_priority_snapshots WHERE id=?",
        id,
      );
      if (old) {
        if (old.store_id !== batch.storeId || old.payload_json !== payload)
          throw Error("COPILOT_PRIORITY_IMMUTABLE");
        return;
      }
      await tx.runAsync(
        "INSERT INTO copilot_priority_snapshots(id,store_id,evaluated_at,payload_json) VALUES(?,?,?,?)",
        id,
        batch.storeId,
        batch.evaluatedAt,
        payload,
      );
    });
    return { id, batch };
  }
  async read(storeId: string, id: string) {
    const row = await this.db.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM copilot_priority_snapshots WHERE store_id=? AND id=?",
      storeId,
      id,
    );
    if (!row) return null;
    const batch = copilotPriorityBatchSchema.parse(
      JSON.parse(row.payload_json),
    );
    if (batch.storeId !== storeId)
      throw Error("COPILOT_PRIORITY_STORE_INVALID");
    return batch;
  }
}
