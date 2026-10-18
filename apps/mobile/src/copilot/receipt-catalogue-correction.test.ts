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
import { ProductMasterRepository } from "../products/product-master-repository";
import { CopilotReceiptCorrectionController } from "./receipt-correction-controller";
import { readReceiptCorrectionReview } from "./receipt-correction-review";
async function fixture(path = ":memory:", version: 1 | 2 = 2) {
  const f = receiptCorrectionFixture(),
    productId = randomUUID();
  const s = await nativeReceiptCorrectionFixture(
    path,
    f,
    { lines: [{ lineId: f.p.lines[0]!.id, productId }] },
    {
      ...(version === 2 ? { schemaVersion: 2 } : {}),
      async beforeReview(base) {
        const repo = new ProductMasterRepository(base.a);
        await repo.upsertProduct(
          {
            ...base.product,
            id: productId,
            label: "FIGUE NOIRE VRAC",
            status: "ACTIVE",
            nature: "BULK",
            salesUnit: "KG",
          },
          { commandId: randomUUID(), deviceId: base.scope.deviceId },
        );
        await repo.upsertIdentifier(
          {
            id: randomUUID(),
            storeId: f.chat.storeId,
            productId,
            type: "PLU",
            source: "USER",
            value: "000471",
            status: "VALIDATED",
            version: 1,
            createdAt: base.product.createdAt,
            updatedAt: base.product.updatedAt,
            deletedAt: null,
          },
          { commandId: randomUUID(), deviceId: base.scope.deviceId },
        );
      },
    },
  );
  return { ...s, productId };
}
it("reviews an out-of-candidate product with its leading-zero code, preserves numbers/original/candidates, and replays once after restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-catalogue-receipt-")),
    path = join(dir, "local.db");
  const s = await fixture(path);
  let reopened: DatabaseSync | undefined;
  try {
    const before = await s.repo.listLines(s.f.p.receipt.id),
      receipt = await s.repo.getReceipt(s.f.p.receipt.id),
      commands = s.count("sync_outbox");
    const candidateRow = () =>
      s.db
        .prepare(
          "SELECT match_candidates_json,source_region_json FROM waste_lines WHERE id=?",
        )
        .get(before[0]!.id);
    const evidence = candidateRow();
    expect(s.correctionState.content.schemaVersion).toBe(2);
    expect(s.correctionState.review!.productChoices[0]).toMatchObject({
      label: "FIGUE NOIRE VRAC",
      nature: "BULK",
      salesUnit: "KG",
      identifiers: [{ value: "000471" }],
    });
    expect(s.correctionState.review!.changes).toMatchObject([
      { field: "product", after: "FIGUE NOIRE VRAC" },
    ]);
    expect(before[0]!.matchedProductId).not.toBe(s.productId);
    await s.correctionController.confirm(
      s.correctionMessage,
      s.correctionRequest.basisHash,
      true,
    );
    const after = await s.repo.listLines(s.f.p.receipt.id);
    expect(after[0]).toMatchObject({
      matchedProductId: s.productId,
      matchStatus: "MATCHED",
      matchConfidence: null,
      productNature: "BULK",
      quantity: before[0]!.quantity,
      weight: before[0]!.weight,
      unitPrice: before[0]!.unitPrice,
      totalPrice: before[0]!.totalPrice,
      rawLabel: before[0]!.rawLabel,
    });
    expect(after[1]).toEqual(before[1]);
    expect(candidateRow()).toEqual(evidence);
    expect(await s.repo.getReceipt(s.f.p.receipt.id)).toEqual(receipt);
    expect(s.count("waste_observations")).toBe(0);
    expect(s.count("source_records")).toBe(0);
    expect(s.count("product_aliases")).toBe(0);
    expect(s.count("sync_outbox")).toBe(commands);
    s.db.close();
    reopened = new DatabaseSync(path);
    const controller = new CopilotReceiptCorrectionController(
      new ReceiptTestDatabase(reopened),
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
      reopened
        .prepare("SELECT version FROM waste_lines WHERE id=?")
        .get(after[0]!.id),
    ).toEqual({ version: after[0]!.version });
  } finally {
    if (reopened) reopened.close();
    else s.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("does not expand candidate-only v1 authority or accept a model-controlled capability", async () => {
  const s = await fixture();
  try {
    await expect(
      readReceiptCorrectionReview(
        s.a,
        s.f.source,
        s.input,
        receiptReviewDigest,
        1,
      ),
    ).rejects.toThrow("CANDIDATE_UNAVAILABLE");
    const { receiptCorrectionInputSchema } = await import("@fl-copilot/domain");
    expect(
      receiptCorrectionInputSchema.safeParse({ ...s.input, schemaVersion: 2 })
        .success,
    ).toBe(false);
    expect(s.count("copilot_tool_results")).toBe(0);
  } finally {
    s.db.close();
  }
});
it.each([
  "LABEL",
  "VERSION",
  "NATURE",
  "CODE",
  "RETIRED",
  "DELETED",
  "FOREIGN",
  "CONFLICT",
  "ERROR",
])(
  "invalidates the reviewed catalogue choice after target changes (%s)",
  async (mode) => {
    const s = await fixture();
    try {
      const before = await s.repo.listLines(s.f.p.receipt.id);
      const sql = (
        {
          LABEL: "label='Changed'",
          VERSION: "version=version+1",
          NATURE: "nature='PACKAGED'",
          RETIRED: "status='INACTIVE'",
          DELETED: "deleted_at='2026-10-18T10:00:00.000Z'",
          FOREIGN: `store_id='${randomUUID()}'`,
          CONFLICT: "sync_state='CONFLICT'",
          ERROR: "sync_state='ERROR'",
        } as Record<string, string>
      )[mode];
      if (mode === "CODE")
        await s.a.runAsync(
          "UPDATE product_identifiers SET value='000472',version=version+1 WHERE product_id=?",
          s.productId,
        );
      else
        await s.a.runAsync(
          `UPDATE products SET ${sql} WHERE id=?`,
          s.productId,
        );
      await expect(
        s.correctionController.confirm(
          s.correctionMessage,
          s.correctionRequest.basisHash,
          true,
        ),
      ).rejects.toThrow();
      expect(await s.repo.listLines(s.f.p.receipt.id)).toEqual(before);
      expect(s.count("copilot_tool_results")).toBe(0);
    } finally {
      s.db.close();
    }
  },
);
it.each(["CANCEL", "COMMIT", "NO_REVIEW", "ROLE"])(
  "never partly applies a catalogue correction (%s)",
  async (mode) => {
    const s = await fixture();
    try {
      const before = await s.repo.listLines(s.f.p.receipt.id),
        abort = new AbortController();
      if (mode === "CANCEL")
        s.a.afterRun = (sql) => {
          if (sql.includes("UPDATE waste_lines")) abort.abort();
        };
      if (mode === "COMMIT") s.a.fail = true;
      if (mode === "ROLE") s.correctionAuthority.canCorrectWaste = false;
      if (mode === "NO_REVIEW")
        s.correctionAuthority.correctionReviewed = false;
      await expect(
        s.correctionRuntime.execute(
          s.correctionRequest,
          s.correctionAuthority,
          abort.signal,
        ),
      ).rejects.toThrow();
      expect(await s.repo.listLines(s.f.p.receipt.id)).toEqual(before);
      expect(s.count("copilot_tool_results")).toBe(0);
      expect(s.count("product_aliases")).toBe(0);
    } finally {
      s.db.close();
    }
  },
);
it("allows an incomplete product profile after renewed review without inventing quantities or requiring catalogue cleanup", async () => {
  const s = await fixture();
  try {
    await s.a.runAsync(
      "UPDATE products SET status='TO_REVIEW',nature='UNKNOWN',sales_unit='UNKNOWN',version=version+1 WHERE id=?",
      s.productId,
    );
    const state = await s.correctionController.open(s.correctionMessage);
    expect(state.status).toBe("READY");
    expect(state.review!.productChoices[0]).toMatchObject({
      nature: "UNKNOWN",
      salesUnit: "UNKNOWN",
    });
    await s.correctionController.confirm(
      s.correctionMessage,
      state.review!.basisHash,
      true,
    );
    const line = (await s.repo.listLines(s.f.p.receipt.id))[0]!;
    expect(line).toMatchObject({
      matchedProductId: s.productId,
      productNature: "UNKNOWN",
      weight: s.f.p.lines[0]!.weight,
      totalPrice: s.f.p.lines[0]!.totalPrice,
    });
  } finally {
    s.db.close();
  }
});
it("refuses an unbounded product code review rather than silently truncating its identity", async () => {
  const s = await fixture();
  try {
    const repo = new ProductMasterRepository(s.a);
    for (let n = 0; n < 20; n++)
      await repo.upsertIdentifier(
        {
          id: randomUUID(),
          storeId: s.scope.storeId,
          productId: s.productId,
          type: "ITM8",
          value: `0000${String(n).padStart(4, "0")}`,
          source: "USER",
          status: "VALIDATED",
          version: 1,
          createdAt: s.product.createdAt,
          updatedAt: s.product.updatedAt,
          deletedAt: null,
        },
        { commandId: randomUUID(), deviceId: s.scope.deviceId },
      );
    await expect(
      s.correctionController.open(s.correctionMessage),
    ).rejects.toThrow("PRODUCT_LIMIT");
    expect(s.count("copilot_tool_results")).toBe(0);
  } finally {
    s.db.close();
  }
});
