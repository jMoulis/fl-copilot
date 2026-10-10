import { substitutionScoreHistorySchema } from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
export async function applySubstitutionScoreHistory(
  db: OutboxDatabase,
  storeId: string,
  payload: unknown,
) {
  const e = substitutionScoreHistorySchema.parse(payload);
  if (e.storeId !== storeId) throw Error("SUBSTITUTION_SCORE_STORE_INVALID");
  const old = await db.getFirstAsync<{ payload_json: string }>(
    "SELECT payload_json FROM substitution_score_history WHERE id=?",
    e.id,
  );
  if (old) {
    if (
      JSON.stringify(
        substitutionScoreHistorySchema.parse(JSON.parse(old.payload_json)),
      ) !== JSON.stringify(e)
    )
      throw Error("SUBSTITUTION_SCORE_IMMUTABLE");
    return;
  }
  await db.runAsync(
    "INSERT INTO substitution_score_history(id,store_id,substitution_id,relationship_version,payload_json) VALUES(?,?,?,?,?)",
    e.id,
    storeId,
    e.substitutionId,
    e.relationshipVersion,
    JSON.stringify(e),
  );
}
export class SubstitutionScoreRepository {
  constructor(private db: OutboxDatabase) {}
  async list(storeId: string, substitutionId: string) {
    return (
      await this.db.getAllAsync<{ payload_json: string }>(
        "SELECT payload_json FROM substitution_score_history WHERE store_id=? AND substitution_id=? ORDER BY relationship_version DESC",
        storeId,
        substitutionId,
      )
    ).map((r) =>
      substitutionScoreHistorySchema.parse(JSON.parse(r.payload_json)),
    );
  }
}
