import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
import { receiptPublicationChatFixture } from "./test-receipt-publication-fixtures";
import { runLocalMigrations } from "../apps/mobile/src/db/migrations";
import {
  WasteReceiptRepository,
  insertLine,
} from "../apps/mobile/src/documents/waste-receipt-repository";
import { ProductMasterRepository } from "../apps/mobile/src/products/product-master-repository";
import {
  CopilotConversationRepository,
  applyCopilotRecord,
} from "../apps/mobile/src/copilot/conversation-repository";
import {
  CopilotReceiptPublicationController,
  CopilotReceiptPublicationRuntime,
} from "../apps/mobile/src/copilot/receipt-publication-controller";
import { buildReceiptPublicationMessages } from "../apps/api/src/copilot/receipt-publication-messages";
import type { OutboxDatabase } from "../apps/mobile/src/sync/outbox-repository";
export const receiptReviewDigest = async (text: string) =>
  createHash("sha256").update(text).digest("hex");
export class ReceiptTestDatabase implements OutboxDatabase {
  fail = false;
  afterRun?: (sql: string) => void;
  beforeCommit?: () => void;
  constructor(readonly db: DatabaseSync) {}
  async execAsync(s: string) {
    this.db.exec(s);
  }
  async getFirstAsync<T>(s: string, ...p: Array<string | number | null>) {
    return (this.db.prepare(s).get(...p) as T) ?? null;
  }
  async getAllAsync<T>(s: string, ...p: Array<string | number | null>) {
    return this.db.prepare(s).all(...p) as T[];
  }
  async runAsync(s: string, ...p: Array<string | number | null>) {
    const result = this.db.prepare(s).run(...p);
    this.afterRun?.(s);
    return result;
  }
  async withExclusiveTransactionAsync(
    task: (tx: OutboxDatabase) => Promise<void>,
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      await task(this);
      this.beforeCommit?.();
      if (this.fail) throw Error("private database detail");
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
export async function nativeReceiptPublicationFixture(
  path = ":memory:",
  f = receiptPublicationChatFixture(),
) {
  const db = new DatabaseSync(path),
    a = new ReceiptTestDatabase(db),
    p = f.p;
  await runLocalMigrations(a);
  const product = {
    id: p.observations[0]!.productId,
    storeId: f.chat.storeId,
    label: "FIGUE VRAC",
    category: "UNKNOWN" as const,
    nature: "UNKNOWN" as const,
    salesUnit: "UNKNOWN" as const,
    packaging: null,
    familyId: null,
    subfamilyId: null,
    status: "TO_REVIEW" as const,
    version: 1,
    createdAt: p.receipt.createdAt,
    updatedAt: p.receipt.updatedAt,
    deletedAt: null,
  };
  await new ProductMasterRepository(a).upsertProduct(product, {
    commandId: randomUUID(),
    deviceId: f.chat.deviceId,
  });
  const repo = new WasteReceiptRepository(a);
  await repo.createCapturedDraft({
    receiptId: p.receipt.id,
    fileId: randomUUID(),
    sourceDocumentId: p.source.id,
    uploadJobId: randomUUID(),
    storeId: f.chat.storeId,
    capturedAt: p.receipt.createdAt,
    file: {
      originalFilename: f.source.filename,
      localUri: "file:///private-receipt.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 100,
      checksum: f.source.checksum,
    },
  });
  await a.runAsync(
    "UPDATE source_documents SET remote_upload_status='CONFIRMED' WHERE id=?",
    p.source.id,
  );
  await a.runAsync(
    "UPDATE waste_receipts SET processing_status='TO_VALIDATE', ai_status='COMPLETED' WHERE id=?",
    p.receipt.id,
  );
  await repo.confirmWasteDate(p.receipt.id, p.receipt.confirmedWasteDate!);
  await repo.confirmCashierNumber(
    p.receipt.id,
    p.receipt.confirmedCashierNumber!,
    p.receipt.updatedAt,
  );
  for (const line of p.lines)
    await insertLine(a, {
      ...line,
      validationStatus:
        line.validationStatus === "EXCLUDED" ? "EXCLUDED" : "PENDING",
      syncState: "LOCAL_ONLY",
    });
  const conversations = new CopilotConversationRepository(a, f.chat);
  await conversations.save(f.chat.conversation, {
    commandId: randomUUID(),
    deviceId: f.chat.deviceId,
  });
  await conversations.append(f.chat.message, {
    commandId: randomUUID(),
    deviceId: f.chat.deviceId,
  });
  const message = buildReceiptPublicationMessages(f.assistant, [f.preview])[0]!;
  await a.withExclusiveTransactionAsync(async (tx) => {
    await applyCopilotRecord(tx, f.chat, "copilot_message", f.assistant);
    await applyCopilotRecord(tx, f.chat, "copilot_message", message);
  });
  const scope = {
      storeId: f.chat.storeId,
      ownerId: f.chat.ownerId,
      deviceId: f.chat.deviceId,
      canPublishWaste: true,
    },
    controller = new CopilotReceiptPublicationController(
      a,
      scope,
      receiptReviewDigest,
      randomUUID,
    ),
    runtime = new CopilotReceiptPublicationRuntime(
      a,
      receiptReviewDigest,
      randomUUID,
    );
  const state = await controller.open(message);
  if (!state.review) throw Error("REVIEW_MISSING");
  const request = {
      operationId: message.id,
      sourceDocumentId: p.source.id,
      receiptId: p.receipt.id,
      basisHash: state.review.basisHash,
    },
    authority = {
      ...scope,
      conversationId: f.chat.conversation.id,
      userMessageId: f.chat.message.id,
      authorizedRequestJson: JSON.stringify(request),
      decisionLevel: "REVIEWED" as const,
      receiptReviewed: true,
    };
  const count = (table: string) =>
    (db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as { n: number }).n;
  return {
    f,
    db,
    a,
    repo,
    product,
    message,
    scope,
    controller,
    runtime,
    request,
    authority,
    state,
    count,
  };
}
