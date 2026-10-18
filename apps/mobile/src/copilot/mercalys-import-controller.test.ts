import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ReceiptTestDatabase } from "../../../../scripts/test-receipt-publication-sqlite";
import { chatImportFixture } from "../../../../scripts/test-chat-import-fixtures";
import { CopilotMercalysImportController } from "./mercalys-import-controller";
const count = (
  s: Awaited<ReturnType<typeof chatImportFixture>>,
  table: string,
) => Number(s.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n);
it("keeps draft/attachments, creates unique references with cached semantic category, publishes offline and restarts without duplicates", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-chat-import-")),
    path = join(dir, "native.db"),
    s = await chatImportFixture(path);
  try {
    await s.chat.edit(s.conversation.id, {
      text: "Ma question à conserver",
      attachments: [],
    });
    const f = await s.add();
    const original = count(s, "sync_outbox");
    const report = await s.controller.run(f.message);
    expect(report.items[0]?.status).toBe("PUBLISHED");
    expect(await s.repo.draft(s.conversation.id)).toMatchObject({
      text: "Ma question à conserver",
    });
    expect(count(s, "products")).toBe(2);
    expect(count(s, "sales_observations")).toBe(2);
    expect(count(s, "sync_outbox")).toBeGreaterThan(original);
    expect(
      s.db
        .prepare("SELECT category,nature,sales_unit FROM products WHERE id!=?")
        .get(s.productId),
    ).toMatchObject({
      category: "FRUIT",
      nature: "UNKNOWN",
      sales_unit: "UNKNOWN",
    });
    expect(s.calls()).toBe(1);
    const commands = count(s, "sync_outbox");
    s.db.close();
    const reopened = new DatabaseSync(path),
      a = new ReceiptTestDatabase(reopened);
    try {
      await new CopilotMercalysImportController(a, s.scope, s.deps).run(
        f.message,
      );
      expect(
        Number(reopened.prepare("SELECT COUNT(*) n FROM sync_outbox").get()!.n),
      ).toBe(commands);
      expect(s.calls()).toBe(1);
    } finally {
      reopened.close();
    }
  } finally {
    try {
      s.db.close();
    } catch {
      /* Closed for restart. */
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
it.each(["OFFLINE", "FOREIGN_LABEL", "LOW_CONFIDENCE"])(
  "continues publication with UNKNOWN category when assistance cannot establish it (%s)",
  async (mode) => {
    const s = await chatImportFixture();
    try {
      const f = await s.add();
      s.deps.classify = async (labels) => {
        if (mode === "OFFLINE") throw Error("private provider info");
        return {
          model: "test",
          suggestions: [
            {
              label: mode === "FOREIGN_LABEL" ? "injected" : labels[0]!,
              category: "FRUIT",
              confidence: mode === "LOW_CONFIDENCE" ? 0.5 : 1,
              reason: "test",
            },
          ],
        };
      };
      expect((await s.controller.run(f.message)).items[0]?.status).toBe(
        "PUBLISHED",
      );
      expect(
        s.db
          .prepare("SELECT category FROM products WHERE id!=?")
          .get(s.productId)!.category,
      ).toBe("UNKNOWN");
    } finally {
      s.db.close();
    }
  },
);
it.each(["PERMISSION", "DELETED", "SOURCE", "OWNER", "COMMIT", "CANCEL"])(
  "refuses or rolls back automatic business writes (%s)",
  async (mode) => {
    const s = await chatImportFixture();
    try {
      const f = await s.add(),
        products = count(s, "products"),
        commands = count(s, "sync_outbox"),
        abort = new AbortController();
      if (mode === "PERMISSION") s.scope.canImport = false;
      if (mode === "OWNER") s.scope.ownerId = randomUUID();
      if (mode === "DELETED")
        await s.chat.removeMessage(s.conversation.id, f.message.id);
      if (mode === "SOURCE")
        s.bytes.set(f.batch.files[0]!.localUri, new Uint8Array([1, 2]));
      if (mode === "COMMIT") s.a.fail = true;
      if (mode === "CANCEL")
        s.a.afterRun = (sql) => {
          if (sql.includes("INSERT INTO products")) abort.abort();
        };
      await s.controller.run(f.message, abort.signal).catch(() => undefined);
      expect(count(s, "products")).toBe(products);
      expect(count(s, "sales_observations")).toBe(0);
      if (!["DELETED", "SOURCE"].includes(mode))
        expect(count(s, "sync_outbox")).toBe(commands);
    } finally {
      s.db.close();
    }
  },
);
it("does not publish corrected overlaps automatically and atomically applies a reviewed replacement once", async () => {
  const s = await chatImportFixture();
  try {
    const first = await s.add({ review: false });
    await s.controller.run(first.message);
    const second = await s.add({ review: false, sales: 20 });
    const report = await s.controller.run(second.message),
      review = report.items[0]!;
    expect(review.status).toBe("REVIEW");
    if (review.status !== "REVIEW") throw Error("review");
    expect(review.overlap?.counts.MODIFIED).toBe(1);
    expect(
      s.db
        .prepare(
          "SELECT sales_value FROM sales_observations WHERE deleted_at IS NULL",
        )
        .get()!.sales_value,
    ).toBe("12.4");
    await s.controller.resolve(second.message, review, {
      overlap: "APPLY_NEW",
    });
    await s.controller.resolve(second.message, review, {
      overlap: "APPLY_NEW",
    });
    expect(
      s.db
        .prepare(
          "SELECT sales_value FROM sales_observations WHERE deleted_at IS NULL",
        )
        .get()!.sales_value,
    ).toBe("20");
    expect(count(s, "source_documents")).toBe(2);
    expect(count(s, "import_reconciliations")).toBe(1);
  } finally {
    s.db.close();
  }
});
it("retains KEEP_EXISTING after restart/retry without repeated decisions", async () => {
  const s = await chatImportFixture();
  try {
    const first = await s.add({ review: false });
    await s.controller.run(first.message);
    const second = await s.add({ review: false, sales: 20 });
    const r = (await s.controller.run(second.message)).items[0]!;
    if (r.status !== "REVIEW") throw Error("review");
    await s.controller.resolve(second.message, r, { overlap: "KEEP_EXISTING" });
    expect((await s.controller.run(second.message)).items[0]?.status).toBe(
      "KEPT",
    );
    expect(count(s, "import_reconciliations")).toBe(1);
    expect(count(s, "sales_observations")).toBe(1);
  } finally {
    s.db.close();
  }
});
it("requires fresh current review for overlap choices and rolls back failed publication with its journal", async () => {
  const s = await chatImportFixture();
  try {
    const first = await s.add({ review: false });
    await s.controller.run(first.message);
    const second = await s.add({ review: false, sales: 20 });
    const r = (await s.controller.run(second.message)).items[0]!;
    if (r.status !== "REVIEW") throw Error("review");
    await s.a.runAsync(
      "UPDATE sales_observations SET sales_value='18' WHERE deleted_at IS NULL",
    );
    await expect(
      s.controller.resolve(second.message, r, { overlap: "APPLY_NEW" }),
    ).rejects.toThrow();
    expect(count(s, "source_documents")).toBe(1);
  } finally {
    s.db.close();
  }
});
it("keeps sales and waste channels separate and source quantity intact", async () => {
  const s = await chatImportFixture();
  try {
    const f = await s.add({ review: false, flow: "MERCALYS_WASTE" });
    expect((await s.controller.run(f.message)).items[0]?.status).toBe(
      "PUBLISHED",
    );
    expect(count(s, "sales_observations")).toBe(0);
    expect(count(s, "waste_observations")).toBe(1);
    const row = s.db
      .prepare("SELECT quantity,product_nature FROM waste_observations")
      .get()!;
    expect(row.quantity).toBe("2.5");
    expect(row.product_nature).toBe("BULK");
  } finally {
    s.db.close();
  }
});

it("asks only about fuzzy identities, persists an explicit choice and continues in chat", async () => {
  const s = await chatImportFixture();
  try {
    await s.a.runAsync(
      "UPDATE products SET label='PRODUIT A CONFIRMER' WHERE id=?",
      s.productId,
    );
    const f = await s.add({ unknownLabel: "PRODUIT A CONFIRMER VRAC" }),
      report = await s.controller.run(f.message),
      review = report.items[0]!;
    expect(review.status).toBe("REVIEW");
    if (review.status !== "REVIEW") throw Error("review");
    expect(review.resolutions).toHaveLength(1);
    expect(count(s, "sales_observations")).toBe(0);
    expect(count(s, "products")).toBe(1);
    const resolution = review.resolutions[0]!;
    expect(resolution.candidateProductIds).toContain(s.productId);
    // Transport acknowledgements alone do not invalidate the human comparison.
    await s.a.runAsync(
      "UPDATE products SET sync_state='SYNCED',dirty=0,remote_version=1 WHERE id=?",
      s.productId,
    );
    await s.controller.resolve(f.message, review, {
      resolutionKey: resolution.key,
      productId: s.productId,
    });
    expect((await s.controller.run(f.message)).items[0]?.status).toBe(
      "PUBLISHED",
    );
    expect(count(s, "products")).toBe(1);
    expect(
      s.db
        .prepare(
          "SELECT product_id FROM product_identifiers WHERE value='00000002'",
        )
        .get()!.product_id,
    ).toBe(s.productId);
  } finally {
    s.db.close();
  }
});
it("fills only UNKNOWN fields on existing matched products and keeps manually classified fields", async () => {
  const s = await chatImportFixture();
  try {
    await s.a.runAsync(
      "UPDATE products SET category='UNKNOWN',nature='UNKNOWN',sales_unit='PIECE' WHERE id=?",
      s.productId,
    );
    const f = await s.add({ review: false });
    await s.controller.run(f.message);
    expect(
      s.db
        .prepare("SELECT category,nature,sales_unit FROM products WHERE id=?")
        .get(s.productId),
    ).toMatchObject({ category: "FRUIT", nature: "BULK", sales_unit: "PIECE" });
    const version = s.db
      .prepare("SELECT version FROM products WHERE id=?")
      .get(s.productId)!.version;
    await s.controller.run(f.message);
    expect(
      s.db.prepare("SELECT version FROM products WHERE id=?").get(s.productId)!
        .version,
    ).toBe(version);
  } finally {
    s.db.close();
  }
});
it("blocks replacement of a conflicted existing observation", async () => {
  const s = await chatImportFixture();
  try {
    const first = await s.add({ review: false });
    await s.controller.run(first.message);
    const second = await s.add({ review: false, sales: 20 }),
      review = (await s.controller.run(second.message)).items[0]!;
    if (review.status !== "REVIEW") throw Error("review");
    await s.a.runAsync(
      "UPDATE sales_observations SET sync_state='CONFLICT' WHERE deleted_at IS NULL",
    );
    await expect(
      s.controller.resolve(second.message, review, { overlap: "APPLY_NEW" }),
    ).rejects.toThrow();
    expect(count(s, "source_documents")).toBe(1);
  } finally {
    s.db.close();
  }
});
it("does not duplicate an identifier attached to an inactive product", async () => {
  const s = await chatImportFixture();
  try {
    await s.a.runAsync(
      "UPDATE products SET status='INACTIVE' WHERE id=?",
      s.productId,
    );
    const f = await s.add({ review: false });
    const report = await s.controller.run(f.message);
    expect(report.items[0]?.status).toBe("REVIEW");
    expect(count(s, "products")).toBe(1);
    expect(count(s, "sales_observations")).toBe(0);
  } finally {
    s.db.close();
  }
});
it("preflights the complete lot before auto-creating an identifier claimed by different source labels", async () => {
  const s = await chatImportFixture();
  try {
    const a = await s.add({ date: "2026-10-07", unknownLabel: "ABRICOT VRAC" }),
      b = await s.add({ date: "2026-10-08", unknownLabel: "COURGETTE VRAC" });
    const batch = {
      ...a.batch,
      id: randomUUID(),
      files: [...a.batch.files, ...b.batch.files].map((f) => ({
        ...f,
        id: randomUUID(),
      })),
    };
    await s.batches.create(batch);
    const { importManifestHash } = await import("./mercalys-import-controller"),
      { chatImportDigest } =
        await import("../../../../scripts/test-chat-import-fixtures");
    const message = await s.chat.sendImportReference(s.conversation.id, {
      kind: "MERCALYS_CHAT_IMPORT",
      schemaVersion: 1,
      policyVersion: 1,
      batchId: batch.id,
      label: "Deux fichiers",
      manifestHash: await importManifestHash(batch, chatImportDigest),
    });
    const report = await s.controller.run(message);
    expect(report.items.map((i) => i.status)).toEqual(["REVIEW", "REVIEW"]);
    expect(count(s, "products")).toBe(1);
    expect(count(s, "sales_observations")).toBe(0);
    expect(s.calls()).toBe(0);
  } finally {
    s.db.close();
  }
});
it("records private outcome metadata once with real source periods for later dialogue", async () => {
  const s = await chatImportFixture();
  try {
    const f = await s.add({ review: false });
    await s.controller.run(f.message);
    const { readCopilotImportStatus } = await import("@fl-copilot/domain");
    const rows = await s.a.getAllAsync<{ payload_json: string }>(
      "SELECT payload_json FROM copilot_messages WHERE id!=? AND json_extract(payload_json,'$.role')='USER'",
      f.message.id,
    );
    expect(rows).toHaveLength(1);
    const status = readCopilotImportStatus(JSON.parse(rows[0]!.payload_json));
    expect(status.status.items[0]).toMatchObject({
      status: "PUBLISHED",
      start: "2026-10-07",
      end: "2026-10-07",
      sourceType: "MERCALYS_SALES",
    });
    expect(status.message.replyToMessageId).toBe(f.message.id);
    await s.controller.run(f.message);
    expect(
      (
        await s.a.getAllAsync(
          "SELECT id FROM copilot_messages WHERE id!=? AND json_extract(payload_json,'$.role')='USER'",
          f.message.id,
        )
      ).length,
    ).toBe(1);
  } finally {
    s.db.close();
  }
});
it("pools semantic work across distinct daily files rather than calling the model per workbook", async () => {
  const s = await chatImportFixture();
  try {
    const a = await s.add({
        date: "2026-10-07",
        unknownLabel: "ABRICOT VRAC",
        unknownCode: "00000002",
      }),
      b = await s.add({
        date: "2026-10-08",
        unknownLabel: "COURGETTE VRAC",
        unknownCode: "00000003",
      });
    const batch = {
      ...a.batch,
      id: randomUUID(),
      files: [...a.batch.files, ...b.batch.files].map((f) => ({
        ...f,
        id: randomUUID(),
      })),
    };
    await s.batches.create(batch);
    const { importManifestHash } = await import("./mercalys-import-controller"),
      { chatImportDigest } =
        await import("../../../../scripts/test-chat-import-fixtures");
    const message = await s.chat.sendImportReference(s.conversation.id, {
      kind: "MERCALYS_CHAT_IMPORT",
      schemaVersion: 1,
      policyVersion: 1,
      batchId: batch.id,
      label: "Deux jours",
      manifestHash: await importManifestHash(batch, chatImportDigest),
    });
    const report = await s.controller.run(message);
    expect(report.items.map((i) => i.status)).toEqual([
      "PUBLISHED",
      "PUBLISHED",
    ]);
    expect(s.calls()).toBe(1);
    expect(count(s, "products")).toBe(3);
    await s.controller.run(message);
    expect(s.calls()).toBe(1);
    expect(count(s, "sales_observations")).toBe(4);
  } finally {
    s.db.close();
  }
});
it("reserves a model attempt before interruption and does not charge that request again on resume", async () => {
  const s = await chatImportFixture();
  try {
    const f = await s.add(),
      abort = new AbortController();
    let calls = 0;
    s.deps.classify = async () => {
      calls++;
      abort.abort();
      throw Error("interrupted provider");
    };
    await expect(s.controller.run(f.message, abort.signal)).rejects.toThrow();
    expect(count(s, "products")).toBe(1);
    expect(
      (await s.batches.get(f.batch.id, f.batch.files[0]!.id)).assistance
        ?.attemptedCount,
    ).toBe(1);
    expect((await s.controller.run(f.message)).items[0]?.status).toBe(
      "PUBLISHED",
    );
    expect(calls).toBe(1);
  } finally {
    s.db.close();
  }
});
it("prepares a newly unambiguous reference after an earlier partial preparation without replaying the old subset", async () => {
  const s = await chatImportFixture();
  try {
    const inactive = randomUUID(),
      identifier = randomUUID(),
      t = "2026-10-18T08:00:00.000Z";
    await s.a.runAsync(
      "INSERT INTO products(id,store_id,label,category,nature,sales_unit,status,version,created_at,updated_at,sync_state,remote_version,dirty) VALUES(?,?,'Ancienne référence','UNKNOWN','UNKNOWN','UNKNOWN','INACTIVE',1,?,?,'SYNCED',1,0)",
      inactive,
      s.scope.storeId,
      t,
      t,
    );
    await s.a.runAsync(
      "INSERT INTO product_identifiers(id,store_id,product_id,type,value,source,status,version,created_at,updated_at,sync_state,remote_version,dirty) VALUES(?,?,?,'ITM8','00000003','MERCALYS','VALIDATED',1,?,?,'SYNCED',1,0)",
      identifier,
      s.scope.storeId,
      inactive,
      t,
      t,
    );
    const f = await s.add({
      extraUnknown: { code: "00000003", label: "ABRICOT VRAC" },
    });
    expect((await s.controller.run(f.message)).items[0]?.status).toBe("REVIEW");
    expect(count(s, "products")).toBe(3);
    expect(count(s, "sales_observations")).toBe(0);
    const { ProductMasterRepository } =
      await import("../products/product-master-repository");
    await new ProductMasterRepository(s.a).delete(
      "product_identifier",
      identifier,
      s.scope.storeId,
      new Date().toISOString(),
      {
        commandId: randomUUID(),
        deviceId: s.scope.deviceId,
        expectedRemoteVersion: 1,
      },
    );
    expect((await s.controller.run(f.message)).items[0]?.status).toBe(
      "PUBLISHED",
    );
    expect(count(s, "products")).toBe(4);
    expect(count(s, "sales_observations")).toBe(3);
  } finally {
    s.db.close();
  }
});
it("keeps import controls visible when private progress events exceed the visible history page", async () => {
  const s = await chatImportFixture();
  try {
    const f = await s.add({ review: false });
    await s.controller.run(f.message);
    const rows = await s.a.getAllAsync<{ payload_json: string }>(
      "SELECT payload_json FROM copilot_messages WHERE json_extract(payload_json,'$.replyToMessageId')=?",
      f.message.id,
    );
    const template = JSON.parse(rows[0]!.payload_json);
    for (let n = 0; n < 55; n++) {
      const m = {
        ...template,
        id: randomUUID(),
        createdAt: new Date(
          Date.parse(template.createdAt) + n + 1,
        ).toISOString(),
      };
      await s.a.runAsync(
        "INSERT INTO copilot_messages(id,store_id,owner_id,conversation_id,created_at,payload_json,sync_state,dirty) VALUES(?,?,?,?,?,?,'SYNCED',0)",
        m.id,
        m.storeId,
        m.ownerId,
        m.conversationId,
        m.createdAt,
        JSON.stringify(m),
      );
    }
    const history = await s.repo.messages(s.conversation.id, 1);
    expect(history.messages.map((m) => m.entity.id)).toEqual([f.message.id]);
    expect(history.hasMore).toBe(false);
  } finally {
    s.db.close();
  }
});
