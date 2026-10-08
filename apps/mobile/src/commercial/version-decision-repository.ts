import {
  commercialVersionDecisionSchema,
  type CommercialVersionDecision,
} from "@fl-copilot/sync-contracts";
import {
  commercialVersionDecisionId,
  commercialVersionDecisionSameIdentity,
  commercialVersionDecisionSameOriginalPair,
  commercialVersionDecisionSourcesValid,
} from "@fl-copilot/commercial-core";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import {
  OutboxRepository,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import { ConflictRepository } from "../sync/conflict-repository";
import { readCommercialVisualReadings } from "./visual-repository";
type Row = {
  id: string;
  store_id: string;
  pair_key: string;
  payload_json: string;
  remote_payload_json: string | null;
  remote_version: number | null;
  sync_state: string;
  dirty: number;
  last_error_code?: string | null;
};
export type LocalCommercialVersionDecision = {
  entity: CommercialVersionDecision;
  syncState: string;
  remoteVersion: number | null;
  remote: CommercialVersionDecision | null;
  lastErrorCode: string | null;
};
function mapped(row: Row): LocalCommercialVersionDecision {
  return {
    entity: commercialVersionDecisionSchema.parse(JSON.parse(row.payload_json)),
    syncState: row.sync_state,
    remoteVersion: row.remote_version,
    lastErrorCode: row.last_error_code ?? null,
    remote: row.remote_payload_json
      ? commercialVersionDecisionSchema.parse(
          JSON.parse(row.remote_payload_json),
        )
      : null,
  };
}
export async function applyCommercialVersionDecision(
  db: OutboxDatabase,
  storeId: string,
  payload: unknown,
  ackVersion?: number,
) {
  const choice = commercialVersionDecisionSchema.parse(payload);
  if (choice.storeId !== storeId)
    throw Error("COMMERCIAL_VERSION_DECISION_STORE_INVALID");
  const previous = await db.getFirstAsync<Row>(
    "SELECT * FROM commercial_version_decisions WHERE id=?",
    choice.id,
  );
  if (previous && previous.store_id !== storeId)
    throw Error("COMMERCIAL_VERSION_DECISION_STORE_INVALID");
  const local = previous ? mapped(previous) : null;
  if (local && !commercialVersionDecisionSameOriginalPair(local.entity, choice))
    throw Error("COMMERCIAL_VERSION_DECISION_IDENTITY_CHANGED");
  if (
    previous?.dirty &&
    (ackVersion === undefined || local!.entity.version !== ackVersion)
  ) {
    if (!local!.remote || choice.version >= local!.remote.version)
      await db.runAsync(
        "UPDATE commercial_version_decisions SET remote_payload_json=?,remote_version=CASE WHEN ? IS NULL THEN remote_version ELSE MAX(COALESCE(remote_version,0),?) END WHERE id=?",
        JSON.stringify(choice),
        ackVersion ?? null,
        choice.version,
        choice.id,
      );
    return;
  }
  if (local && (local.remoteVersion ?? 0) > choice.version) return;
  await db.runAsync(
    `INSERT INTO commercial_version_decisions(id,store_id,pair_key,payload_json,remote_payload_json,remote_version,sync_state,dirty) VALUES(?,?,?,?,?,?,'SYNCED',0) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,remote_payload_json=excluded.remote_payload_json,remote_version=excluded.remote_version,sync_state='SYNCED',dirty=0`,
    choice.id,
    storeId,
    JSON.stringify([choice.before.documentId, choice.after.documentId].sort()),
    JSON.stringify(choice),
    JSON.stringify(choice),
    choice.version,
  );
}
export class CommercialVersionDecisionRepository {
  constructor(
    private db: AtomicMutationDatabase & OutboxDatabase,
    private digest: (text: string) => Promise<string>,
  ) {}
  async get(storeId: string, beforeId: string, afterId: string) {
    const row = await this.db.getFirstAsync<Row>(
      "SELECT p.*,(SELECT last_error_code FROM sync_outbox o WHERE o.store_id=p.store_id AND o.entity_id=p.id AND o.entity_type='commercial_version_decision' ORDER BY local_sequence DESC LIMIT 1) AS last_error_code FROM commercial_version_decisions p WHERE p.store_id=? AND p.pair_key=?",
      storeId,
      JSON.stringify([beforeId, afterId].sort()),
    );
    return row ? mapped(row) : null;
  }
  async save(
    input: CommercialVersionDecision,
    ctx: { commandId: string; deviceId: string },
  ) {
    const choice = commercialVersionDecisionSchema.parse(input),
      id = await commercialVersionDecisionId(
        choice.storeId,
        choice.before.documentId,
        choice.after.documentId,
        this.digest,
      );
    if (id !== choice.id) throw Error("COMMERCIAL_VERSION_DECISION_ID_INVALID");
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const row = await tx.getFirstAsync<Row>(
          "SELECT * FROM commercial_version_decisions WHERE id=? AND store_id=?",
          id,
          choice.storeId,
        ),
        previous = row ? mapped(row) : null;
      if (row?.sync_state === "CONFLICT")
        throw Error("COMMERCIAL_VERSION_DECISION_RESOLVE_REQUIRED");
      const expected =
        row?.sync_state === "ERROR"
          ? row.remote_version
          : (previous?.entity.version ?? null);
      if (
        choice.version !== (expected ?? 0) + 1 ||
        (previous &&
          !commercialVersionDecisionSameIdentity(previous.entity, choice))
      )
        throw Error("COMMERCIAL_VERSION_DECISION_REVISION_INVALID");
      const pages = [
        ...(await readCommercialVisualReadings(
          tx,
          choice.storeId,
          choice.before.documentId,
        )),
        ...(await readCommercialVisualReadings(
          tx,
          choice.storeId,
          choice.after.documentId,
        )),
      ];
      if (!commercialVersionDecisionSourcesValid(choice, pages))
        throw Error("COMMERCIAL_VERSION_DECISION_SOURCE_INVALID");
      if (row?.sync_state === "ERROR") {
        const pending = await tx.getFirstAsync<{ n: number }>(
          "SELECT COUNT(*) AS n FROM sync_outbox WHERE entity_type='commercial_version_decision' AND entity_id=? AND status='SYNCING'",
          id,
        );
        if (pending?.n) throw Error("COMMERCIAL_VERSION_DECISION_SYNCING");
        await retireCommands(tx, choice.storeId, id);
      }
      await tx.runAsync(
        `INSERT INTO commercial_version_decisions(id,store_id,pair_key,payload_json,sync_state,dirty) VALUES(?,?,?,?,'PENDING',1) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,sync_state='PENDING',dirty=1`,
        id,
        choice.storeId,
        JSON.stringify(
          [choice.before.documentId, choice.after.documentId].sort(),
        ),
        JSON.stringify(choice),
      );
      await tx.runAsync(
        "INSERT INTO commercial_version_decision_history(action_id,decision_id,store_id,payload_json,action,created_at) VALUES(?,?,?,?,?,?)",
        ctx.commandId,
        id,
        choice.storeId,
        JSON.stringify(choice),
        "SAVE_REFERENCE",
        choice.updatedAt,
      );
      await new OutboxRepository(tx).enqueue({
        commandId: ctx.commandId,
        deviceId: ctx.deviceId,
        storeId: choice.storeId,
        commandType: "COMMERCIAL_VERSION_DECISION_UPSERT",
        entityType: "commercial_version_decision",
        entityId: id,
        expectedRemoteVersion: expected,
        payload: choice,
        createdAt: choice.updatedAt,
      });
    });
    return choice;
  }
  async resolve(
    conflictId: string,
    useLocal: boolean,
    ctx: { commandId: string; deviceId: string },
  ) {
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const conflict = await new ConflictRepository(tx).getById(conflictId);
      if (
        !conflict ||
        conflict.status !== "OPEN" ||
        conflict.entityType !== "commercial_version_decision"
      )
        throw Error("COMMERCIAL_VERSION_DECISION_RESOLUTION_INVALID");
      const row = await tx.getFirstAsync<Row>(
        "SELECT * FROM commercial_version_decisions WHERE id=? AND store_id=?",
        conflict.entityId,
        conflict.storeId,
      );
      if (!row) throw Error("COMMERCIAL_VERSION_DECISION_RESOLUTION_INVALID");
      const local = mapped(row).entity,
        parsed = commercialVersionDecisionSchema.safeParse(
          conflict.remotePayload,
        );
      const remote = parsed.success ? parsed.data : null;
      if (remote && !commercialVersionDecisionSameOriginalPair(local, remote))
        throw Error("COMMERCIAL_VERSION_DECISION_SOURCE_CHANGED");
      if (!useLocal && !remote)
        throw Error("COMMERCIAL_VERSION_DECISION_REMOTE_MISSING");
      const syncing = await tx.getFirstAsync<{ n: number }>(
        "SELECT COUNT(*) AS n FROM sync_outbox WHERE store_id=? AND entity_type='commercial_version_decision' AND entity_id=? AND status='SYNCING'",
        local.storeId,
        local.id,
      );
      if (syncing?.n) throw Error("COMMERCIAL_VERSION_DECISION_SYNCING");
      await retireCommands(tx, local.storeId, local.id);
      const now = new Date().toISOString();
      if (useLocal) {
        const pages = [
          ...(await readCommercialVisualReadings(
            tx,
            local.storeId,
            local.before.documentId,
          )),
          ...(await readCommercialVisualReadings(
            tx,
            local.storeId,
            local.after.documentId,
          )),
        ];
        if (!commercialVersionDecisionSourcesValid(local, pages))
          throw Error("COMMERCIAL_VERSION_DECISION_SOURCE_INVALID");
      }
      const resolved = useLocal
        ? commercialVersionDecisionSchema.parse({
            ...local,
            ...(remote
              ? {
                  before: remote.before,
                  after: remote.after,
                  preference:
                    (local.preference === "KEEP_PREVIOUS"
                      ? local.before.documentId
                      : local.after.documentId) === remote.before.documentId
                      ? "KEEP_PREVIOUS"
                      : "PREFER_NEW",
                }
              : {}),
            createdAt: remote?.createdAt ?? local.createdAt,
            version: (remote?.version ?? 0) + 1,
            updatedAt: now,
          })
        : remote!;
      if (useLocal) {
        const pages = [
          ...(await readCommercialVisualReadings(
            tx,
            resolved.storeId,
            resolved.before.documentId,
          )),
          ...(await readCommercialVisualReadings(
            tx,
            resolved.storeId,
            resolved.after.documentId,
          )),
        ];
        if (!commercialVersionDecisionSourcesValid(resolved, pages))
          throw Error("COMMERCIAL_VERSION_DECISION_SOURCE_INVALID");
      }
      await tx.runAsync(
        "UPDATE commercial_version_decisions SET payload_json=?,remote_payload_json=?,remote_version=?,sync_state=?,dirty=? WHERE id=?",
        JSON.stringify(resolved),
        remote ? JSON.stringify(remote) : null,
        remote?.version ?? null,
        useLocal ? "PENDING" : "SYNCED",
        useLocal ? 1 : 0,
        local.id,
      );
      await tx.runAsync(
        "INSERT INTO commercial_version_decision_history(action_id,decision_id,store_id,payload_json,action,created_at) VALUES(?,?,?,?,?,?)",
        ctx.commandId,
        local.id,
        local.storeId,
        JSON.stringify(local),
        useLocal ? "RESOLVE_LOCAL" : "RESOLVE_REMOTE",
        now,
      );
      await tx.runAsync(
        "UPDATE sync_conflicts SET status=?,resolved_at=? WHERE store_id=? AND entity_type='commercial_version_decision' AND entity_id=? AND status='OPEN'",
        useLocal ? "RESOLVED_LOCAL" : "RESOLVED_REMOTE",
        now,
        local.storeId,
        local.id,
      );
      if (useLocal)
        await new OutboxRepository(tx).enqueue({
          commandId: ctx.commandId,
          deviceId: ctx.deviceId,
          storeId: local.storeId,
          commandType: "COMMERCIAL_VERSION_DECISION_UPSERT",
          entityType: "commercial_version_decision",
          entityId: local.id,
          expectedRemoteVersion: remote?.version ?? null,
          payload: resolved,
          createdAt: now,
        });
    });
  }
}
async function retireCommands(tx: OutboxDatabase, storeId: string, id: string) {
  await tx.runAsync(
    "UPDATE sync_outbox SET status='FAILED',last_error_code='COMMERCIAL_VERSION_DECISION_SUPERSEDED' WHERE store_id=? AND entity_type='commercial_version_decision' AND entity_id=? AND status IN ('PENDING','CONFLICT','FAILED')",
    storeId,
    id,
  );
}
