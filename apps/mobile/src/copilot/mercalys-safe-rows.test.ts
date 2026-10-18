import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { readCopilotImportStatus } from "@fl-copilot/domain";
import {
  chatImportFixture,
  automaticPartialChatImportFixture,
} from "../../../../scripts/test-chat-import-fixtures";
import { ReceiptTestDatabase } from "../../../../scripts/test-receipt-publication-sqlite";
import {
  LocalAnalyticsRecomputationScheduler,
  SQLiteProductDateRecomputer,
} from "../analytics/local-recomputation";
import { readMercalysPublication } from "../documents/mercalys-publication-sync";
import { CopilotMercalysImportController } from "./mercalys-import-controller";

it.each(["MERCALYS_SALES", "MERCALYS_WASTE"] as const)(
  "automatically publishes only safe rows and retains the original, pending identity and private outcome (%s)",
  async (flow) => {
    const s = await automaticPartialChatImportFixture(flow);
    try {
      expect(s.review).toMatchObject({
        status: "REVIEW",
        publishedCount: 1,
        overlap: null,
        summary: { readyCount: 1, productReviewCount: 1, errorCount: 0 },
      });
      expect(s.initial.records.map((r) => [r.status, r.version])).toEqual([
        ["PUBLISHED", 1],
        ["WARNING", 1],
      ]);
      expect([...s.initial.sales, ...s.initial.waste]).toHaveLength(1);
      const first = [...s.initial.sales, ...s.initial.waste][0]!;
      expect(first).toMatchObject({
        productId: s.productId,
        quantity: "2.5",
        salesValue: "12.4",
      });
      expect(s.initial.records[1]!.normalizedPayload).toMatchObject({
        rawLabel: "PRODUIT A CONFIRMER VRAC",
        itm8: "00000002",
        quantity: 1,
        salesValue: 5,
      });
      expect(s.db.prepare("SELECT COUNT(*) n FROM products").get()!.n).toBe(1);
      expect(s.db.prepare("SELECT COUNT(*) n FROM local_files").get()!.n).toBe(
        1,
      );
      const states = await s.a.getAllAsync<{ payload_json: string }>(
        "SELECT payload_json FROM copilot_messages WHERE json_extract(payload_json,'$.replyToMessageId')=?",
        s.file.message.id,
      );
      expect(
        states.map(
          (r) =>
            readCopilotImportStatus(JSON.parse(r.payload_json)).status.items[0],
        ),
      ).toContainEqual(
        expect.objectContaining({
          status: "REVIEW",
          sourceDocumentId: s.publication.sourceDocumentId,
          publishedCount: 1,
          remainingCount: 1,
        }),
      );
      const packets = s.db
        .prepare(
          "SELECT * FROM sync_outbox WHERE entity_type='mercalys_publication'",
        )
        .all();
      await s.controller.run(s.file.message);
      await s.controller.run(s.file.message);
      expect(
        s.db
          .prepare(
            "SELECT * FROM sync_outbox WHERE entity_type='mercalys_publication'",
          )
          .all(),
      ).toEqual(packets);
      expect(
        await readMercalysPublication(
          s.a,
          s.scope.storeId,
          s.publication.sourceDocumentId,
        ),
      ).toEqual(s.initial);
      const scheduler = new LocalAnalyticsRecomputationScheduler(
        s.a,
        new SQLiteProductDateRecomputer(s.a),
      );
      expect(await scheduler.process(s.scope.storeId)).toMatchObject({
        failedJobs: 0,
        completedJobs: 1,
      });
      const metric =
        flow === "MERCALYS_SALES" ? "salesValue" : "wasteSalesValue";
      const partial = JSON.parse(
        s.db
          .prepare("SELECT payload_json FROM department_daily_performance")
          .get()!.payload_json as string,
      );
      expect(partial.availability[metric]).toMatchObject({
        status: "PARTIAL",
        reason: "MISSING_INPUT",
      });
      expect(
        flow === "MERCALYS_SALES"
          ? partial.sales.salesValue
          : partial.waste.salesValue,
      ).toBe("12.40");
      await s.controller.resolve(s.file.message, s.review, {
        resolutionKey: s.review.resolutions[0]!.key,
        productId: s.productId,
      });
      await s.controller.run(s.file.message);
      expect(await scheduler.process(s.scope.storeId)).toMatchObject({
        failedJobs: 0,
        completedJobs: 1,
      });
      const complete = JSON.parse(
        s.db
          .prepare("SELECT payload_json FROM department_daily_performance")
          .get()!.payload_json as string,
      );
      expect(complete.availability[metric].status).toBe("AVAILABLE");
      expect(
        flow === "MERCALYS_SALES"
          ? complete.sales.salesValue
          : complete.waste.salesValue,
      ).toBe("17.40");
      expect(s.calls()).toBe(0);
    } finally {
      s.db.close();
    }
  },
);

it.each(["MERCALYS_SALES", "MERCALYS_WASTE"] as const)(
  "publishes each newly resolved subset, resumes after reopen and never replays an old publication result (%s)",
  async (flow) => {
    const directory = mkdtempSync(join(tmpdir(), "fl-safe-subsets-")),
      path = join(directory, "native.db"),
      s = await chatImportFixture(path);
    let reopened: DatabaseSync | undefined;
    try {
      await s.a.runAsync(
        "UPDATE products SET label='PRODUIT A CONFIRMER' WHERE id=?",
        s.productId,
      );
      const file = await s.add({
        flow,
        unknownLabel: "PRODUIT A CONFIRMER VRAC",
        extraUnknown: {
          code: "00000003",
          label: "PRODUIT A CONFIRMER BIO VRAC",
        },
      });
      const initial = (await s.controller.run(file.message)).items[0]!;
      if (initial.status !== "REVIEW") throw Error("Expected review");
      expect(initial.publishedCount).toBe(1);
      expect(initial.resolutions).toHaveLength(2);
      const sourceId = initial.priorSourceDocumentId!,
        before = (await readMercalysPublication(
          s.a,
          s.scope.storeId,
          sourceId,
        ))!;
      const firstPacket = s.db
        .prepare(
          "SELECT * FROM sync_outbox WHERE entity_type='mercalys_publication'",
        )
        .all();
      await s.controller.resolve(file.message, initial, {
        resolutionKey: initial.resolutions[0]!.key,
        productId: s.productId,
      });
      const middle = (await s.controller.run(file.message)).items[0]!;
      expect(middle).toMatchObject({
        status: "REVIEW",
        publishedCount: 2,
        priorSourceDocumentId: sourceId,
      });
      if (middle.status !== "REVIEW") throw Error("Expected last question");
      expect(middle.resolutions).toHaveLength(1);
      await expect(
        s.controller.resolve(file.message, initial, {
          resolutionKey: initial.resolutions[1]!.key,
          productId: s.productId,
        }),
      ).rejects.toThrow();
      const second = (await readMercalysPublication(
        s.a,
        s.scope.storeId,
        sourceId,
      ))!;
      expect([...second.sales, ...second.waste]).toHaveLength(2);
      expect(second.records.map((r) => r.status)).toEqual(
        before.records.map((r) =>
          r.status === "PUBLISHED" ||
          initial.resolutions[0]!.sourceIndexes.includes(r.sourceIndex!)
            ? "PUBLISHED"
            : "WARNING",
        ),
      );
      expect(
        s.db
          .prepare(
            "SELECT * FROM sync_outbox WHERE entity_type='mercalys_publication' ORDER BY local_sequence LIMIT 1",
          )
          .all(),
      ).toEqual(firstPacket);
      s.db.close();
      reopened = new DatabaseSync(path);
      const adapter = new ReceiptTestDatabase(reopened),
        controller = new CopilotMercalysImportController(
          adapter,
          s.scope,
          s.deps,
        );
      const fresh = (await controller.run(file.message)).items[0]!;
      if (fresh.status !== "REVIEW") throw Error("Expected restored question");
      expect(fresh.publishedCount).toBe(2);
      expect(
        await readMercalysPublication(adapter, s.scope.storeId, sourceId),
      ).toEqual(second);
      await controller.resolve(file.message, fresh, {
        resolutionKey: fresh.resolutions[0]!.key,
        productId: s.productId,
      });
      expect((await controller.run(file.message)).items[0]).toMatchObject({
        status: "PUBLISHED",
        completedPartial: true,
        publishedCount: 3,
        sourceDocumentId: sourceId,
      });
      const complete = (await readMercalysPublication(
        adapter,
        s.scope.storeId,
        sourceId,
      ))!;
      expect(complete.records.map((r) => r.id)).toEqual(
        before.records.map((r) => r.id),
      );
      expect(complete.records.map((r) => r.version)).toEqual([1, 2, 2]);
      expect(
        [...complete.sales, ...complete.waste].find(
          (o) => o.sourceRecordId === before.records[0]!.id,
        ),
      ).toEqual([...before.sales, ...before.waste][0]);
      expect(
        reopened
          .prepare(
            "SELECT expected_remote_version FROM sync_outbox WHERE entity_type='mercalys_publication' ORDER BY local_sequence",
          )
          .all()
          .map((r) => r.expected_remote_version),
      ).toEqual([null, 1, 2]);
      const observations = [...complete.sales, ...complete.waste];
      expect(observations).toHaveLength(3);
      expect((await controller.run(file.message)).items[0]).toMatchObject({
        status: "PUBLISHED",
        alreadyPublished: true,
        publishedCount: 3,
      });
      expect(
        reopened.prepare("SELECT COUNT(*) n FROM source_documents").get()!.n,
      ).toBe(1);
      expect(
        reopened
          .prepare(
            "SELECT COUNT(*) n FROM sync_outbox WHERE entity_type='mercalys_publication'",
          )
          .get()!.n,
      ).toBe(3);
    } finally {
      if (reopened) reopened.close();
      else s.db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

it.each(["MERCALYS_SALES", "MERCALYS_WASTE"] as const)(
  "keeps parser anomalies outside automatic partial publication (%s)",
  async (flow) => {
    const s = await chatImportFixture();
    try {
      const file = await s.add({ flow, invalidQuantity: true });
      const result = (await s.controller.run(file.message)).items[0]!;
      expect(result).toMatchObject({
        status: "REVIEW",
        publishedCount: 0,
        priorSourceDocumentId: null,
        summary: { errorCount: 1, readyCount: 1 },
      });
      expect(
        s.db.prepare("SELECT COUNT(*) n FROM source_documents").get()!.n,
      ).toBe(0);
      expect(
        s.db
          .prepare(
            "SELECT COUNT(*) n FROM sync_outbox WHERE entity_type='mercalys_publication'",
          )
          .get()!.n,
      ).toBe(0);
    } finally {
      s.db.close();
    }
  },
);

it.each(["MERCALYS_SALES", "MERCALYS_WASTE"] as const)(
  "never auto-publishes a partial corrected overlap (%s)",
  async (flow) => {
    const s = await chatImportFixture();
    try {
      const first = await s.add({ flow, review: false });
      await s.controller.run(first.message);
      await s.a.runAsync(
        "UPDATE products SET label='PRODUIT A CONFIRMER' WHERE id=?",
        s.productId,
      );
      const file = await s.add({
        flow,
        sales: 20,
        unknownLabel: "PRODUIT A CONFIRMER VRAC",
      });
      const result = (await s.controller.run(file.message)).items[0]!;
      expect(result).toMatchObject({
        status: "REVIEW",
        publishedCount: 0,
        priorSourceDocumentId: null,
        overlap: { safeToApply: false },
      });
      expect(
        s.db.prepare("SELECT COUNT(*) n FROM source_documents").get()!.n,
      ).toBe(1);
      const table =
        flow === "MERCALYS_SALES" ? "sales_observations" : "waste_observations";
      expect(
        s.db
          .prepare(`SELECT sales_value FROM ${table} WHERE deleted_at IS NULL`)
          .all(),
      ).toEqual([{ sales_value: "12.4" }]);
    } finally {
      s.db.close();
    }
  },
);

it.each(["CANCEL", "COMMIT", "CONFLICT"])(
  "rolls back or blocks the initial partial publication with its source, jobs, journal and Outbox (%s)",
  async (mode) => {
    const s = await chatImportFixture();
    try {
      await s.a.runAsync(
        "UPDATE products SET label='PRODUIT A CONFIRMER' WHERE id=?",
        s.productId,
      );
      const f = await s.add({ unknownLabel: "PRODUIT A CONFIRMER VRAC" }),
        abort = new AbortController();
      if (mode === "CONFLICT")
        await s.a.runAsync(
          "UPDATE products SET sync_state='CONFLICT' WHERE id=?",
          s.productId,
        );
      if (mode === "CANCEL")
        s.a.afterRun = (sql) => {
          if (sql.includes("INSERT INTO sales_observations")) abort.abort();
        };
      if (mode === "COMMIT") s.a.fail = true;
      await s.controller.run(f.message, abort.signal).catch(() => undefined);
      for (const table of [
        "source_documents",
        "source_records",
        "local_files",
        "local_jobs",
        "sales_observations",
        "copilot_tool_results",
      ])
        expect(s.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n).toBe(
          0,
        );
      expect(
        s.db
          .prepare(
            "SELECT COUNT(*) n FROM sync_outbox WHERE entity_type='mercalys_publication'",
          )
          .get()!.n,
      ).toBe(0);
      s.a.fail = false;
      s.a.afterRun = undefined;
      await s.a.runAsync(
        "UPDATE products SET sync_state='SYNCED' WHERE id=?",
        s.productId,
      );
      expect((await s.controller.run(f.message)).items[0]).toMatchObject({
        status: "REVIEW",
        publishedCount: 1,
      });
    } finally {
      s.db.close();
    }
  },
);

it.each(["OTHER_DATE", "OTHER_STORE", "SUPERSEDED"])(
  "does not qualify today's metrics from an unrelated or superseded unresolved source (%s)",
  async (mode) => {
    const s = await automaticPartialChatImportFixture();
    try {
      if (mode === "OTHER_DATE")
        await s.a.runAsync(
          "UPDATE source_records SET normalized_payload_json=json_set(normalized_payload_json,'$.businessDate','2026-10-08') WHERE status='WARNING'",
        );
      if (mode === "OTHER_STORE")
        await s.a.runAsync(
          "UPDATE source_records SET store_id=? WHERE status='WARNING'",
          "11111111-1111-4111-8111-111111111111",
        );
      if (mode === "SUPERSEDED") {
        const corrected = await s.add({ review: false, sales: 20 });
        const review = (await s.controller.run(corrected.message)).items[0]!;
        if (review.status !== "REVIEW")
          throw Error("Expected explicit replacement");
        await s.controller.resolve(corrected.message, review, {
          overlap: "APPLY_NEW",
        });
      }
      const scheduler = new LocalAnalyticsRecomputationScheduler(
        s.a,
        new SQLiteProductDateRecomputer(s.a),
      );
      expect(await scheduler.process(s.scope.storeId)).toMatchObject({
        failedJobs: 0,
      });
      const day = JSON.parse(
        s.db
          .prepare("SELECT payload_json FROM department_daily_performance")
          .get()!.payload_json as string,
      );
      expect(day.availability.salesValue.status).toBe("AVAILABLE");
      expect(day.sales.salesValue).toBe(
        mode === "SUPERSEDED" ? "20.00" : "12.40",
      );
      // The pending source row remains conserved, despite no longer qualifying this total.
      expect(
        s.db
          .prepare(
            "SELECT COUNT(*) n FROM source_records WHERE status='WARNING'",
          )
          .get()!.n,
      ).toBe(1);
    } finally {
      s.db.close();
    }
  },
);

it("preserves the original whole-file authorization of older imports instead of silently widening it", async () => {
  const s = await chatImportFixture();
  try {
    await s.a.runAsync(
      "UPDATE products SET label='PRODUIT A CONFIRMER' WHERE id=?",
      s.productId,
    );
    const f = await s.add({
      policyVersion: 1,
      unknownLabel: "PRODUIT A CONFIRMER VRAC",
    });
    const review = (await s.controller.run(f.message)).items[0]!;
    expect(review).toMatchObject({
      status: "REVIEW",
      publishedCount: 0,
      priorSourceDocumentId: null,
    });
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM source_documents").get()!.n,
    ).toBe(0);
    if (review.status !== "REVIEW") throw Error("Expected legacy review");
    await s.controller.resolve(f.message, review, {
      resolutionKey: review.resolutions[0]!.key,
      productId: s.productId,
    });
    expect((await s.controller.run(f.message)).items[0]).toMatchObject({
      status: "PUBLISHED",
      publishedCount: 2,
      completedPartial: false,
    });
    expect(
      s.db
        .prepare(
          "SELECT COUNT(*) n FROM sync_outbox WHERE entity_type='mercalys_publication'",
        )
        .get()!.n,
    ).toBe(1);
  } finally {
    s.db.close();
  }
});
