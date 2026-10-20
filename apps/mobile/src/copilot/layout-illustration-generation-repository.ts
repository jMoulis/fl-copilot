import {
  layoutIllustrationGenerationRecordSchema,
  layoutIllustrationGenerationDecisionSchema,
  layoutIllustrationQuoteSchema,
  sameLayoutIllustrationPreparation,
  readStoreLayoutScenarioCard,
  type CopilotMessage,
  type LayoutIllustrationGenerationRecord,
} from "@fl-copilot/domain";
import {
  OutboxRepository,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import {
  joinedMutationDatabase,
  type AtomicMutationDatabase,
} from "../sync/atomic-local-mutation";
import { LayoutIllustrationRepository } from "./layout-illustration-repository";
import { CopilotStoreLayoutScenarioReader } from "./store-layout-scenario-reader";
import { verifyPrivateToolRecord } from "./private-tool-record";
const TABLE = "copilot_layout_illustration_generations";
type Scope = { storeId: string; ownerId: string };
type Row = {
  store_id: string;
  owner_id: string;
  payload_json: string;
  remote_payload_json: string | null;
  remote_version: number | null;
  sync_state: string;
  dirty: number;
};
export async function applyIllustrationGenerationRecord(
  db: OutboxDatabase,
  scope: Scope,
  raw: unknown,
  ackVersion?: number,
) {
  const r = layoutIllustrationGenerationRecordSchema.parse(raw);
  if (r.storeId !== scope.storeId || r.ownerId !== scope.ownerId)
    throw Error("LAYOUT_ILLUSTRATION_SCOPE_INVALID");
  if (ackVersion !== undefined && ackVersion !== r.version)
    throw Error("LAYOUT_ILLUSTRATION_GENERATION_VERSION_INVALID");
  const old = await db.getFirstAsync<Row>(
    `SELECT * FROM ${TABLE} WHERE id=?`,
    r.id,
  );
  const prior = old
    ? layoutIllustrationGenerationRecordSchema.parse(
        JSON.parse(old.payload_json),
      )
    : null;
  if (
    old &&
    (old.store_id !== scope.storeId ||
      old.owner_id !== scope.ownerId ||
      JSON.stringify(prior!.decision) !== JSON.stringify(r.decision))
  )
    throw Error("LAYOUT_ILLUSTRATION_GENERATION_IMMUTABLE");
  if (
    old?.remote_version === r.version &&
    old.remote_payload_json &&
    old.remote_payload_json !== JSON.stringify(r)
  )
    throw Error("LAYOUT_ILLUSTRATION_GENERATION_IMMUTABLE");
  const chosen =
      old && old.remote_version !== null && old.remote_version > r.version
        ? prior!
        : r,
    dirty = old?.dirty && ackVersion === undefined ? 1 : 0;
  await db.runAsync(
    `INSERT INTO ${TABLE}(id,store_id,owner_id,conversation_id,preparation_id,created_at,payload_json,remote_payload_json,remote_version,sync_state,dirty) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at,payload_json=excluded.payload_json,remote_payload_json=excluded.remote_payload_json,remote_version=excluded.remote_version,sync_state=excluded.sync_state,dirty=excluded.dirty`,
    r.id,
    r.storeId,
    r.ownerId,
    r.conversationId,
    r.preparationId,
    chosen.createdAt,
    JSON.stringify(chosen),
    JSON.stringify(chosen),
    chosen.version,
    dirty ? old!.sync_state : "SYNCED",
    dirty,
  );
}
export class LayoutIllustrationGenerationRepository {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private scope: Scope & { canPrepare: boolean },
    private digest: (text: string) => Promise<string>,
    private now = () => new Date().toISOString(),
  ) {}
  private async visible(tx: OutboxDatabase, message: CopilotMessage) {
    const { content } = readStoreLayoutScenarioCard(message);
    await verifyPrivateToolRecord(
      tx,
      this.scope,
      message,
      content.assistantMessageId,
    );
    return new LayoutIllustrationRepository(
      joinedMutationDatabase(tx),
      this.scope,
      this.digest,
    ).find(message);
  }
  async find(message: CopilotMessage): Promise<{
    entity: LayoutIllustrationGenerationRecord;
    syncState: string;
    refusalCode?: string;
  } | null> {
    let value: {
      entity: LayoutIllustrationGenerationRecord;
      syncState: string;
      refusalCode?: string;
    } | null = null;
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const preparation = await this.visible(tx, message);
      if (!preparation) return;
      const row = await tx.getFirstAsync<Row>(
        `SELECT * FROM ${TABLE} WHERE store_id=? AND owner_id=? AND preparation_id=? ORDER BY created_at DESC,id DESC LIMIT 1`,
        this.scope.storeId,
        this.scope.ownerId,
        preparation.entity.id,
      );
      if (row) {
        const entity = layoutIllustrationGenerationRecordSchema.parse(
          JSON.parse(row.payload_json),
        );
        const failure = await tx.getFirstAsync<{
          last_error_code: string | null;
        }>(
          "SELECT last_error_code FROM sync_outbox WHERE command_id=? AND store_id=? AND json_extract(payload_json,'$.ownerId')=?",
          entity.id,
          this.scope.storeId,
          this.scope.ownerId,
        );
        value = {
          entity,
          syncState: row.sync_state,
          ...(failure?.last_error_code
            ? { refusalCode: failure.last_error_code }
            : {}),
        };
      }
    });
    return value;
  }
  async confirm(
    message: CopilotMessage,
    rawQuote: unknown,
    ids: { id: string; deviceId: string },
    signal?: AbortSignal,
  ) {
    const quote = layoutIllustrationQuoteSchema.parse(rawQuote);
    let result: LayoutIllustrationGenerationRecord | undefined;
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const check = () => {
        if (signal?.aborted) throw Error("LAYOUT_ILLUSTRATION_CANCELLED");
      };
      check();
      if (!this.scope.canPrepare) throw Error("LAYOUT_ILLUSTRATION_FORBIDDEN");
      const prep = await this.visible(tx, message);
      if (
        !prep ||
        prep.syncState !== "SYNCED" ||
        !sameLayoutIllustrationPreparation(prep.entity, quote.body.preparation)
      )
        throw Error("LAYOUT_ILLUSTRATION_SOURCE_PENDING");
      const prior = await tx.getFirstAsync<Row>(
        `SELECT * FROM ${TABLE} WHERE id=? OR (store_id=? AND owner_id=? AND json_extract(payload_json,'$.decision.quote.body.id')=?)`,
        ids.id,
        this.scope.storeId,
        this.scope.ownerId,
        quote.body.id,
      );
      if (prior) {
        const r = layoutIllustrationGenerationRecordSchema.parse(
          JSON.parse(prior.payload_json),
        );
        if (
          r.ownerId !== this.scope.ownerId ||
          r.storeId !== this.scope.storeId ||
          JSON.stringify(r.decision.quote) !== JSON.stringify(quote)
        )
          throw Error("LAYOUT_ILLUSTRATION_GENERATION_IMMUTABLE");
        result = r;
        return;
      }
      if (Date.parse(this.now()) >= Date.parse(quote.body.expiresAt))
        throw Error("LAYOUT_ILLUSTRATION_QUOTE_EXPIRED");
      const current = await new CopilotStoreLayoutScenarioReader(
        joinedMutationDatabase(tx),
        this.scope,
      ).open(message);
      if (current.freshness !== "CURRENT")
        throw Error("LAYOUT_ILLUSTRATION_REVIEW_REQUIRED");
      const decision = layoutIllustrationGenerationDecisionSchema.parse({
          id: ids.id,
          storeId: this.scope.storeId,
          ownerId: this.scope.ownerId,
          conversationId: message.conversationId,
          preparationId: prep.entity.id,
          intent: "GENERATE_ONE_ILLUSTRATION",
          quote,
          confirmedAt: this.now(),
        }),
        p = quote.body.preparation,
        record = layoutIllustrationGenerationRecordSchema.parse({
          id: decision.id,
          storeId: p.storeId,
          ownerId: p.ownerId,
          conversationId: p.conversationId,
          preparationId: p.id,
          decision,
          version: 1,
          status: "QUEUED",
          createdAt: quote.body.issuedAt,
          updatedAt: quote.body.issuedAt,
          submittedAt: null,
          recoverAt: null,
          reason: null,
        });
      check();
      await tx.runAsync(
        `INSERT INTO ${TABLE}(id,store_id,owner_id,conversation_id,preparation_id,created_at,payload_json,sync_state,dirty) VALUES(?,?,?,?,?,?,?,'PENDING',1)`,
        record.id,
        record.storeId,
        record.ownerId,
        record.conversationId,
        record.preparationId,
        record.createdAt,
        JSON.stringify(record),
      );
      await new OutboxRepository(tx, this.now).enqueue({
        commandId: record.id,
        deviceId: ids.deviceId,
        storeId: record.storeId,
        commandType: "COPILOT_LAYOUT_ILLUSTRATION_GENERATE",
        entityType: "copilot_layout_illustration_generation",
        entityId: record.id,
        expectedRemoteVersion: null,
        payload: decision,
      });
      check();
      result = record;
    });
    if (!result) throw Error("LAYOUT_ILLUSTRATION_UNAVAILABLE");
    return result;
  }
}
