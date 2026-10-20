import { z } from "zod";
import { copilotConversationSchema } from "@fl-copilot/domain";
import {
  emailIntakeBindingSchema,
  emailIntakeListSchema,
  emailIntakeReceiptSchema,
  emailIntakeOriginalRequestSchema,
  type EmailIntakeBinding,
  type EmailIntakeReceipt,
} from "@fl-copilot/sync-contracts";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";

export type EmailIntakeSession = {
  storeId: string;
  userId: string;
  canWrite: boolean;
};
export type EmailIntakeScope = {
  storeId: string;
  ownerId: string;
  conversationId: string;
};
export type EmailIntakeDatabase = OutboxDatabase & AtomicMutationDatabase;
const scopeSchema = z.strictObject({
  storeId: z.uuid(),
  ownerId: z.uuid(),
  conversationId: z.uuid(),
});
const invalid = () => Error("EMAIL_INTAKE_IDENTITY_INVALID");
function identity(receipt: EmailIntakeReceipt) {
  return JSON.stringify({
    ...receipt,
    version: undefined,
    status: undefined,
    updatedAt: undefined,
    files: receipt.files.map((file) => ({
      ...file,
      status: undefined,
      sourceDocumentId: undefined,
      errorCode: undefined,
    })),
  });
}

/** Private, server-owned read cache. Receiving a page never admits or publishes a file. */
export class EmailIntakeCache {
  constructor(
    readonly db: EmailIntakeDatabase,
    private session: () => EmailIntakeSession | null,
  ) {}
  scope(conversationId: string): EmailIntakeScope {
    const current = this.session();
    if (!current?.canWrite) throw Error("EMAIL_INTAKE_SESSION_REQUIRED");
    return scopeSchema.parse({
      storeId: current.storeId,
      ownerId: current.userId,
      conversationId,
    });
  }
  check(scope: EmailIntakeScope) {
    const current = this.session();
    if (
      !current?.canWrite ||
      current.storeId !== scope.storeId ||
      current.userId !== scope.ownerId
    )
      throw Error("EMAIL_INTAKE_SCOPE_CHANGED");
  }
  async authorize(scope: EmailIntakeScope, tx: OutboxDatabase = this.db) {
    scopeSchema.parse(scope);
    this.check(scope);
    const row = await tx.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM copilot_conversations WHERE store_id=? AND owner_id=? AND id=?",
      scope.storeId,
      scope.ownerId,
      scope.conversationId,
    );
    this.check(scope);
    const conversation = row
      ? copilotConversationSchema.parse(JSON.parse(row.payload_json))
      : null;
    if (
      !conversation ||
      conversation.id !== scope.conversationId ||
      conversation.storeId !== scope.storeId ||
      conversation.ownerId !== scope.ownerId ||
      conversation.status !== "ACTIVE" ||
      conversation.deletedAt
    )
      throw Error("EMAIL_INTAKE_CONVERSATION_UNAVAILABLE");
  }
  private scoped(value: EmailIntakeScope, scope: EmailIntakeScope) {
    if (
      value.storeId !== scope.storeId ||
      value.ownerId !== scope.ownerId ||
      value.conversationId !== scope.conversationId
    )
      throw invalid();
  }
  async storePage(scope: EmailIntakeScope, raw: unknown) {
    const page = emailIntakeListSchema.parse(raw);
    // Validate the entire page before writes; one foreign item rolls back the page.
    for (const item of [...page.bindings, ...page.receipts])
      this.scoped(item, scope);
    if (
      new Set(page.bindings.map((b) => b.id)).size !== page.bindings.length ||
      new Set(page.receipts.map((r) => r.id)).size !== page.receipts.length
    )
      throw invalid();
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      await this.authorize(scope, tx);
      const keys = [scope.storeId, scope.ownerId, scope.conversationId];
      for (const binding of page.bindings) {
        const row = await tx.getFirstAsync<{ payload_json: string }>(
          "SELECT payload_json FROM email_intake_bindings WHERE store_id=? AND owner_id=? AND conversation_id=? AND id=?",
          ...keys,
          binding.id,
        );
        const prior = row
          ? emailIntakeBindingSchema.parse(JSON.parse(row.payload_json))
          : null;
        if (prior) {
          const immutable = (b: EmailIntakeBinding) =>
            JSON.stringify({ ...b, revokedAt: undefined });
          if (immutable(prior) !== immutable(binding)) throw invalid();
          // A delayed list response cannot reactivate a revoked address.
          if (prior.revokedAt) {
            if (binding.revokedAt && binding.revokedAt !== prior.revokedAt)
              throw invalid();
            continue;
          }
        }
        await tx.runAsync(
          "INSERT INTO email_intake_bindings(store_id,owner_id,conversation_id,id,payload_json) VALUES(?,?,?,?,?) ON CONFLICT(store_id,owner_id,conversation_id,id) DO UPDATE SET payload_json=excluded.payload_json",
          ...keys,
          binding.id,
          JSON.stringify(binding),
        );
      }
      for (const receipt of page.receipts) {
        const row = await tx.getFirstAsync<{ payload_json: string }>(
          "SELECT payload_json FROM email_intake_receipts WHERE store_id=? AND owner_id=? AND conversation_id=? AND id=?",
          ...keys,
          receipt.id,
        );
        const prior = row
          ? emailIntakeReceiptSchema.parse(JSON.parse(row.payload_json))
          : null;
        if (prior) {
          if (identity(prior) !== identity(receipt)) throw invalid();
          if (prior.version > receipt.version) continue;
          if (prior.version === receipt.version) {
            if (JSON.stringify(prior) !== JSON.stringify(receipt))
              throw invalid();
            continue;
          }
          if (
            Date.parse(receipt.updatedAt) < Date.parse(prior.updatedAt) ||
            (["DISMISSED", "QUARANTINED"].includes(prior.status) &&
              receipt.status !== prior.status) ||
            prior.files.some(
              (file, i) =>
                file.sourceDocumentId !== null &&
                file.sourceDocumentId !== receipt.files[i]?.sourceDocumentId,
            )
          )
            throw invalid();
        }
        const binding = await tx.getFirstAsync<{ payload_json: string }>(
          "SELECT payload_json FROM email_intake_bindings WHERE store_id=? AND owner_id=? AND conversation_id=? AND id=?",
          ...keys,
          receipt.bindingId,
        );
        if (
          binding &&
          emailIntakeBindingSchema.parse(JSON.parse(binding.payload_json))
            .allowedSender !== receipt.sender
        )
          throw invalid();
        await tx.runAsync(
          "INSERT INTO email_intake_receipts(store_id,owner_id,conversation_id,id,version,payload_json) VALUES(?,?,?,?,?,?) ON CONFLICT(store_id,owner_id,conversation_id,id) DO UPDATE SET version=excluded.version,payload_json=excluded.payload_json",
          ...keys,
          receipt.id,
          receipt.version,
          JSON.stringify(receipt),
        );
      }
      await this.authorize(scope, tx);
    });
    return page.nextCursor;
  }
  async list(conversationId: string, limit = 50) {
    z.number().int().min(1).max(100).parse(limit);
    const scope = this.scope(conversationId);
    await this.authorize(scope);
    const keys = [scope.storeId, scope.ownerId, scope.conversationId];
    const bindings = await this.db.getAllAsync<{ payload_json: string }>(
      "SELECT payload_json FROM email_intake_bindings WHERE store_id=? AND owner_id=? AND conversation_id=? ORDER BY json_extract(payload_json,'$.createdAt') DESC,id DESC LIMIT 50",
      ...keys,
    );
    const receipts = await this.db.getAllAsync<{ payload_json: string }>(
      "SELECT payload_json FROM email_intake_receipts WHERE store_id=? AND owner_id=? AND conversation_id=? ORDER BY json_extract(payload_json,'$.receivedAt') DESC,id DESC LIMIT ?",
      ...keys,
      limit,
    );
    await this.authorize(scope);
    const result = {
      bindings: bindings.map((b) =>
        emailIntakeBindingSchema.parse(JSON.parse(b.payload_json)),
      ),
      receipts: receipts.map((r) =>
        emailIntakeReceiptSchema.parse(JSON.parse(r.payload_json)),
      ),
    };
    for (const item of [...result.bindings, ...result.receipts])
      this.scoped(item, scope);
    return result;
  }
  async originalBasis(
    scope: EmailIntakeScope,
    raw: unknown,
    tx: OutboxDatabase = this.db,
  ) {
    const ref = emailIntakeOriginalRequestSchema.parse(raw);
    if (ref.conversationId !== scope.conversationId) throw invalid();
    await this.authorize(scope, tx);
    const row = await tx.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM email_intake_receipts WHERE store_id=? AND owner_id=? AND conversation_id=? AND id=?",
      scope.storeId,
      scope.ownerId,
      scope.conversationId,
      ref.receiptId,
    );
    this.check(scope);
    if (!row) throw Error("EMAIL_ORIGINAL_UNAVAILABLE");
    const receipt = emailIntakeReceiptSchema.parse(
      JSON.parse(row.payload_json),
    );
    this.scoped(receipt, scope);
    const file = receipt.files.find((item) => item.id === ref.fileId);
    if (
      receipt.id !== ref.receiptId ||
      ["DISMISSED", "QUARANTINED"].includes(receipt.status) ||
      !file ||
      !["READY", "APPLIED"].includes(file.status)
    )
      throw Error("EMAIL_ORIGINAL_UNAVAILABLE");
    return { receipt, file, snapshot: JSON.stringify(receipt) };
  }
  async receipt(
    conversationId: string,
    receiptId: string,
    tx: OutboxDatabase = this.db,
  ) {
    z.uuid().parse(receiptId);
    const scope = this.scope(conversationId);
    await this.authorize(scope, tx);
    const row = await tx.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM email_intake_receipts WHERE store_id=? AND owner_id=? AND conversation_id=? AND id=?",
      scope.storeId,
      scope.ownerId,
      scope.conversationId,
      receiptId,
    );
    await this.authorize(scope, tx);
    if (!row) return null;
    const receipt = emailIntakeReceiptSchema.parse(
      JSON.parse(row.payload_json),
    );
    this.scoped(receipt, scope);
    if (receipt.id !== receiptId) throw invalid();
    return receipt;
  }
}
