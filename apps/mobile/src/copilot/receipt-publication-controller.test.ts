import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import { wastePublicationSchema } from "@fl-copilot/sync-contracts";
import {
  nativeReceiptPublicationFixture,
  ReceiptTestDatabase,
  receiptReviewDigest,
} from "../../../../scripts/test-receipt-publication-sqlite";
import { CopilotReceiptPublicationController } from "./receipt-publication-controller";
import { WasteReceiptPublicationRepository } from "../documents/waste-receipt-publication";
import { insertLine } from "../documents/waste-receipt-repository";
it("reviews complete local corrections and publishes once offline despite incomplete catalogue, with durable restart replay", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-chat-receipt-")),
    path = join(dir, "local.db"),
    s = await nativeReceiptPublicationFixture(path);
  let reopened: DatabaseSync | undefined;
  try {
    expect(s.state.status).toBe("READY");
    expect(s.state.review?.warnings.length).toBeGreaterThan(0);
    const initialCommands = s.count("sync_outbox");
    expect(
      (await s.controller.confirm(s.message, s.request.basisHash, true)).status,
    ).toBe("COMPLETED");
    expect(s.count("waste_observations")).toBe(1);
    expect(s.count("sales_observations")).toBe(0);
    const row = await s.a.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM sync_outbox WHERE command_type='WASTE_RECEIPT_PUBLISH'",
    );
    const p = wastePublicationSchema.parse(JSON.parse(row!.payload_json));
    expect(p.receipt.confirmedWasteDate).toBe(s.f.p.receipt.confirmedWasteDate);
    expect(p.receipt.confirmedCashierNumber).toBe("000007");
    expect(
      p.lines.filter((l) => l.validationStatus === "EXCLUDED"),
    ).toHaveLength(1);
    expect(p.observations[0]).toMatchObject({
      salesValue: "3",
      quantity: null,
      purchaseValueKnown: null,
      purchaseValueEstimated: null,
    });
    expect(s.count("sync_outbox")).toBe(initialCommands + 1);
    expect(s.count("copilot_tool_results")).toBe(1);
    s.db.close();
    reopened = new DatabaseSync(path);
    const controller = new CopilotReceiptPublicationController(
      new ReceiptTestDatabase(reopened),
      s.scope,
      receiptReviewDigest,
      randomUUID,
    );
    expect(
      (await controller.confirm(s.message, s.request.basisHash, true)).status,
    ).toBe("COMPLETED");
    expect(
      (
        reopened.prepare("SELECT COUNT(*) n FROM waste_observations").get() as {
          n: number;
        }
      ).n,
    ).toBe(1);
  } finally {
    if (reopened) reopened.close();
    else s.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it.each(["DATE", "CASHIER", "LINE", "PRODUCT", "EXCLUSION", "SOURCE"])(
  "requires a fresh review after a native change (%s)",
  async (mode) => {
    const s = await nativeReceiptPublicationFixture();
    try {
      if (mode === "DATE")
        await s.repo.confirmWasteDate(s.f.p.receipt.id, "2026-10-10");
      if (mode === "CASHIER")
        await s.repo.confirmCashierNumber(s.f.p.receipt.id, "000012");
      if (mode === "LINE")
        await s.a.runAsync(
          "UPDATE waste_lines SET total_price='9', weight=NULL, unit_price=NULL WHERE id=?",
          s.f.p.lines[0]!.id,
        );
      if (mode === "PRODUCT")
        await s.a.runAsync(
          "UPDATE products SET nature='BULK', sales_unit='KG', version=version+1 WHERE id=?",
          s.product.id,
        );
      if (mode === "EXCLUSION")
        await s.repo.setLineExcluded(
          s.f.p.receipt.id,
          s.f.p.lines[1]!.id,
          false,
        );
      if (mode === "SOURCE")
        await s.a.runAsync(
          "UPDATE source_documents SET checksum='sha256:changed' WHERE id=?",
          s.f.p.source.id,
        );
      await expect(
        s.controller.confirm(s.message, s.request.basisHash, true),
      ).rejects.toThrow();
      expect(s.count("waste_observations")).toBe(0);
      expect(s.count("copilot_tool_results")).toBe(0);
    } finally {
      s.db.close();
    }
  },
);
it.each([
  "MISSING_DATE",
  "MATCH",
  "AMOUNT",
  "DUPLICATE",
  "SYNC",
  "SOURCE_UPLOAD",
  "SOURCE_SYNC",
])(
  "shows canonical targeted blockers and does not publish (%s)",
  async (mode) => {
    const s = await nativeReceiptPublicationFixture();
    try {
      if (mode === "MISSING_DATE")
        await s.a.runAsync(
          "UPDATE waste_receipts SET confirmed_waste_date=NULL WHERE id=?",
          s.f.p.receipt.id,
        );
      if (mode === "MATCH")
        await s.a.runAsync(
          "UPDATE waste_lines SET match_status='AMBIGUOUS' WHERE id=?",
          s.f.p.lines[0]!.id,
        );
      if (mode === "AMOUNT")
        await s.a.runAsync(
          "UPDATE waste_lines SET total_price='99' WHERE id=?",
          s.f.p.lines[0]!.id,
        );
      if (mode === "DUPLICATE")
        await s.a.runAsync(
          "UPDATE waste_receipts SET duplicate_status='POSSIBLE_DUPLICATE' WHERE id=?",
          s.f.p.receipt.id,
        );
      if (mode === "SYNC")
        await s.a.runAsync(
          "UPDATE products SET sync_state='CONFLICT' WHERE id=?",
          s.product.id,
        );
      if (mode === "SOURCE_SYNC")
        await s.a.runAsync(
          "UPDATE source_documents SET sync_state='CONFLICT' WHERE id=?",
          s.f.p.source.id,
        );
      if (mode === "SOURCE_UPLOAD")
        await s.a.runAsync(
          "UPDATE source_documents SET remote_upload_status='PENDING' WHERE id=?",
          s.f.p.source.id,
        );
      const state = await s.controller.open(s.message);
      expect(state.status).toBe("BLOCKED");
      expect(state.review?.issues.length).toBeGreaterThan(0);
      await expect(
        s.controller.confirm(s.message, state.review!.basisHash, true),
      ).rejects.toThrow();
      expect(s.count("waste_observations")).toBe(0);
    } finally {
      s.db.close();
    }
  },
);
it.each([
  "PERMISSION",
  "UNREVIEWED",
  "FORGED",
  "DELETED",
  "CANCELLED",
  "COMMIT",
])("refuses or rolls back the complete publication (%s)", async (mode) => {
  const s = await nativeReceiptPublicationFixture();
  try {
    if (mode === "PERMISSION") s.authority.canPublishWaste = false;
    if (mode === "UNREVIEWED") s.authority.receiptReviewed = false;
    if (mode === "FORGED") s.authority.authorizedRequestJson = "{}";
    if (mode === "DELETED")
      await s.a.runAsync(
        "UPDATE copilot_conversations SET payload_json=? WHERE id=?",
        JSON.stringify({
          ...s.f.chat.conversation,
          deletedMessageIds: [s.f.assistant.id],
        }),
        s.f.chat.conversation.id,
      );
    if (mode === "COMMIT") s.a.fail = true;
    const signal = new AbortController();
    if (mode === "CANCELLED") signal.abort();
    const initial = s.count("sync_outbox");
    await expect(
      s.runtime.execute(s.request, s.authority, signal.signal),
    ).rejects.toThrow();
    expect(s.count("waste_observations")).toBe(0);
    expect(s.count("source_records")).toBe(0);
    expect(s.count("copilot_tool_results")).toBe(0);
    expect(s.count("sync_outbox")).toBe(initial);
    expect((await s.repo.getReceipt(s.f.p.receipt.id))?.processingStatus).toBe(
      "TO_VALIDATE",
    );
  } finally {
    s.db.close();
  }
});
it("recognizes publication completed outside the chat without creating another command", async () => {
  const s = await nativeReceiptPublicationFixture();
  try {
    await new WasteReceiptPublicationRepository(s.a).publish({
      receiptId: s.f.p.receipt.id,
      storeId: s.scope.storeId,
      deviceId: s.scope.deviceId,
      commandId: randomUUID(),
      analyticsJobId: randomUUID(),
      timestamp: new Date().toISOString(),
    });
    const initial = s.count("sync_outbox");
    expect(
      (await s.controller.confirm(s.message, s.request.basisHash, true)).status,
    ).toBe("ALREADY_PUBLISHED");
    expect(s.count("sync_outbox")).toBe(initial);
    expect(s.count("copilot_tool_results")).toBe(0);
  } finally {
    s.db.close();
  }
});
it("bounds complete review without sampling or hiding a blocker beyond the first page", async () => {
  const s = await nativeReceiptPublicationFixture();
  try {
    const base = s.f.p.lines[0]!;
    for (let n = 2; n < 101; n++)
      await insertLine(s.a, { ...base, id: randomUUID(), sourceLineIndex: n });
    await expect(s.controller.open(s.message)).rejects.toThrow("LIMIT");
    expect(s.count("waste_observations")).toBe(0);
  } finally {
    s.db.close();
  }
});
it("publishes the latest human corrections after a renewed review, never the old server extraction", async () => {
  const s = await nativeReceiptPublicationFixture();
  try {
    await s.repo.confirmWasteDate(s.f.p.receipt.id, "2026-10-09");
    await s.repo.confirmCashierNumber(s.f.p.receipt.id, "000123");
    const review = await s.controller.open(s.message);
    expect(review.review?.receipt.confirmedCashierNumber).toBe("000123");
    expect(
      (await s.controller.confirm(s.message, review.review!.basisHash, true))
        .status,
    ).toBe("COMPLETED");
    const row = await s.a.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM sync_outbox WHERE command_type='WASTE_RECEIPT_PUBLISH'",
    );
    expect(
      wastePublicationSchema.parse(JSON.parse(row!.payload_json)).receipt,
    ).toMatchObject({
      confirmedCashierNumber: "000123",
      confirmedWasteDate: "2026-10-09",
    });
  } finally {
    s.db.close();
  }
});
it("keeps a conflicted product blocked even when its excluded occurrence comes first", async () => {
  const s = await nativeReceiptPublicationFixture();
  try {
    await s.a.runAsync(
      "UPDATE waste_lines SET source_line_index=2 WHERE id=?",
      s.f.p.lines[0]!.id,
    );
    await s.a.runAsync(
      "UPDATE waste_lines SET source_line_index=0,matched_product_id=? WHERE id=?",
      s.product.id,
      s.f.p.lines[1]!.id,
    );
    await s.a.runAsync(
      "UPDATE waste_lines SET source_line_index=1 WHERE id=?",
      s.f.p.lines[0]!.id,
    );
    await s.a.runAsync(
      "UPDATE products SET sync_state='CONFLICT' WHERE id=?",
      s.product.id,
    );
    expect((await s.controller.open(s.message)).status).toBe("BLOCKED");
  } finally {
    s.db.close();
  }
});
it.each(["OWNER", "STORE", "DELETED_PARENT", "PERMISSION"])(
  "does not replay through revoked private or publication authority (%s)",
  async (mode) => {
    const s = await nativeReceiptPublicationFixture();
    try {
      await s.runtime.execute(s.request, s.authority);
      const initial = s.count("sync_outbox");
      if (mode === "OWNER") s.authority.ownerId = randomUUID();
      if (mode === "STORE") s.authority.storeId = randomUUID();
      if (mode === "PERMISSION") s.authority.canPublishWaste = false;
      if (mode === "DELETED_PARENT")
        await s.a.runAsync(
          "UPDATE copilot_conversations SET payload_json=? WHERE id=?",
          JSON.stringify({
            ...s.f.chat.conversation,
            deletedMessageIds: [s.f.assistant.id],
          }),
          s.f.chat.conversation.id,
        );
      await expect(s.runtime.execute(s.request, s.authority)).rejects.toThrow();
      expect(s.count("sync_outbox")).toBe(initial);
      expect(s.count("waste_observations")).toBe(1);
    } finally {
      s.db.close();
    }
  },
);
it("rechecks the complete native basis inside the runtime transaction, beyond the card controller", async () => {
  const s = await nativeReceiptPublicationFixture();
  try {
    await s.repo.confirmCashierNumber(s.f.p.receipt.id, "000999");
    await expect(s.runtime.execute(s.request, s.authority)).rejects.toThrow();
    expect(s.count("waste_observations")).toBe(0);
    expect(s.count("copilot_tool_results")).toBe(0);
  } finally {
    s.db.close();
  }
});
it("rolls back observations, command, source status and journal if cancelled after the publication writer starts", async () => {
  const s = await nativeReceiptPublicationFixture(),
    abort = new AbortController();
  try {
    const initial = s.count("sync_outbox");
    s.a.afterRun = (sql) => {
      if (sql.includes("INSERT INTO waste_observations")) abort.abort();
    };
    await expect(
      s.runtime.execute(s.request, s.authority, abort.signal),
    ).rejects.toThrow();
    expect(abort.signal.aborted).toBe(true);
    expect(s.count("waste_observations")).toBe(0);
    expect(s.count("source_records")).toBe(0);
    expect(s.count("copilot_tool_results")).toBe(0);
    expect(s.count("sync_outbox")).toBe(initial);
    expect((await s.repo.getReceipt(s.f.p.receipt.id))?.processingStatus).toBe(
      "TO_VALIDATE",
    );
  } finally {
    s.db.close();
  }
});
