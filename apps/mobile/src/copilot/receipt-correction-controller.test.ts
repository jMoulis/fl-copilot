import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import { receiptCorrectionFixture } from "../../../../scripts/test-receipt-correction-fixtures";
import { nativeReceiptCorrectionFixture } from "../../../../scripts/test-receipt-correction-sqlite";
import {
  ReceiptTestDatabase,
  receiptReviewDigest,
} from "../../../../scripts/test-receipt-publication-sqlite";
import { CopilotReceiptCorrectionController } from "./receipt-correction-controller";
import { ProductMasterRepository } from "../products/product-master-repository";
import { WasteReceiptPublicationRepository } from "../documents/waste-receipt-publication";
it("saves only reviewed draft fields offline, preserves siblings/source/product and replays once after restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-receipt-correct-")),
    path = join(dir, "local.db"),
    s = await nativeReceiptCorrectionFixture(path);
  let reopened: DatabaseSync | undefined;
  try {
    expect(s.correctionState.status).toBe("READY");
    expect(s.correctionState.review!.changes.map((c) => c.field)).toEqual([
      "wasteDate",
      "cashierNumber",
      "weight",
      "totalPrice",
    ]);
    const sibling = (await s.repo.listLines(s.f.p.receipt.id))[1]!,
      commands = s.count("sync_outbox");
    expect(
      (
        await s.correctionController.confirm(
          s.correctionMessage,
          s.correctionRequest.basisHash,
          true,
        )
      ).status,
    ).toBe("COMPLETED");
    const receipt = (await s.repo.getReceipt(s.f.p.receipt.id))!,
      lines = await s.repo.listLines(receipt.id);
    expect(receipt).toMatchObject({
      confirmedWasteDate: "2026-10-09",
      confirmedCashierNumber: "000123",
      processingStatus: "TO_VALIDATE",
      syncState: "LOCAL_ONLY",
    });
    expect(lines[0]).toMatchObject({
      weight: "2",
      totalPrice: "4",
      unitPrice: "2",
      rawLabel: s.f.p.lines[0]!.rawLabel,
      matchedProductId: s.product.id,
    });
    expect(lines[1]).toEqual(sibling);
    expect(
      (await new ProductMasterRepository(s.a).getProduct(s.product.id))?.entity,
    ).toEqual(s.product);
    expect(s.count("waste_observations")).toBe(0);
    expect(s.count("source_records")).toBe(0);
    expect(s.count("product_aliases")).toBe(0);
    expect(s.count("sync_outbox")).toBe(commands);
    const version = lines[0]!.version;
    s.db.close();
    reopened = new DatabaseSync(path);
    const db = new ReceiptTestDatabase(reopened);
    const controller = new CopilotReceiptCorrectionController(
      db,
      s.correctionScope,
      receiptReviewDigest,
    );
    expect(
      (
        await controller.confirm(
          s.correctionMessage,
          s.correctionRequest.basisHash,
          true,
        )
      ).status,
    ).toBe("COMPLETED");
    expect(
      (
        await db.getFirstAsync<{ version: number }>(
          "SELECT version FROM waste_lines WHERE id=?",
          lines[0]!.id,
        )
      )?.version,
    ).toBe(version);
  } finally {
    if (reopened) reopened.close();
    else s.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("corrects quantity/unit/label, explicitly clears values and selects/restores a known candidate as one transaction", async () => {
  const f = receiptCorrectionFixture(),
    first = f.p.lines[0]!,
    second = f.p.lines[1]!,
    productId = f.p.observations[0]!.productId;
  const s = await nativeReceiptCorrectionFixture(":memory:", f, {
    cashierNumber: null,
    lines: [
      {
        lineId: first.id,
        excluded: true,
        values: {
          rawLabel: "FIGUE CORRIGÉE",
          quantity: "3",
          quantityUnit: "PIECE",
          weight: null,
          unitPrice: null,
        },
      },
      { lineId: second.id, excluded: false, productId },
    ],
  });
  try {
    await s.correctionController.confirm(
      s.correctionMessage,
      s.correctionRequest.basisHash,
      true,
    );
    const lines = await s.repo.listLines(s.f.p.receipt.id);
    expect(lines[0]).toMatchObject({
      rawLabel: "FIGUE CORRIGÉE",
      quantity: "3",
      quantityUnit: "PIECE",
      weight: null,
      unitPrice: null,
      totalPrice: "3",
      validationStatus: "EXCLUDED",
    });
    expect(lines[1]).toMatchObject({
      validationStatus: "PENDING",
      matchedProductId: productId,
      matchStatus: "MATCHED",
      matchConfidence: 0.8,
    });
    expect(
      (await s.repo.getReceipt(s.f.p.receipt.id))?.confirmedCashierNumber,
    ).toBeNull();
    expect(s.count("product_aliases")).toBe(0);
  } finally {
    s.db.close();
  }
});
it("does not silently balance an arithmetic mismatch or publish it", async () => {
  const f = receiptCorrectionFixture(),
    s = await nativeReceiptCorrectionFixture(":memory:", f, {
      lines: [{ lineId: f.p.lines[0]!.id, values: { totalPrice: "99" } }],
    });
  try {
    expect(s.correctionState.review!.warnings).toHaveLength(1);
    await s.correctionController.confirm(
      s.correctionMessage,
      s.correctionRequest.basisHash,
      true,
    );
    expect((await s.repo.listLines(s.f.p.receipt.id))[0]).toMatchObject({
      totalPrice: "99",
      weight: "1.5",
      unitPrice: "2",
      validationStatus: "TO_REVIEW",
    });
    expect(
      (
        await new WasteReceiptPublicationRepository(s.a).inspect(
          s.f.p.receipt.id,
          s.scope.storeId,
        )
      ).issues.some((i) => i.field === "totalPrice"),
    ).toBe(true);
    expect(s.count("waste_observations")).toBe(0);
  } finally {
    s.db.close();
  }
});
it("suppresses unchanged edits and does not rewrite a published receipt", async () => {
  const f = receiptCorrectionFixture(),
    s = await nativeReceiptCorrectionFixture(":memory:", f, {
      cashierNumber: "000007",
    });
  try {
    expect(s.correctionState.status).toBe("UNCHANGED");
    const before = await s.repo.getReceipt(s.f.p.receipt.id);
    await expect(
      s.correctionController.confirm(
        s.correctionMessage,
        s.correctionRequest.basisHash,
        true,
      ),
    ).rejects.toThrow();
    expect(await s.repo.getReceipt(s.f.p.receipt.id)).toEqual(before);
    await s.controller.confirm(s.message, s.request.basisHash, true);
    expect(
      (await s.correctionController.open(s.correctionMessage)).status,
    ).toBe("READ_ONLY");
    await expect(
      s.correctionRuntime.execute(s.correctionRequest, s.correctionAuthority),
    ).rejects.toThrow();
  } finally {
    s.db.close();
  }
});
it.each(["DATE", "LINE", "PRODUCT", "CANDIDATE", "SOURCE", "SYNC"])(
  "rechecks native state inside the correction transaction (%s)",
  async (mode) => {
    const f = receiptCorrectionFixture(),
      s = await nativeReceiptCorrectionFixture(
        ":memory:",
        f,
        mode === "CANDIDATE"
          ? {
              lines: [
                {
                  lineId: f.p.lines[1]!.id,
                  productId: f.p.observations[0]!.productId,
                },
              ],
            }
          : f.input.patch,
      );
    try {
      if (mode === "DATE")
        await s.repo.confirmWasteDate(s.f.p.receipt.id, "2026-10-08");
      if (mode === "LINE")
        await s.a.runAsync(
          "UPDATE waste_lines SET total_price='6' WHERE id=?",
          s.f.p.lines[0]!.id,
        );
      if (mode === "PRODUCT")
        await s.a.runAsync(
          "UPDATE products SET sales_unit='KG',version=version+1 WHERE id=?",
          s.product.id,
        );
      if (mode === "CANDIDATE")
        await s.a.runAsync(
          "UPDATE waste_lines SET match_candidates_json='[]' WHERE id=?",
          s.f.p.lines[1]!.id,
        );
      if (mode === "SOURCE")
        await s.a.runAsync(
          "UPDATE source_documents SET checksum='changed' WHERE id=?",
          s.f.source.sourceDocumentId,
        );
      if (mode === "SYNC")
        await s.a.runAsync(
          "UPDATE waste_receipts SET sync_state='CONFLICT' WHERE id=?",
          s.f.p.receipt.id,
        );
      const before = await s.repo.getReceipt(s.f.p.receipt.id),
        lines = await s.repo.listLines(s.f.p.receipt.id);
      await expect(
        s.correctionRuntime.execute(s.correctionRequest, s.correctionAuthority),
      ).rejects.toThrow();
      expect(await s.repo.getReceipt(s.f.p.receipt.id)).toEqual(before);
      expect(await s.repo.listLines(s.f.p.receipt.id)).toEqual(lines);
      expect(s.count("copilot_tool_results")).toBe(0);
    } finally {
      s.db.close();
    }
  },
);
it.each(["PERMISSION", "REVIEW", "AUTHORITY", "DELETED", "CANCEL", "COMMIT"])(
  "refuses or rolls back all draft changes and the journal (%s)",
  async (mode) => {
    const s = await nativeReceiptCorrectionFixture();
    try {
      const before = await s.repo.getReceipt(s.f.p.receipt.id),
        lines = await s.repo.listLines(s.f.p.receipt.id),
        commands = s.count("sync_outbox"),
        abort = new AbortController();
      if (mode === "PERMISSION") s.correctionAuthority.canCorrectWaste = false;
      if (mode === "REVIEW") s.correctionAuthority.correctionReviewed = false;
      if (mode === "AUTHORITY")
        s.correctionAuthority.authorizedRequestJson = "{}";
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
      if (mode === "CANCEL")
        s.a.afterRun = (sql) => {
          if (sql.includes("UPDATE waste_lines")) abort.abort();
        };
      await expect(
        s.correctionRuntime.execute(
          s.correctionRequest,
          s.correctionAuthority,
          abort.signal,
        ),
      ).rejects.toThrow();
      if (mode === "CANCEL") expect(abort.signal.aborted).toBe(true);
      expect(await s.repo.getReceipt(s.f.p.receipt.id)).toEqual(before);
      expect(await s.repo.listLines(s.f.p.receipt.id)).toEqual(lines);
      expect(s.count("sync_outbox")).toBe(commands);
      expect(s.count("copilot_tool_results")).toBe(0);
    } finally {
      s.db.close();
    }
  },
);
it("rejects a foreign line and an arbitrary non-candidate product before any write", async () => {
  const s = await nativeReceiptCorrectionFixture();
  try {
    const { readReceiptCorrectionReview } =
      await import("./receipt-correction-review");
    for (const lines of [
      [{ lineId: randomUUID(), excluded: true }],
      [{ lineId: s.f.p.lines[1]!.id, productId: randomUUID() }],
    ])
      await expect(
        readReceiptCorrectionReview(
          s.a,
          s.f.source,
          { sourceDocumentId: s.f.source.sourceDocumentId, patch: { lines } },
          receiptReviewDigest,
        ),
      ).rejects.toThrow();
    expect(s.count("copilot_tool_results")).toBe(0);
  } finally {
    s.db.close();
  }
});
it.each(["OWNER", "STORE", "DELETED", "PERMISSION"])(
  "rechecks authority even on completed replay (%s)",
  async (mode) => {
    const s = await nativeReceiptCorrectionFixture();
    try {
      await s.correctionRuntime.execute(
        s.correctionRequest,
        s.correctionAuthority,
      );
      const before = await s.repo.getReceipt(s.f.p.receipt.id);
      if (mode === "OWNER") s.correctionAuthority.ownerId = randomUUID();
      if (mode === "STORE") s.correctionAuthority.storeId = randomUUID();
      if (mode === "PERMISSION") s.correctionAuthority.canCorrectWaste = false;
      if (mode === "DELETED")
        await s.a.runAsync(
          "UPDATE copilot_conversations SET payload_json=? WHERE id=?",
          JSON.stringify({
            ...s.f.chat.conversation,
            deletedMessageIds: [s.f.assistant.id],
          }),
          s.f.chat.conversation.id,
        );
      await expect(
        s.correctionRuntime.execute(s.correctionRequest, s.correctionAuthority),
      ).rejects.toThrow();
      expect(await s.repo.getReceipt(s.f.p.receipt.id)).toEqual(before);
      expect(s.count("copilot_tool_results")).toBe(1);
    } finally {
      s.db.close();
    }
  },
);
