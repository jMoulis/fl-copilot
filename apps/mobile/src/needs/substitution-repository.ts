import {
  productSubstitutionId,
  sameSubstitutionIdentity,
  sameSubstitutionLearning,
} from "@fl-copilot/domain";
import {
  productSubstitutionSchema,
  type ProductSubstitution,
} from "@fl-copilot/sync-contracts";
const sameIdentity = sameSubstitutionIdentity;
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import {
  OutboxRepository,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import { ConflictRepository } from "../sync/conflict-repository";

type Row = {
  id: string;
  store_id: string;

  payload_json: string;
  remote_payload_json: string | null;
  remote_version: number | null;
  sync_state: string;
  dirty: number;
  last_error_code?: string | null;
};
export type LocalProductSubstitution = {
  entity: ProductSubstitution;
  syncState: string;
  remoteVersion: number | null;
  remote: ProductSubstitution | null;
  lastErrorCode: string | null;
};
function mapped(row: Row): LocalProductSubstitution {
  return {
    entity: productSubstitutionSchema.parse(JSON.parse(row.payload_json)),
    syncState: row.sync_state,
    remoteVersion: row.remote_version,
    lastErrorCode: row.last_error_code ?? null,
    remote: row.remote_payload_json
      ? productSubstitutionSchema.parse(JSON.parse(row.remote_payload_json))
      : null,
  };
}
export async function applyProductSubstitution(
  db: OutboxDatabase,
  storeId: string,
  payload: unknown,
  ackVersion?: number,
) {
  const choice = productSubstitutionSchema.parse(payload);
  if (choice.storeId !== storeId)
    throw Error("PRODUCT_SUBSTITUTION_STORE_INVALID");
  const previous = await db.getFirstAsync<Row>(
    "SELECT * FROM product_substitutions WHERE id=?",
    choice.id,
  );
  if (previous && previous.store_id !== storeId)
    throw Error("PRODUCT_SUBSTITUTION_STORE_INVALID");
  const local = previous ? mapped(previous) : null;
  if (
    local &&
    !sameIdentity({ ...local.entity, createdAt: choice.createdAt }, choice)
  )
    throw Error("PRODUCT_SUBSTITUTION_IDENTITY_CHANGED");

  if (
    previous?.dirty &&
    (ackVersion === undefined || local!.entity.version !== ackVersion)
  ) {
    if (!local!.remote || choice.version >= local!.remote.version)
      await db.runAsync(
        "UPDATE product_substitutions SET remote_payload_json=?,remote_version=CASE WHEN ? IS NULL THEN remote_version ELSE MAX(COALESCE(remote_version,0),?) END WHERE id=?",
        JSON.stringify(choice),
        ackVersion ?? null,
        choice.version,
        choice.id,
      );
    return;
  }
  if (local && (local.remoteVersion ?? 0) > choice.version) return;
  await db.runAsync(
    `INSERT INTO product_substitutions(id,store_id,source_product_id,substitute_product_id,need_unit_id,payload_json,remote_payload_json,remote_version,sync_state,dirty) VALUES(?,?,?,?,?,?,?,?,'SYNCED',0) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,remote_payload_json=excluded.remote_payload_json,remote_version=excluded.remote_version,sync_state='SYNCED',dirty=0`,
    choice.id,
    storeId,
    choice.sourceProductId,
    choice.substituteProductId,
    choice.needUnitId,
    JSON.stringify(choice),
    JSON.stringify(choice),
    choice.version,
  );
}
export class ProductSubstitutionRepository {
  constructor(
    private db: AtomicMutationDatabase & OutboxDatabase,
    private digest: (s: string) => Promise<string>,
  ) {}
  async list(storeId: string) {
    const rows = await this.db.getAllAsync<Row>(
      "SELECT p.*,(SELECT last_error_code FROM sync_outbox o WHERE o.store_id=p.store_id AND o.entity_id=p.id AND o.entity_type='product_substitution' ORDER BY local_sequence DESC LIMIT 1) AS last_error_code FROM product_substitutions p WHERE p.store_id=? ORDER BY json_extract(p.payload_json,'$.sourceProductId')",
      storeId,
    );
    return rows.map(mapped);
  }
  async forSource(storeId: string, productId: string) {
    const rows = await this.db.getAllAsync<Row>(
      "SELECT p.* FROM product_substitutions p WHERE p.store_id=? AND p.source_product_id=? ORDER BY id",
      storeId,
      productId,
    );
    return rows.map(mapped);
  }
  async get(storeId: string, id: string) {
    const row = await this.db.getFirstAsync<Row>(
      "SELECT p.*,(SELECT last_error_code FROM sync_outbox o WHERE o.store_id=p.store_id AND o.entity_id=p.id AND o.entity_type='product_substitution' ORDER BY local_sequence DESC LIMIT 1) AS last_error_code FROM product_substitutions p WHERE p.store_id=? AND p.id=?",
      storeId,
      id,
    );
    return row ? mapped(row) : null;
  }
  async save(
    input: ProductSubstitution,
    ctx: { commandId: string; deviceId: string },
  ) {
    const choice = productSubstitutionSchema.parse(input),
      id = choice.id;
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const row = await tx.getFirstAsync<Row>(
          "SELECT * FROM product_substitutions WHERE id=? AND store_id=?",
          id,
          choice.storeId,
        ),
        previous = row ? mapped(row) : null;
      const foreign = await tx.getFirstAsync<{ store_id: string }>(
        "SELECT store_id FROM product_substitutions WHERE id=?",
        id,
      );
      if (foreign && foreign.store_id !== choice.storeId)
        throw Error("PRODUCT_SUBSTITUTION_STORE_INVALID");
      if (
        id !==
        (await productSubstitutionId(
          choice.storeId,
          choice.sourceProductId,
          choice.substituteProductId,
          choice.needUnitId,
          this.digest,
        ))
      )
        throw Error("PRODUCT_SUBSTITUTION_ID_INVALID");
      const product = await tx.getFirstAsync<{
        store_id: string;
        status: string;
        deleted_at: string | null;
      }>(
        "SELECT store_id,status,deleted_at FROM products WHERE id=?",
        choice.sourceProductId,
      );
      const substitute = await tx.getFirstAsync<{
        store_id: string;
        status: string;
        deleted_at: string | null;
      }>(
        "SELECT store_id,status,deleted_at FROM products WHERE id=?",
        choice.substituteProductId,
      );
      const need = await tx.getFirstAsync<{
        store_id: string;
        payload_json: string;
      }>(
        "SELECT store_id,payload_json FROM need_units WHERE id=?",
        choice.needUnitId,
      );
      if (
        !product ||
        !substitute ||
        !need ||
        product.store_id !== choice.storeId ||
        substitute.store_id !== choice.storeId ||
        need.store_id !== choice.storeId
      )
        throw Error("PRODUCT_SUBSTITUTION_PARENT_INVALID");
      const needStatus = (JSON.parse(need.payload_json) as { status: string })
        .status;
      if (
        choice.status !== "REJECTED" &&
        (product.deleted_at ||
          substitute.deleted_at ||
          substitute.status === "INACTIVE" ||
          product.status === "INACTIVE" ||
          needStatus === "INACTIVE" ||
          (choice.status === "VALIDATED" &&
            (product.status !== "ACTIVE" ||
              substitute.status !== "ACTIVE" ||
              needStatus !== "ACTIVE")))
      )
        throw Error("PRODUCT_SUBSTITUTION_PARENT_INACTIVE");
      if (
        previous &&
        !choice.humanConfirmed &&
        previous.entity.status !== "PROPOSED"
      )
        throw Error("PRODUCT_SUBSTITUTION_HUMAN_DECISION_REQUIRED");
      if (previous && previous.entity.source !== choice.source)
        throw Error("PRODUCT_SUBSTITUTION_IDENTITY_CHANGED");
      if (
        (previous &&
          (!sameSubstitutionLearning(previous.entity, choice) ||
            (choice.status === "LEARNING" &&
              previous.entity.status !== "LEARNING"))) ||
        (!previous &&
          (choice.evidenceCount !== 0 || choice.status === "LEARNING"))
      )
        throw Error("PRODUCT_SUBSTITUTION_LEARNING_READ_ONLY");
      if (!previous && choice.source === "LEARNED")
        throw Error("PRODUCT_SUBSTITUTION_ORIGIN_INVALID");
      if (row?.sync_state === "CONFLICT")
        throw Error("PRODUCT_SUBSTITUTION_RESOLVE_REQUIRED");
      const expected =
        row?.sync_state === "ERROR"
          ? row.remote_version
          : (previous?.entity.version ?? null);
      if (
        choice.version !== (expected ?? 0) + 1 ||
        (previous &&
          (!sameIdentity(previous.entity, choice) ||
            previous.entity.createdAt !== choice.createdAt))
      )
        throw Error("PRODUCT_SUBSTITUTION_REVISION_INVALID");
      if (row?.sync_state === "ERROR") {
        const pending = await tx.getFirstAsync<{ n: number }>(
          "SELECT COUNT(*) AS n FROM sync_outbox WHERE entity_type='product_substitution' AND entity_id=? AND status='SYNCING'",
          id,
        );
        if (pending?.n) throw Error("PRODUCT_SUBSTITUTION_SYNCING");
        await retireCommands(tx, choice.storeId, id);
      }
      await tx.runAsync(
        `INSERT INTO product_substitutions(id,store_id,source_product_id,substitute_product_id,need_unit_id,payload_json,sync_state,dirty) VALUES(?,?,?,?,?,?,'PENDING',1) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,sync_state='PENDING',dirty=1`,
        id,
        choice.storeId,
        choice.sourceProductId,
        choice.substituteProductId,
        choice.needUnitId,
        JSON.stringify(choice),
      );
      await tx.runAsync(
        "INSERT INTO product_substitution_history(action_id,substitution_id,store_id,payload_json,action,created_at) VALUES(?,?,?,?,?,?)",
        ctx.commandId,
        id,
        choice.storeId,
        JSON.stringify(choice),
        "SAVE_PRODUCT_SUBSTITUTION",
        choice.updatedAt,
      );
      await new OutboxRepository(tx).enqueue({
        commandId: ctx.commandId,
        deviceId: ctx.deviceId,
        storeId: choice.storeId,
        commandType: "PRODUCT_SUBSTITUTION_UPSERT",
        entityType: "product_substitution",
        entityId: id,
        expectedRemoteVersion: expected,
        payload: choice,
        createdAt: choice.updatedAt,
      });
    });
    return choice;
  }
  async saveBatch(
    values: ProductSubstitution[],
    ctx: { deviceId: string; commandIds: string[] },
  ) {
    if (values.length !== ctx.commandIds.length || values.length > 100)
      throw Error("PRODUCT_SUBSTITUTION_BATCH_INVALID");
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const nested = {
        runAsync: (s: string, ...p: Array<string | number | null>) =>
          tx.runAsync(s, ...p),
        getFirstAsync: <T>(s: string, ...p: Array<string | number | null>) =>
          tx.getFirstAsync<T>(s, ...p),
        getAllAsync: <T>(s: string, ...p: Array<string | number | null>) =>
          tx.getAllAsync<T>(s, ...p),
        withExclusiveTransactionAsync: (
          task: (db: OutboxDatabase) => Promise<void>,
        ) => task(tx),
      };
      const repo = new ProductSubstitutionRepository(nested, this.digest);
      for (let i = 0; i < values.length; i++)
        await repo.save(values[i]!, {
          deviceId: ctx.deviceId,
          commandId: ctx.commandIds[i]!,
        });
    });
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
        conflict.entityType !== "product_substitution"
      )
        throw Error("PRODUCT_SUBSTITUTION_RESOLUTION_INVALID");
      const row = await tx.getFirstAsync<Row>(
        "SELECT * FROM product_substitutions WHERE id=? AND store_id=?",
        conflict.entityId,
        conflict.storeId,
      );
      if (!row) throw Error("PRODUCT_SUBSTITUTION_RESOLUTION_INVALID");
      const local = mapped(row).entity,
        parsed = productSubstitutionSchema.safeParse(conflict.remotePayload);
      const remote = parsed.success ? parsed.data : null;
      if (
        remote &&
        !sameIdentity({ ...local, createdAt: remote.createdAt }, remote)
      )
        throw Error("PRODUCT_SUBSTITUTION_SOURCE_CHANGED");
      if (!useLocal && !remote)
        throw Error("PRODUCT_SUBSTITUTION_REMOTE_MISSING");
      const syncing = await tx.getFirstAsync<{ n: number }>(
        "SELECT COUNT(*) AS n FROM sync_outbox WHERE store_id=? AND entity_type='product_substitution' AND entity_id=? AND status='SYNCING'",
        local.storeId,
        local.id,
      );
      if (syncing?.n) throw Error("PRODUCT_SUBSTITUTION_SYNCING");
      await retireCommands(tx, local.storeId, local.id);
      const now = new Date().toISOString();
      const resolved = useLocal
        ? productSubstitutionSchema.parse({
            ...local,
            ...(remote
              ? {
                  observedSubstitution: remote.observedSubstitution,
                  relationshipScore: remote.relationshipScore,
                  confidence: remote.confidence,
                  evidenceCount: remote.evidenceCount,
                  lastEvidenceAt: remote.lastEvidenceAt,
                }
              : {}),
            createdAt: remote?.createdAt ?? local.createdAt,
            humanConfirmed: true,
            source: remote?.source ?? local.source,
            version: (remote?.version ?? 0) + 1,
            updatedAt: now,
          })
        : remote!;
      await tx.runAsync(
        "UPDATE product_substitutions SET payload_json=?,remote_payload_json=?,remote_version=?,sync_state=?,dirty=? WHERE id=?",
        JSON.stringify(resolved),
        remote ? JSON.stringify(remote) : null,
        remote?.version ?? null,
        useLocal ? "PENDING" : "SYNCED",
        useLocal ? 1 : 0,
        local.id,
      );
      await tx.runAsync(
        "INSERT INTO product_substitution_history(action_id,substitution_id,store_id,payload_json,action,created_at) VALUES(?,?,?,?,?,?)",
        ctx.commandId,
        local.id,
        local.storeId,
        JSON.stringify(local),
        useLocal ? "RESOLVE_LOCAL" : "RESOLVE_REMOTE",
        now,
      );
      await tx.runAsync(
        "UPDATE sync_conflicts SET status=?,resolved_at=? WHERE store_id=? AND entity_type='product_substitution' AND entity_id=? AND status='OPEN'",
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
          commandType: "PRODUCT_SUBSTITUTION_UPSERT",
          entityType: "product_substitution",
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
    "UPDATE sync_outbox SET status='FAILED',last_error_code='PRODUCT_SUBSTITUTION_SUPERSEDED' WHERE store_id=? AND entity_type='product_substitution' AND entity_id=? AND status IN ('PENDING','CONFLICT','FAILED')",
    storeId,
    id,
  );
}
