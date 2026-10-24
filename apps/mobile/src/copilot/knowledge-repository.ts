import {
  copilotKnowledgeSchema,
  copilotMessageSchema,
  type CopilotKnowledge,
} from "@fl-copilot/domain";
import {
  OutboxRepository,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import {
  ConflictRepository,
  reviewConflictVersions,
} from "../sync/conflict-repository";
type Scope = { storeId: string; ownerId: string };
type Row = {
  id: string;
  store_id: string;
  owner_id: string;
  payload_json: string;
  remote_payload_json: string | null;
  remote_version: number | null;
  sync_state: string;
  dirty: number;
};
function scoped(e: Scope, s: Scope) {
  if (e.storeId !== s.storeId || e.ownerId !== s.ownerId)
    throw Error("COPILOT_KNOWLEDGE_SCOPE_INVALID");
}
const same = (a: CopilotKnowledge, b: CopilotKnowledge) =>
  a.id === b.id &&
  a.createdAt === b.createdAt &&
  a.sourceMessageId === b.sourceMessageId &&
  a.ownerId === b.ownerId &&
  a.storeId === b.storeId;
export type KnowledgeResolutionContext = {
  storeId: string;
  ownerId: string;
  commandId: string;
  deviceId: string;
  reviewHash: string;
  reviewCaptureId: string;
  canResolve: () => boolean;
  signal?: AbortSignal;
  reactivateForgotten?: boolean;
};
/** Private memory comparison only; missing remote data never grants creation. */
export async function readKnowledgeConflictReview(
  db: OutboxDatabase,
  scope: Scope,
  id: string,
  digest: (s: string) => Promise<string>,
) {
  const row = await db.getFirstAsync<Row>(
    "SELECT * FROM copilot_knowledge WHERE id=? AND store_id=? AND owner_id=?",
    id,
    scope.storeId,
    scope.ownerId,
  );
  if (!row) throw Error("COPILOT_KNOWLEDGE_REVIEW_REQUIRED");
  const local = copilotKnowledgeSchema.parse(JSON.parse(row.payload_json));
  scoped(local, scope);
  if (local.id !== id || row.id !== id)
    throw Error("COPILOT_KNOWLEDGE_IDENTITY_INVALID");
  const parsed = row.remote_payload_json
      ? copilotKnowledgeSchema.safeParse(JSON.parse(row.remote_payload_json))
      : null,
    cached = parsed?.success ? parsed.data : null,
    cacheValid =
      !!cached && same(local, cached) && cached.version === row.remote_version,
    current = {
      entity: local,
      syncState: row.sync_state,
      remoteVersion: row.remote_version,
    },
    conflicts = await new ConflictRepository(db).listOpenForEntity(
      scope.storeId,
      "copilot_knowledge",
      id,
    ),
    group = conflicts.length
      ? reviewConflictVersions(
          conflicts,
          (raw) => {
            const p = copilotKnowledgeSchema.safeParse(raw);
            return p.success ? p.data : null;
          },
          (candidate) => same(local, candidate),
          cached,
        )
      : {
          conflicts,
          conflict: null,
          remote: cacheValid ? cached : null,
          valid: cacheValid,
          reason: cacheValid
            ? null
            : "La version distante de cette pratique n’est pas vérifiée. Votre saisie est conservée ; aucun nouvel envoi ni retour en version 1 n’est proposé.",
        },
    remote = group.remote,
    commands = await db.getAllAsync<{
      command_id: string;
      status: string;
      payload_json: string;
      expected_remote_version: number | null;
      last_error_code: string | null;
    }>(
      "SELECT command_id,status,payload_json,expected_remote_version,last_error_code FROM sync_outbox WHERE store_id=? AND entity_type='copilot_knowledge' AND entity_id=? AND status IN ('PENDING','SYNCING','CONFLICT','FAILED') ORDER BY local_sequence LIMIT 101",
      scope.storeId,
      id,
    );
  const ownedPayload = (raw: unknown) =>
    !!raw &&
    typeof raw === "object" &&
    "id" in raw &&
    "storeId" in raw &&
    "ownerId" in raw &&
    raw.id === id &&
    raw.storeId === scope.storeId &&
    raw.ownerId === scope.ownerId;
  const commandsOwned = commands.every((command) => {
      try {
        return ownedPayload(JSON.parse(command.payload_json));
      } catch {
        return false;
      }
    }),
    cohortOwned = conflicts.every((c) => ownedPayload(c.localPayload)),
    ready =
      ["CONFLICT", "ERROR"].includes(row.sync_state) &&
      group.valid &&
      !!remote &&
      (row.remote_version ?? 0) <= remote.version &&
      (!row.remote_payload_json || cacheValid) &&
      commandsOwned &&
      cohortOwned &&
      commands.length <= 100 &&
      !commands.some((c) => c.status === "SYNCING"),
    reason =
      group.reason ??
      (!commandsOwned || !cohortOwned
        ? "Les références privées de la comparaison ne correspondent pas au compte actuel. Aucune version n’est réaffectée."
        : !ready
          ? "La comparaison a changé, un envoi est en cours ou son historique dépasse la limite. Relisez les versions avant de décider."
          : null),
    hash = await digest(JSON.stringify({ scope, id, row, group, commands }));
  return {
    current,
    group,
    hash,
    ready,
    reason,
    canKeepLocal: ready,
    canAdoptRemote: ready,
    reactivateLocal:
      !!remote && local.status === "ACTIVE" && remote.status === "FORGOTTEN",
    reactivateRemote:
      !!remote && local.status === "FORGOTTEN" && remote.status === "ACTIVE",
  };
}
export async function applyKnowledgeRecord(
  db: OutboxDatabase,
  scope: Scope,
  payload: unknown,
  ackVersion?: number,
) {
  const e = copilotKnowledgeSchema.parse(payload);
  scoped(e, scope);
  const old = await db.getFirstAsync<Row>(
    "SELECT * FROM copilot_knowledge WHERE id=?",
    e.id,
  );
  if (old) {
    scoped({ storeId: old.store_id, ownerId: old.owner_id }, scope);
    if (!same(copilotKnowledgeSchema.parse(JSON.parse(old.payload_json)), e))
      throw Error("COPILOT_KNOWLEDGE_IDENTITY_INVALID");
  }
  if (
    old?.dirty &&
    (ackVersion === undefined ||
      JSON.parse(old.payload_json).version !== ackVersion)
  ) {
    if ((old.remote_version ?? 0) <= e.version)
      await db.runAsync(
        "UPDATE copilot_knowledge SET remote_payload_json=?,remote_version=? WHERE id=?",
        JSON.stringify(e),
        e.version,
        e.id,
      );
    return;
  }
  if (old && (old.remote_version ?? 0) > e.version) return;
  await db.runAsync(
    "INSERT INTO copilot_knowledge(id,store_id,owner_id,payload_json,remote_payload_json,remote_version,sync_state,dirty) VALUES(?,?,?,?,?,?,'SYNCED',0) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,remote_payload_json=excluded.remote_payload_json,remote_version=excluded.remote_version,sync_state='SYNCED',dirty=0",
    e.id,
    e.storeId,
    e.ownerId,
    JSON.stringify(e),
    JSON.stringify(e),
    e.version,
  );
}
export class CopilotKnowledgeRepository {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private scope: Scope,
    private digest: (s: string) => Promise<string> = async () => {
      throw Error("COPILOT_KNOWLEDGE_DIGEST_REQUIRED");
    },
  ) {}
  review(id: string) {
    return readKnowledgeConflictReview(this.db, this.scope, id, this.digest);
  }
  async list() {
    return (
      await this.db.getAllAsync<Row>(
        "SELECT * FROM copilot_knowledge WHERE store_id=? AND owner_id=? ORDER BY json_extract(payload_json,'$.updatedAt') DESC,id",
        this.scope.storeId,
        this.scope.ownerId,
      )
    ).map((r) => ({
      entity: copilotKnowledgeSchema.parse(JSON.parse(r.payload_json)),
      syncState: r.sync_state,
      remote: r.remote_payload_json
        ? copilotKnowledgeSchema.parse(JSON.parse(r.remote_payload_json))
        : null,
    }));
  }
  async source(id: string) {
    const r = await this.db.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM copilot_messages WHERE id=? AND store_id=? AND owner_id=?",
      id,
      this.scope.storeId,
      this.scope.ownerId,
    );
    if (!r) throw Error("COPILOT_KNOWLEDGE_SOURCE_UNAVAILABLE");
    const m = copilotMessageSchema.parse(JSON.parse(r.payload_json));
    scoped(m, this.scope);
    if (m.role !== "USER") throw Error("COPILOT_KNOWLEDGE_SOURCE_UNAVAILABLE");
    return m;
  }
  async save(
    raw: CopilotKnowledge,
    ctx: { commandId: string; deviceId: string },
  ) {
    const e = copilotKnowledgeSchema.parse(raw);
    scoped(e, this.scope);
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const row = await tx.getFirstAsync<Row>(
        "SELECT * FROM copilot_knowledge WHERE id=?",
        e.id,
      );
      if (row)
        scoped({ storeId: row.store_id, ownerId: row.owner_id }, this.scope);
      const before = row
        ? copilotKnowledgeSchema.parse(JSON.parse(row.payload_json))
        : null;
      if (row && ["CONFLICT", "ERROR"].includes(row.sync_state))
        throw Error("COPILOT_KNOWLEDGE_REVIEW_REQUIRED");
      if (
        e.version !== (before?.version ?? 0) + 1 ||
        (before && !same(before, e))
      )
        throw Error("COPILOT_KNOWLEDGE_REVISION_INVALID");
      if (
        !before &&
        (await tx.getFirstAsync<{ n: number }>(
          "SELECT COUNT(*) AS n FROM copilot_knowledge WHERE store_id=? AND owner_id=?",
          e.storeId,
          e.ownerId,
        ))!.n >= 200
      )
        throw Error("COPILOT_KNOWLEDGE_LIMIT");
      if (e.sourceMessageId && !before) {
        const source = await tx.getFirstAsync<{ payload_json: string }>(
          "SELECT payload_json FROM copilot_messages WHERE id=? AND store_id=? AND owner_id=?",
          e.sourceMessageId,
          e.storeId,
          e.ownerId,
        );
        if (!source) throw Error("COPILOT_KNOWLEDGE_SOURCE_UNAVAILABLE");
        const message = copilotMessageSchema.parse(
          JSON.parse(source.payload_json),
        );
        scoped(message, this.scope);
        if (message.id !== e.sourceMessageId || message.role !== "USER")
          throw Error("COPILOT_KNOWLEDGE_SOURCE_UNAVAILABLE");
      }
      await tx.runAsync(
        "INSERT INTO copilot_knowledge(id,store_id,owner_id,payload_json,sync_state,dirty) VALUES(?,?,?,?,'PENDING',1) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,sync_state='PENDING',dirty=1",
        e.id,
        e.storeId,
        e.ownerId,
        JSON.stringify(e),
      );
      await new OutboxRepository(tx).enqueue({
        commandId: ctx.commandId,
        deviceId: ctx.deviceId,
        storeId: e.storeId,
        commandType: "COPILOT_KNOWLEDGE_UPSERT",
        entityType: "copilot_knowledge",
        entityId: e.id,
        expectedRemoteVersion: before?.version ?? null,
        payload: e,
        createdAt: e.updatedAt,
      });
    });
  }
  async resolve(
    id: string,
    useLocal: boolean,
    ctx: KnowledgeResolutionContext,
  ) {
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const current = () =>
        ctx.canResolve() &&
        !ctx.signal?.aborted &&
        this.scope.storeId === ctx.storeId &&
        this.scope.ownerId === ctx.ownerId;
      if (!current()) throw Error("COPILOT_KNOWLEDGE_FORBIDDEN");
      if (!ctx.reviewCaptureId || ctx.reviewCaptureId === ctx.commandId)
        throw Error("COPILOT_KNOWLEDGE_CAPTURE_ID_INVALID");
      const review = await readKnowledgeConflictReview(
          tx,
          this.scope,
          id,
          this.digest,
        ),
        local = review.current.entity,
        remote = review.group.remote;
      if (!current()) throw Error("COPILOT_KNOWLEDGE_FORBIDDEN");
      if (!review.ready || !remote || review.hash !== ctx.reviewHash)
        throw Error("COPILOT_KNOWLEDGE_REVIEW_CHANGED");
      if (
        (useLocal ? review.reactivateLocal : review.reactivateRemote) &&
        !ctx.reactivateForgotten
      )
        throw Error("COPILOT_KNOWLEDGE_REACTIVATION_REQUIRED");
      const now = new Date().toISOString(),
        resolved = useLocal
          ? copilotKnowledgeSchema.parse({
              ...local,
              version: remote.version + 1,
              updatedAt: now,
            })
          : remote;
      await tx.runAsync(
        "UPDATE sync_outbox SET status='FAILED',last_error_code='COPILOT_KNOWLEDGE_SUPERSEDED' WHERE store_id=? AND entity_type='copilot_knowledge' AND entity_id=? AND status IN ('PENDING','CONFLICT','FAILED')",
        local.storeId,
        id,
      );
      await tx.runAsync(
        "UPDATE copilot_knowledge SET payload_json=?,remote_payload_json=?,remote_version=?,sync_state=?,dirty=? WHERE id=?",
        JSON.stringify(resolved),
        JSON.stringify(remote),
        remote.version,
        useLocal ? "PENDING" : "SYNCED",
        useLocal ? 1 : 0,
        id,
      );
      // A resolved local comparison capture, not a fabricated server conflict.
      // It retains the current pair even when only a verified pull/cache supplied it.
      await tx.runAsync(
        "INSERT INTO sync_conflicts(id,store_id,command_id,entity_type,entity_id,local_payload_json,remote_payload_json,local_expected_version,remote_version,conflict_type,status,created_at,resolved_at) VALUES(?,?,NULL,'copilot_knowledge',?,?,?,?,?,'COPILOT_KNOWLEDGE_REVIEW_CAPTURE',?,?,?)",
        ctx.reviewCaptureId,
        local.storeId,
        id,
        JSON.stringify(local),
        JSON.stringify(remote),
        review.current.remoteVersion,
        remote.version,
        useLocal ? "RESOLVED_LOCAL" : "RESOLVED_REMOTE",
        now,
        now,
      );
      for (const conflict of review.group.conflicts)
        await tx.runAsync(
          "UPDATE sync_conflicts SET status=?,resolved_at=? WHERE id=? AND store_id=? AND status='OPEN'",
          useLocal ? "RESOLVED_LOCAL" : "RESOLVED_REMOTE",
          now,
          conflict.id,
          local.storeId,
        );
      if (useLocal)
        await new OutboxRepository(tx).enqueue({
          commandId: ctx.commandId,
          deviceId: ctx.deviceId,
          storeId: local.storeId,
          commandType: "COPILOT_KNOWLEDGE_UPSERT",
          entityType: "copilot_knowledge",
          entityId: id,
          expectedRemoteVersion: remote.version,
          payload: resolved,
          createdAt: now,
        });
      if (!current()) throw Error("COPILOT_KNOWLEDGE_FORBIDDEN");
    });
  }
}
