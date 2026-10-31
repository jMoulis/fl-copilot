import { z } from "zod";
import { copilotConversationSchema } from "@fl-copilot/domain";
import type { EmailIntakeDatabase } from "./email-intake-cache";
import {
  emailIntakeDecisionSchema,
  emailIntakeReceiptSchema,
  emailIntakeOriginalManifestSchema,
  serializeEmailIntakeOriginalMetadata,
  type EmailIntakeDecision,
} from "@fl-copilot/sync-contracts";
import { EmailIntakeCache, type EmailIntakeScope } from "./email-intake-cache";
import { sourceOriginalHash } from "../documents/source-original-hash";
import {
  OutboxRepository,
  type OutboxDatabase,
  notifyOutboxChanged,
} from "../sync/outbox-repository";
import { ConflictRepository } from "../sync/conflict-repository";
const selectionSchema = emailIntakeDecisionSchema.shape.files.element.pick({
  fileId: true,
  processingId: true,
  mode: true,
});
const inputSchema = z
  .strictObject({
    conversationId: z.uuid(),
    receiptId: z.uuid(),
    choice: z.enum(["ADMIT", "DISMISS"]),
    files: z.array(selectionSchema).max(50),
  })
  .refine(
    (value) =>
      value.choice === "ADMIT"
        ? value.files.length > 0
        : value.files.length === 0,
    "Invalid admission selection",
  );
type Row = {
  store_id: string;
  owner_id: string;
  conversation_id: string;
  payload_json: string;
  remote_payload_json: string | null;
  remote_version: number | null;
  dirty: number;
  sync_state: string;
};
function scoped(
  decision: EmailIntakeDecision,
  scope: { storeId: string; ownerId: string },
) {
  if (decision.storeId !== scope.storeId || decision.ownerId !== scope.ownerId)
    throw Error("EMAIL_INTAKE_DECISION_SCOPE_INVALID");
}
export async function applyEmailDecisionRecord(
  db: OutboxDatabase,
  scope: { storeId: string; ownerId: string },
  raw: unknown,
  ackVersion?: number,
) {
  const decision = emailIntakeDecisionSchema.parse(raw);
  scoped(decision, scope);
  const old = await db.getFirstAsync<Row>(
    "SELECT * FROM email_intake_decisions WHERE id=?",
    decision.id,
  );
  const json = JSON.stringify(decision);
  if (old) {
    if (
      old.store_id !== scope.storeId ||
      old.owner_id !== scope.ownerId ||
      old.conversation_id !== decision.conversationId
    )
      throw Error("EMAIL_INTAKE_DECISION_SCOPE_INVALID");
    if (old.dirty && ackVersion === undefined) {
      await db.runAsync(
        "UPDATE email_intake_decisions SET remote_payload_json=?,remote_version=1 WHERE id=?",
        json,
        decision.id,
      );
      return;
    }
    if (
      (old.dirty
        ? old.payload_json
        : (old.remote_payload_json ?? old.payload_json)) !== json
    )
      throw Error("EMAIL_INTAKE_DECISION_IMMUTABLE");
  }
  await db.runAsync(
    "INSERT INTO email_intake_decisions(id,store_id,owner_id,conversation_id,payload_json,remote_payload_json,remote_version,sync_state,dirty) VALUES(?,?,?,?,?,?,1,'SYNCED',0) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,remote_payload_json=excluded.remote_payload_json,remote_version=1,sync_state='SYNCED',dirty=0",
    decision.id,
    scope.storeId,
    scope.ownerId,
    decision.conversationId,
    json,
    json,
  );
}
/** One human admission and its command commit together. No parser, publication or AI is run here. */
export class EmailDecisionRepository {
  constructor(
    private cache: EmailIntakeCache,
    private now: () => string = () => new Date().toISOString(),
  ) {}
  private async receipt(
    scope: EmailIntakeScope,
    id: string,
    tx: OutboxDatabase = this.cache.db,
  ) {
    await this.cache.authorize(scope, tx);
    const row = await tx.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM email_intake_receipts WHERE store_id=? AND owner_id=? AND conversation_id=? AND id=?",
      scope.storeId,
      scope.ownerId,
      scope.conversationId,
      id,
    );
    this.cache.check(scope);
    const receipt = row
      ? emailIntakeReceiptSchema.parse(JSON.parse(row.payload_json))
      : null;
    if (
      !receipt ||
      receipt.id !== id ||
      receipt.storeId !== scope.storeId ||
      receipt.ownerId !== scope.ownerId ||
      receipt.conversationId !== scope.conversationId ||
      ["DISMISSED", "QUARANTINED"].includes(receipt.status)
    )
      throw Error("EMAIL_INTAKE_RECEIPT_UNAVAILABLE");
    return { receipt, json: JSON.stringify(receipt) };
  }
  private async manifest(
    scope: EmailIntakeScope,
    receiptId: string,
    fileId: string,
    tx: OutboxDatabase = this.cache.db,
  ) {
    const row = await tx.getFirstAsync<{
      manifest_json: string;
      local_uri: string;
    }>(
      "SELECT manifest_json,local_uri FROM email_original_manifests WHERE store_id=? AND owner_id=? AND conversation_id=? AND receipt_id=? AND file_id=?",
      scope.storeId,
      scope.ownerId,
      scope.conversationId,
      receiptId,
      fileId,
    );
    this.cache.check(scope);
    return row;
  }
  async get(conversationId: string, receiptId: string) {
    z.uuid().parse(receiptId);
    const scope = this.cache.scope(conversationId);
    await this.cache.authorize(scope);
    const row = await this.cache.db.getFirstAsync<Row>(
      "SELECT * FROM email_intake_decisions WHERE id=? AND store_id=? AND owner_id=? AND conversation_id=?",
      receiptId,
      scope.storeId,
      scope.ownerId,
      scope.conversationId,
    );
    await this.cache.authorize(scope);
    if (!row) return null;
    const decision = emailIntakeDecisionSchema.parse(
      JSON.parse(row.payload_json),
    );
    scoped(decision, scope);
    if (decision.id !== receiptId || decision.conversationId !== conversationId)
      throw Error("EMAIL_INTAKE_DECISION_SCOPE_INVALID");
    return { decision, state: row.sync_state };
  }
  async decide(
    raw: z.infer<typeof inputSchema>,
    command: { actionId: string; deviceId: string; retryOfActionId?: string },
  ) {
    const input = inputSchema.parse(raw),
      scope = this.cache.scope(input.conversationId);
    z.uuid().parse(command.actionId);
    z.uuid().parse(command.deviceId);
    const prior = await this.get(input.conversationId, input.receiptId);
    const retry =
      prior?.state === "ERROR" &&
      command.retryOfActionId === prior.decision.actionId;
    if (prior && !retry) {
      if (prior.state === "ERROR")
        throw Error("EMAIL_INTAKE_DECISION_RETRY_REQUIRED");
      if (
        prior.decision.choice === input.choice &&
        JSON.stringify(
          prior.decision.files.map(({ fileId, mode, processingId }) => ({
            fileId,
            processingId,
            mode,
          })),
        ) === JSON.stringify(input.files)
      )
        return prior.decision;
      throw Error("EMAIL_INTAKE_DECISION_ALREADY_RECORDED");
    }
    const basis = await this.receipt(scope, input.receiptId);
    if (basis.receipt.status !== "AWAITING_CONFIRMATION")
      throw Error("EMAIL_INTAKE_DECISION_SYNC_REQUIRED");
    const originals = new Map<
      string,
      { manifest_json: string; local_uri: string }
    >();
    const files: EmailIntakeDecision["files"] = [];
    for (const selection of input.files) {
      const file = basis.receipt.files.find(
        (file) => file.id === selection.fileId,
      );
      if (
        !file ||
        !["READY", "PENDING", "FAILED"].includes(file.status) ||
        file.sourceDocumentId !== null
      )
        throw Error("EMAIL_INTAKE_FILE_UNAVAILABLE");
      const retained = await this.manifest(scope, input.receiptId, file.id);
      if (file.status !== "READY" || !retained) {
        files.push({ ...selection, manifestHash: null, checksum: null });
        continue;
      }
      // Admission is a local permission, not a byte-read or format assertion.
      // Keep a known immutable manifest as a source basis; the processing path
      // must still recover and verify actual bytes before any canonical use.
      const manifest = emailIntakeOriginalManifestSchema.parse(
        JSON.parse(retained.manifest_json),
      );
      const { manifestHash, ...metadata } = manifest;
      if (
        manifest.storeId !== scope.storeId ||
        manifest.ownerId !== scope.ownerId ||
        manifest.conversationId !== scope.conversationId ||
        manifest.receiptId !== input.receiptId ||
        manifest.fileId !== file.id ||
        manifest.providerEmailId !== basis.receipt.providerEmailId ||
        manifest.providerAttachmentId !== file.providerAttachmentId ||
        manifest.filename !== file.filename ||
        manifest.declaredMimeType !== file.mediaType ||
        sourceOriginalHash(serializeEmailIntakeOriginalMetadata(metadata)) !==
          manifestHash
      )
        throw Error("EMAIL_INTAKE_ORIGINAL_CHANGED");
      originals.set(file.id, retained);
      files.push({
        ...selection,
        manifestHash: manifest.manifestHash,
        checksum: manifest.checksum,
      });
    }
    const at = this.now();
    const decision = emailIntakeDecisionSchema.parse({
      id: input.receiptId,
      receiptId: input.receiptId,
      actionId: command.actionId,
      ...scope,
      version: 1,
      policyVersion: 1,
      receiptVersion: basis.receipt.version,
      choice: input.choice,
      files,
      createdAt: at,
      updatedAt: at,
    });
    await this.cache.db.withExclusiveTransactionAsync(async (tx) => {
      const live = await this.receipt(scope, input.receiptId, tx);
      if (live.json !== basis.json) throw Error("EMAIL_INTAKE_RECEIPT_CHANGED");
      for (const [id, expected] of originals) {
        const current = await this.manifest(scope, input.receiptId, id, tx);
        if (current?.manifest_json !== expected.manifest_json)
          throw Error("EMAIL_INTAKE_ORIGINAL_CHANGED");
      }
      if (retry && prior) {
        const old = await tx.getFirstAsync<Row>(
          "SELECT * FROM email_intake_decisions WHERE id=? AND store_id=? AND owner_id=?",
          decision.id,
          scope.storeId,
          scope.ownerId,
        );
        if (
          !old ||
          old.sync_state !== "ERROR" ||
          old.payload_json !== JSON.stringify(prior.decision) ||
          old.remote_version !== null ||
          command.actionId === prior.decision.actionId
        )
          throw Error("EMAIL_INTAKE_DECISION_RETRY_INVALID");
        const superseded = await tx.runAsync(
          "UPDATE sync_outbox SET last_error_code='EMAIL_INTAKE_DECISION_SUPERSEDED' WHERE command_id=? AND store_id=? AND entity_type='email_intake_decision' AND entity_id=? AND status='FAILED'",
          prior.decision.actionId,
          scope.storeId,
          decision.id,
        );
        if (Number(superseded.changes) !== 1)
          throw Error("EMAIL_INTAKE_DECISION_RETRY_INVALID");
        await tx.runAsync(
          "UPDATE email_intake_decisions SET payload_json=?,remote_payload_json=NULL,remote_version=NULL,sync_state='PENDING',dirty=1 WHERE id=? AND store_id=? AND owner_id=?",
          JSON.stringify(decision),
          decision.id,
          scope.storeId,
          scope.ownerId,
        );
      } else {
        await tx.runAsync(
          "INSERT INTO email_intake_decisions(id,store_id,owner_id,conversation_id,payload_json,sync_state,dirty) VALUES(?,?,?,?,?,'PENDING',1)",
          decision.id,
          scope.storeId,
          scope.ownerId,
          scope.conversationId,
          JSON.stringify(decision),
        );
      }
      await new OutboxRepository(tx, this.now).enqueue({
        commandId: command.actionId,
        deviceId: command.deviceId,
        storeId: scope.storeId,
        entityType: "email_intake_decision",
        entityId: decision.id,
        commandType: "EMAIL_INTAKE_DECIDE",
        expectedRemoteVersion: null,
        payload: decision,
        createdAt: at,
      });
      await this.cache.authorize(scope, tx);
    });
    notifyOutboxChanged();
    return decision;
  }
  /** The first immutable accepted choice is adopted explicitly; never silently retry the other choice. */
  async adoptRemote(conversationId: string, conflictId: string) {
    z.uuid().parse(conflictId);
    const scope = this.cache.scope(conversationId);
    await this.cache.db.withExclusiveTransactionAsync(async (tx) => {
      await this.cache.authorize(scope, tx);
      const conflict = await new ConflictRepository(tx, this.now).getById(
        conflictId,
      );
      if (
        !conflict ||
        conflict.status !== "OPEN" ||
        conflict.storeId !== scope.storeId ||
        conflict.entityType !== "email_intake_decision" ||
        conflict.commandId !== conflictId
      )
        throw Error("EMAIL_INTAKE_CONFLICT_UNAVAILABLE");
      const local = emailIntakeDecisionSchema.parse(conflict.localPayload),
        remote = emailIntakeDecisionSchema.parse(conflict.remotePayload);
      scoped(local, scope);
      scoped(remote, scope);
      if (
        local.conversationId !== conversationId ||
        remote.conversationId !== conversationId ||
        remote.id !== local.id ||
        conflict.entityId !== local.id ||
        local.actionId !== conflict.commandId
      )
        throw Error("EMAIL_INTAKE_DECISION_SCOPE_INVALID");
      const row = await tx.getFirstAsync<Row>(
        "SELECT * FROM email_intake_decisions WHERE id=? AND store_id=? AND owner_id=?",
        local.id,
        scope.storeId,
        scope.ownerId,
      );
      if (
        !row ||
        row.sync_state !== "CONFLICT" ||
        row.payload_json !== JSON.stringify(local) ||
        conflict.remoteVersion !== 1 ||
        (row.remote_payload_json !== null &&
          row.remote_payload_json !== JSON.stringify(remote))
      )
        throw Error("EMAIL_INTAKE_CONFLICT_CHANGED");
      const superseded = await tx.runAsync(
        "UPDATE sync_outbox SET status='FAILED',last_error_code='EMAIL_INTAKE_DECISION_SUPERSEDED' WHERE command_id=? AND store_id=? AND entity_type='email_intake_decision' AND entity_id=? AND status='CONFLICT'",
        conflictId,
        scope.storeId,
        local.id,
      );
      if (Number(superseded.changes) !== 1)
        throw Error("EMAIL_INTAKE_CONFLICT_CHANGED");
      await tx.runAsync(
        "UPDATE email_intake_decisions SET payload_json=?,remote_payload_json=?,remote_version=1,sync_state='SYNCED',dirty=0 WHERE id=? AND store_id=? AND owner_id=?",
        JSON.stringify(remote),
        JSON.stringify(remote),
        remote.id,
        scope.storeId,
        scope.ownerId,
      );
      await tx.runAsync(
        "UPDATE sync_conflicts SET status='RESOLVED_REMOTE',resolved_at=? WHERE id=? AND status='OPEN'",
        this.now(),
        conflictId,
      );
      await this.cache.authorize(scope, tx);
    });
    notifyOutboxChanged();
  }
}

/** Retain a refused decision and its sources as audit, without replaying a deleted chat. */
export async function retireDeletedConversationEmailDecision(
  db: EmailIntakeDatabase,
  scope: { storeId: string; ownerId: string },
  commandId: string,
  canWrite: () => boolean,
) {
  await db.withExclusiveTransactionAsync(async (tx) => {
    if (!canWrite()) throw Error("EMAIL_INTAKE_DECISION_SCOPE_INVALID");
    const row = await tx.getFirstAsync<{
      entity_id: string;
      payload_json: string;
    }>(
      "SELECT entity_id,payload_json FROM sync_outbox WHERE command_id=? AND store_id=? AND entity_type='email_intake_decision' AND status='FAILED' AND last_error_code='COPILOT_HISTORY_ACCESS_INVALID'",
      commandId,
      scope.storeId,
    );
    if (!row) throw Error("EMAIL_INTAKE_DECISION_REVIEW_CHANGED");
    const decision = emailIntakeDecisionSchema.parse(
      JSON.parse(row.payload_json),
    );
    scoped(decision, scope);
    if (decision.id !== row.entity_id || decision.actionId !== commandId)
      throw Error("EMAIL_INTAKE_DECISION_SCOPE_INVALID");
    const parent = await tx.getFirstAsync<{
      payload_json: string;
      remote_payload_json: string | null;
      remote_version: number | null;
    }>(
      "SELECT payload_json,remote_payload_json,remote_version FROM copilot_conversations WHERE id=? AND store_id=? AND owner_id=?",
      decision.conversationId,
      scope.storeId,
      scope.ownerId,
    );
    // Stopping this retained local intent is an explicit owner action, not a
    // server acknowledgement. A local deletion need not await its remote cache.
    if (
      !parent ||
      (!parent.remote_payload_json && parent.remote_version !== null)
    )
      throw Error("EMAIL_INTAKE_CONVERSATION_DELETION_UNVERIFIED");
    for (const [raw, remote] of [
      [parent.payload_json, false],
      [parent.remote_payload_json, true],
    ] as const) {
      if (raw === null) continue;
      const p = copilotConversationSchema.parse(JSON.parse(raw));
      if (
        p.id !== decision.conversationId ||
        p.storeId !== scope.storeId ||
        p.ownerId !== scope.ownerId ||
        (!remote && (!p.deletedAt || p.status !== "ARCHIVED")) ||
        (remote && p.version !== parent.remote_version)
      )
        throw Error("EMAIL_INTAKE_CONVERSATION_DELETION_UNVERIFIED");
    }
    const retained = await tx.getFirstAsync<{
      payload_json: string;
      sync_state: string;
      remote_version: number | null;
    }>(
      "SELECT payload_json,sync_state,remote_version FROM email_intake_decisions WHERE id=? AND store_id=? AND owner_id=?",
      decision.id,
      scope.storeId,
      scope.ownerId,
    );
    if (
      !retained ||
      retained.sync_state !== "ERROR" ||
      retained.remote_version !== null ||
      JSON.stringify(
        emailIntakeDecisionSchema.parse(JSON.parse(retained.payload_json)),
      ) !== JSON.stringify(decision)
    )
      throw Error("EMAIL_INTAKE_DECISION_REVIEW_CHANGED");
    const changed = await tx.runAsync(
      "UPDATE sync_outbox SET last_error_code='EMAIL_INTAKE_DECISION_SUPERSEDED' WHERE command_id=? AND status='FAILED' AND last_error_code='COPILOT_HISTORY_ACCESS_INVALID'",
      commandId,
    );
    if (Number(changed.changes) !== 1)
      throw Error("EMAIL_INTAKE_DECISION_REVIEW_CHANGED");
    if (!canWrite()) throw Error("EMAIL_INTAKE_DECISION_SCOPE_INVALID");
  });
  notifyOutboxChanged();
}
