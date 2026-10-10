import {
  substitutionEvidenceSchema,
  substitutionEvidenceStateSchema,
} from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
export async function applySubstitutionEvidence(
  db: OutboxDatabase,
  storeId: string,
  payload: unknown,
) {
  const e = substitutionEvidenceSchema.parse(payload);
  if (e.storeId !== storeId) throw Error("SUBSTITUTION_EVIDENCE_STORE_INVALID");
  const old = await db.getFirstAsync<{
    store_id: string;
    version: number;
    payload_json: string;
  }>(
    "SELECT store_id,version,payload_json FROM substitution_evidence WHERE id=?",
    e.id,
  );
  if (old && old.store_id !== storeId)
    throw Error("SUBSTITUTION_EVIDENCE_STORE_INVALID");
  if (old) {
    const previous = substitutionEvidenceSchema.parse(
      JSON.parse(old.payload_json),
    );
    if (
      previous.eventId !== e.eventId ||
      previous.relationshipId !== e.relationshipId ||
      previous.sourceProductId !== e.sourceProductId ||
      previous.candidateSubstituteProductId !==
        e.candidateSubstituteProductId ||
      previous.needUnitId !== e.needUnitId
    )
      throw Error("SUBSTITUTION_EVIDENCE_IDENTITY_CHANGED");
  }
  if (old && old.version > e.version) return;
  await db.runAsync(
    "INSERT INTO substitution_evidence(id,store_id,event_id,relationship_id,payload_json,version) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,version=excluded.version",
    e.id,
    storeId,
    e.eventId,
    e.relationshipId,
    JSON.stringify(e),
    e.version,
  );
}
export async function applySubstitutionEvidenceState(
  db: OutboxDatabase,
  storeId: string,
  payload: unknown,
) {
  const e = substitutionEvidenceStateSchema.parse(payload);
  if (e.id !== e.eventId || e.storeId !== storeId)
    throw Error("SUBSTITUTION_EVIDENCE_STATE_STORE_INVALID");
  const old = await db.getFirstAsync<{ store_id: string; version: number }>(
    "SELECT store_id,version FROM substitution_evidence_states WHERE id=?",
    e.id,
  );
  if (old && old.store_id !== storeId)
    throw Error("SUBSTITUTION_EVIDENCE_STATE_STORE_INVALID");
  if (old && old.version > e.version) return;
  await db.runAsync(
    "INSERT INTO substitution_evidence_states(id,store_id,payload_json,version) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,version=excluded.version",
    e.id,
    storeId,
    JSON.stringify(e),
    e.version,
  );
}
export class SubstitutionEvidenceRepository {
  constructor(private db: OutboxDatabase) {}
  async list(storeId: string) {
    return (
      await this.db.getAllAsync<{ payload_json: string }>(
        "SELECT payload_json FROM substitution_evidence WHERE store_id=? ORDER BY json_extract(payload_json,'$.observationStart') DESC,id",
        storeId,
      )
    ).map((r) => substitutionEvidenceSchema.parse(JSON.parse(r.payload_json)));
  }
  async get(storeId: string, id: string) {
    const r = await this.db.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM substitution_evidence WHERE store_id=? AND id=?",
      storeId,
      id,
    );
    return r
      ? substitutionEvidenceSchema.parse(JSON.parse(r.payload_json))
      : null;
  }
  async states(storeId: string) {
    return (
      await this.db.getAllAsync<{ payload_json: string }>(
        "SELECT payload_json FROM substitution_evidence_states WHERE store_id=?",
        storeId,
      )
    ).map((r) =>
      substitutionEvidenceStateSchema.parse(JSON.parse(r.payload_json)),
    );
  }
}
