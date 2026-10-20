import {
  layoutIllustrationPreparationSchema,
  sameLayoutIllustrationPreparation,
  readStoreLayoutScenarioCard,
  type LayoutIllustrationPreparation,
  type CopilotMessage,
} from "@fl-copilot/domain";
import { bindLayoutIllustrationSource } from "@fl-copilot/commercial-core";
import {
  OutboxRepository,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import {
  joinedMutationDatabase,
  type AtomicMutationDatabase,
} from "../sync/atomic-local-mutation";
import { verifyPrivateToolRecord } from "./private-tool-record";
import { CopilotStoreLayoutScenarioReader } from "./store-layout-scenario-reader";
import { StoreLayoutRepository } from "../store/layout-repository";
type Scope = { storeId: string; ownerId: string };
type Row = {
  store_id: string;
  owner_id: string;
  payload_json: string;
  dirty: number;
};
export async function applyLayoutIllustrationRecord(
  db: OutboxDatabase,
  scope: Scope,
  raw: unknown,
  ackVersion?: number,
) {
  const e = layoutIllustrationPreparationSchema.parse(raw);
  if (e.storeId !== scope.storeId || e.ownerId !== scope.ownerId)
    throw Error("LAYOUT_ILLUSTRATION_SCOPE_INVALID");
  const old = await db.getFirstAsync<Row>(
    "SELECT * FROM copilot_layout_illustrations WHERE id=?",
    e.id,
  );
  if (
    old &&
    (old.store_id !== scope.storeId ||
      old.owner_id !== scope.ownerId ||
      !sameLayoutIllustrationPreparation(
        layoutIllustrationPreparationSchema.parse(JSON.parse(old.payload_json)),
        e,
      ))
  )
    throw Error("LAYOUT_ILLUSTRATION_IMMUTABLE");
  if (old?.dirty && ackVersion === undefined) {
    await db.runAsync(
      "UPDATE copilot_layout_illustrations SET remote_payload_json=?,remote_version=1 WHERE id=?",
      JSON.stringify(e),
      e.id,
    );
    return;
  }
  if (ackVersion !== undefined && ackVersion !== 1)
    throw Error("LAYOUT_ILLUSTRATION_VERSION_INVALID");
  await db.runAsync(
    "INSERT INTO copilot_layout_illustrations(id,store_id,owner_id,conversation_id,payload_json,remote_payload_json,remote_version,sync_state,dirty) VALUES(?,?,?,?,?,?,1,'SYNCED',0) ON CONFLICT(id) DO UPDATE SET remote_payload_json=excluded.remote_payload_json,remote_version=1,sync_state='SYNCED',dirty=0",
    e.id,
    e.storeId,
    e.ownerId,
    e.conversationId,
    JSON.stringify(e),
    JSON.stringify(e),
  );
}
/** One deliberate, unpaid local preparation and its Outbox command commit together. */
export class LayoutIllustrationRepository {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private scope: Scope & { canPrepare: boolean },
    private digest: (text: string) => Promise<string>,
    private now = () => new Date().toISOString(),
  ) {}
  async prepare(
    rawCard: CopilotMessage,
    ids: { id: string; commandId: string; deviceId: string },
    signal?: AbortSignal,
  ) {
    let result: LayoutIllustrationPreparation | undefined;
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const check = () => {
        if (signal?.aborted) throw Error("LAYOUT_ILLUSTRATION_CANCELLED");
      };
      check();
      if (!this.scope.canPrepare) throw Error("LAYOUT_ILLUSTRATION_FORBIDDEN");
      const { message, content } = readStoreLayoutScenarioCard(rawCard);
      await verifyPrivateToolRecord(
        tx,
        this.scope,
        message,
        content.assistantMessageId,
      );
      const joined = joinedMutationDatabase(tx),
        layout = await new StoreLayoutRepository(joined, () => {
          throw Error("READ_ONLY");
        }).getRevision(this.scope.storeId, content.scenario.physicalRevisionId);
      if (!layout) throw Error("LAYOUT_ILLUSTRATION_SOURCE_PENDING");
      const scope = {
        storeId: this.scope.storeId,
        ownerId: this.scope.ownerId,
        conversationId: message.conversationId,
      };
      const { binding, source } = await bindLayoutIllustrationSource(
        scope,
        message,
        layout,
        this.digest,
      );
      const old = await tx.getFirstAsync<Row>(
        "SELECT * FROM copilot_layout_illustrations WHERE id=?",
        ids.id,
      );
      const prior = old
        ? layoutIllustrationPreparationSchema.parse(
            JSON.parse(old.payload_json),
          )
        : null;
      const { schemaVersion, ...fields } = binding;
      void schemaVersion;
      const e = layoutIllustrationPreparationSchema.parse({
        ...fields,
        id: ids.id,
        intent: "PREPARATION_ONLY",
        version: 1,
        createdAt: prior?.createdAt ?? this.now(),
      });
      if (old) {
        if (
          old.store_id !== scope.storeId ||
          old.owner_id !== scope.ownerId ||
          !sameLayoutIllustrationPreparation(prior!, e)
        )
          throw Error("LAYOUT_ILLUSTRATION_IMMUTABLE");
        result = prior!;
        return;
      }
      const identical = await tx.getFirstAsync<Row>(
        "SELECT * FROM copilot_layout_illustrations WHERE store_id=? AND owner_id=? AND conversation_id=? AND json_extract(payload_json,'$.scenarioMessageId')=? AND json_extract(payload_json,'$.scenarioHash')=? AND json_extract(payload_json,'$.physicalHash')=? ORDER BY id LIMIT 1",
        scope.storeId,
        scope.ownerId,
        scope.conversationId,
        e.scenarioMessageId,
        e.scenarioHash,
        e.physicalHash,
      );
      if (identical) {
        result = layoutIllustrationPreparationSchema.parse(
          JSON.parse(identical.payload_json),
        );
        return;
      }
      const fresh = await new CopilotStoreLayoutScenarioReader(
        joined,
        this.scope,
      ).open(message);
      if (fresh.freshness !== "CURRENT")
        throw Error("LAYOUT_ILLUSTRATION_REVIEW_REQUIRED");
      if (source.status !== "READY")
        throw Error("LAYOUT_ILLUSTRATION_NOT_READY");
      check();
      await tx.runAsync(
        "INSERT INTO copilot_layout_illustrations(id,store_id,owner_id,conversation_id,payload_json,sync_state,dirty) VALUES(?,?,?,?,?,'PENDING',1)",
        e.id,
        e.storeId,
        e.ownerId,
        e.conversationId,
        JSON.stringify(e),
      );
      await new OutboxRepository(tx, this.now).enqueue({
        commandId: ids.commandId,
        deviceId: ids.deviceId,
        storeId: e.storeId,
        commandType: "COPILOT_LAYOUT_ILLUSTRATION_PREPARE",
        entityType: "copilot_layout_illustration",
        entityId: e.id,
        expectedRemoteVersion: null,
        payload: e,
      });
      check();
      result = e;
    });
    if (!result) throw Error("LAYOUT_ILLUSTRATION_UNAVAILABLE");
    return result;
  }
  async find(rawCard: CopilotMessage): Promise<{
    entity: LayoutIllustrationPreparation;
    syncState: string;
  } | null> {
    let result: {
      entity: LayoutIllustrationPreparation;
      syncState: string;
    } | null = null;
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const { message, content } = readStoreLayoutScenarioCard(rawCard);
      await verifyPrivateToolRecord(
        tx,
        this.scope,
        message,
        content.assistantMessageId,
      );
      const row = await tx.getFirstAsync<Row & { sync_state: string }>(
        "SELECT * FROM copilot_layout_illustrations WHERE store_id=? AND owner_id=? AND conversation_id=? AND json_extract(payload_json,'$.scenarioMessageId')=? ORDER BY id LIMIT 1",
        this.scope.storeId,
        this.scope.ownerId,
        message.conversationId,
        message.id,
      );
      if (row)
        result = {
          entity: layoutIllustrationPreparationSchema.parse(
            JSON.parse(row.payload_json),
          ),
          syncState: row.sync_state,
        };
    });
    return result;
  }
}
