import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ReceiptTestDatabase } from "../../../../scripts/test-receipt-publication-sqlite";
import {
  chatImportFixture,
  chatImportCatalogueChoice,
} from "../../../../scripts/test-chat-import-fixtures";
import { CopilotMercalysImportController } from "./mercalys-import-controller";
const count = (
  s: Awaited<ReturnType<typeof chatImportFixture>>,
  table: string,
) => Number(s.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n);
it.each([false, true])(
  "publishes after a native non-suggested target selection, preserving source values and replaying once (no code: %s)",
  async (withoutCode) => {
    const s = await chatImportFixture();
    try {
      const { file, review, resolution, targetId, choice } =
        await chatImportCatalogueChoice(s, "MERCALYS_SALES", withoutCode);
      const original = s.db
        .prepare("SELECT * FROM products WHERE id=?")
        .get(targetId);
      expect(resolution.candidateProductIds).not.toContain(targetId);
      expect(count(s, "sales_observations")).toBe(1);
      await expect(
        s.controller.resolve(file.message, review, {
          resolutionKey: resolution.key,
          productId: targetId,
        }),
      ).rejects.toThrow();
      const result = await s.controller.resolve(file.message, review, choice);
      expect(result.mapping).toMatchObject({
        productId: targetId,
        sourceLabel: resolution.label,
        selection: "CATALOGUE",
        sourceIndexes: resolution.sourceIndexes,
      });
      const commands = count(s, "sync_outbox");
      await s.controller.resolve(file.message, review, choice);
      expect(count(s, "sync_outbox")).toBe(commands);
      expect(
        s.db.prepare("SELECT * FROM products WHERE id=?").get(targetId),
      ).toEqual(original);
      expect((await s.controller.run(file.message)).items[0]?.status).toBe(
        "PUBLISHED",
      );
      expect(count(s, "products")).toBe(2);
      expect(count(s, "sales_observations")).toBe(2);
      expect(
        s.db
          .prepare(
            "SELECT quantity,sales_value FROM sales_observations WHERE product_id=?",
          )
          .get(targetId),
      ).toMatchObject({ quantity: "1", sales_value: "5" });
      const table = withoutCode ? "product_aliases" : "product_identifiers";
      expect(
        Number(
          s.db
            .prepare(
              `SELECT COUNT(*) n FROM ${table} WHERE product_id=? AND status='VALIDATED'`,
            )
            .get(targetId)!.n,
        ),
      ).toBe(1);
      await s.controller.run(file.message);
      expect(count(s, "sales_observations")).toBe(2);
    } finally {
      s.db.close();
    }
  },
);
it.each([
  "PERMISSION",
  "DELETED",
  "SOURCE",
  "OWNER",
  "STALE_PRODUCT",
  "STALE_IDENTITY",
  "CONFLICT",
  "INACTIVE",
  "FOREIGN",
  "COMMIT",
  "CANCEL",
])(
  "protects an explicit catalogue choice against authority/version/commit failure (%s)",
  async (mode) => {
    const s = await chatImportFixture();
    try {
      const {
        file,
        review,
        targetId,
        choice: initialChoice,
      } = await chatImportCatalogueChoice(s);
      let choice = initialChoice;
      const abort = new AbortController();
      if (mode === "PERMISSION") s.scope.canImport = false;
      if (mode === "DELETED")
        await s.chat.removeMessage(s.conversation.id, file.message.id);
      if (mode === "SOURCE")
        s.bytes.set(file.batch.files[0]!.localUri, new Uint8Array([0]));
      if (mode === "OWNER") s.scope.ownerId = randomUUID();
      if (mode === "STALE_PRODUCT")
        await s.a.runAsync(
          "UPDATE products SET label='Autre produit' WHERE id=?",
          targetId,
        );
      if (mode === "STALE_IDENTITY")
        await s.a.runAsync(
          "UPDATE product_identifiers SET value='00000002' WHERE product_id=?",
          s.productId,
        );
      if (mode === "CONFLICT")
        await s.a.runAsync(
          "UPDATE products SET sync_state='CONFLICT' WHERE id=?",
          targetId,
        );
      if (mode === "INACTIVE")
        await s.a.runAsync(
          "UPDATE products SET status='INACTIVE' WHERE id=?",
          targetId,
        );
      if (mode === "FOREIGN") choice = { ...choice, productId: randomUUID() };
      if (mode === "COMMIT") s.a.fail = true;
      if (mode === "CANCEL")
        s.a.afterRun = (sql) => {
          if (sql.includes("INSERT INTO product_identifiers")) abort.abort();
        };
      const commands = count(s, "sync_outbox"),
        journals = count(s, "copilot_tool_results"),
        identifiers = count(s, "product_identifiers");
      await expect(
        s.controller.resolve(file.message, review, choice, abort.signal),
      ).rejects.toThrow();
      expect(count(s, "sync_outbox")).toBe(commands);
      expect(count(s, "copilot_tool_results")).toBe(journals);
      expect(count(s, "product_identifiers")).toBe(identifiers);
      expect(count(s, "sales_observations")).toBe(1);
    } finally {
      s.db.close();
    }
  },
);
it("does not bypass an existing owner's code with a fresh explicit catalogue selection", async () => {
  const s = await chatImportFixture();
  try {
    const { file, targetId, choice } = await chatImportCatalogueChoice(s);
    await s.a.runAsync(
      "INSERT INTO product_identifiers(id,store_id,product_id,type,value,source,status,version,created_at,updated_at,sync_state,remote_version,dirty) VALUES(?,?,?,'ITM8','00000002','USER','TO_REVIEW',1,?,?,'SYNCED',1,0)",
      randomUUID(),
      s.scope.storeId,
      s.productId,
      new Date().toISOString(),
      new Date().toISOString(),
    );
    const fresh = (await s.controller.run(file.message)).items[0]!;
    if (fresh.status !== "REVIEW") throw Error("Expected conflict review");
    await expect(
      s.controller.resolve(file.message, fresh, choice),
    ).rejects.toThrow();
    expect(count(s, "sales_observations")).toBe(1);
    expect(
      Number(
        s.db
          .prepare(
            "SELECT COUNT(*) n FROM product_identifiers WHERE product_id=?",
          )
          .get(targetId)!.n,
      ),
    ).toBe(0);
  } finally {
    s.db.close();
  }
});
it("recovers a confirmed catalogue selection after database reopen without repeating writes or bypassing revoked permission", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-catalogue-choice-")),
    path = join(dir, "native.db");
  const s = await chatImportFixture(path);
  let reopened: DatabaseSync | undefined;
  try {
    const { file, review, choice } = await chatImportCatalogueChoice(s);
    await s.a.runAsync(
      "UPDATE products SET sync_state='SYNCED',dirty=0,remote_version=1 WHERE id=?",
      choice.productId,
    );
    const saved = await s.controller.resolve(file.message, review, choice);
    const commands = count(s, "sync_outbox"),
      journals = count(s, "copilot_tool_results");
    s.db.close();
    reopened = new DatabaseSync(path);
    const adapter = new ReceiptTestDatabase(reopened),
      controller = new CopilotMercalysImportController(
        adapter,
        s.scope,
        s.deps,
      );
    expect(await controller.resolve(file.message, review, choice)).toEqual(
      saved,
    );
    expect(
      Number(reopened.prepare("SELECT COUNT(*) n FROM sync_outbox").get()!.n),
    ).toBe(commands);
    expect(
      Number(
        reopened.prepare("SELECT COUNT(*) n FROM copilot_tool_results").get()!
          .n,
      ),
    ).toBe(journals);
    s.scope.canImport = false;
    await expect(
      controller.resolve(file.message, review, choice),
    ).rejects.toThrow();
    s.scope.canImport = true;
    expect((await controller.run(file.message)).items[0]?.status).toBe(
      "PUBLISHED",
    );
    expect(
      Number(
        reopened.prepare("SELECT COUNT(*) n FROM sales_observations").get()!.n,
      ),
    ).toBe(2);
  } finally {
    reopened?.close();
    if (!reopened) s.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("keeps draft/attachments, creates unique references without AI category assistance, publishes offline and restarts without duplicates", async () => {
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
      category: "UNKNOWN",
      nature: "UNKNOWN",
      sales_unit: "UNKNOWN",
    });
    expect(s.calls()).toBe(0);
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
      expect(s.calls()).toBe(0);
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
    expect(count(s, "sales_observations")).toBe(1);
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
it("fills only literal source fields without inventing a category or replacing a known unit", async () => {
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
    ).toMatchObject({
      category: "UNKNOWN",
      nature: "BULK",
      sales_unit: "PIECE",
    });
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
      policyVersion: 2,
      batchId: batch.id,
      label: "Deux fichiers",
      manifestHash: await importManifestHash(batch, chatImportDigest),
    });
    const report = await s.controller.run(message);
    expect(report.items.map((i) => i.status)).toEqual(["REVIEW", "REVIEW"]);
    expect(count(s, "products")).toBe(1);
    expect(count(s, "sales_observations")).toBe(2);
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
it("processes retained distinct daily files without any model assistance", async () => {
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
      policyVersion: 2,
      batchId: batch.id,
      label: "Deux jours",
      manifestHash: await importManifestHash(batch, chatImportDigest),
    });
    const report = await s.controller.run(message);
    expect(report.items.map((i) => i.status)).toEqual([
      "PUBLISHED",
      "PUBLISHED",
    ]);
    expect(s.calls()).toBe(0);
    expect(count(s, "products")).toBe(3);
    await s.controller.run(message);
    expect(s.calls()).toBe(0);
    expect(count(s, "sales_observations")).toBe(4);
  } finally {
    s.db.close();
  }
});
it("preserves source-bound historical assistance without requesting a new classification", async () => {
  const s = await chatImportFixture();
  try {
    const f = await s.add({ unknownLabel: "POIRE TEST" });
    const item = await s.batches.get(f.batch.id, f.batch.files[0]!.id);
    const historical = {
      labelsHash: await s.deps.digest(JSON.stringify(["POIRE TEST"])),
      attemptedCount: 1,
      result: {
        model: "historical-model",
        suggestions: [
          {
            label: "POIRE TEST",
            category: "FRUIT" as const,
            confidence: 0.99,
            reason: "Retained original result",
          },
        ],
      },
    };
    await s.batches.saveAssistance(
      f.batch.id,
      item.id,
      item.version,
      historical,
    );
    expect((await s.controller.run(f.message)).items[0]?.status).toBe(
      "PUBLISHED",
    );
    expect((await s.batches.get(f.batch.id, item.id)).assistance).toEqual(
      historical,
    );
    expect(s.calls()).toBe(0);
  } finally {
    s.db.close();
  }
});
it("does not start model assistance or create a classification attempt for retained imports", async () => {
  const s = await chatImportFixture();
  try {
    const f = await s.add();
    s.deps.classify = async () => {
      throw Error("AI must not be called");
    };
    expect((await s.controller.run(f.message)).items[0]?.status).toBe(
      "PUBLISHED",
    );
    expect(
      (await s.batches.get(f.batch.id, f.batch.files[0]!.id)).assistance,
    ).toBeUndefined();
    expect(s.calls()).toBe(0);
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
    expect(count(s, "sales_observations")).toBe(2);
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
