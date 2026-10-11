import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { it, expect } from "vitest";
import {
  buildProductDailyPerformance,
  buildDepartmentDailyPerformance,
} from "@fl-copilot/analytics-core";
import {
  dailyReadResultSchema,
  wasteReadResultSchema,
  offersReadResultSchema,
} from "@fl-copilot/domain";
import { runLocalMigrations } from "../db/migrations";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import { commercialChoiceFixture } from "../../../../scripts/test-commercial-choice-fixtures";
import { CopilotConversationRepository } from "./conversation-repository";
import { CopilotToolRuntime } from "./tool-runtime";
import {
  insertReceipt,
  insertLine,
} from "../documents/waste-receipt-repository";
import { applyCommercialChoice } from "../commercial/offer-choice-repository";
class Adapter implements OutboxDatabase {
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
    return this.db.prepare(s).run(...p);
  }
  async withExclusiveTransactionAsync(
    task: (tx: OutboxDatabase) => Promise<void>,
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      await task(this);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
async function setup() {
  const db = new DatabaseSync(":memory:"),
    a = new Adapter(db),
    f = chatFixture(randomUUID);
  await runLocalMigrations(a);
  await new CopilotConversationRepository(a, f).save(f.conversation, {
    commandId: randomUUID(),
    deviceId: randomUUID(),
  });
  const scope = {
    storeId: f.storeId,
    ownerId: f.ownerId,
    conversationId: f.conversation.id,
    canReadStore: true,
  };
  const runtime = new CopilotToolRuntime(a);
  return {
    db,
    a,
    f,
    scope,
    call: (tool: string, input: unknown, operationId = randomUUID()) =>
      runtime.execute({ tool, input, operationId, schemaVersion: 1 }, scope),
  };
}
it("reads exactly the requested day through shared analytics, preserves missing waste, lineage and J-7 comparison", async () => {
  const x = await setup();
  try {
    const product = (await commercialChoiceFixture({ storeId: x.f.storeId }))
      .product;
    for (const [date, sales] of [
      ["2026-10-04", "20"],
      ["2026-10-11", "10"],
    ] as const) {
      const productPerformance = buildProductDailyPerformance({
        product,
        businessDate: date,
        computedAt: x.f.conversation.createdAt,
        salesObservations: [
          {
            id: randomUUID(),
            storeId: x.f.storeId,
            productId: product.id,
            businessDate: date,
            quantity: "1",
            purchaseValue: "5",
            salesValue: sales,
            marginValue: "5",
            marginRate: "50",
            sourceRecordId: randomUUID(),
            validationStatus: "VALIDATED",
            version: 1,
            updatedAt: x.f.conversation.createdAt,
            deletedAt: null,
          },
        ],
        wasteObservations: [],
      });
      const d = buildDepartmentDailyPerformance({
        storeId: x.f.storeId,
        businessDate: date,
        productPerformances: [productPerformance],
        computedAt: x.f.conversation.createdAt,
      });
      await x.a.runAsync(
        "INSERT INTO department_daily_performance VALUES (?, ?, ?, ?, 'LOCAL', ?, ?, ?)",
        randomUUID(),
        x.f.storeId,
        date,
        JSON.stringify(d),
        d.formulaVersion,
        d.inputRevision,
        d.computedAt,
      );
    }
    const r = dailyReadResultSchema.parse(
      await x.call("analytics.daily", { businessDate: "2026-10-11" }),
    );
    expect(
      r.snapshot?.kpis.find((k) => k.id === "sales")?.comparison
        .percentageDifference,
    ).toBe("-50.00");
    expect(
      r.snapshot?.kpis.find((k) => k.id === "sales")?.comparison
        .sourceLineageIds.length,
    ).toBeGreaterThan(0);
    expect(r.snapshot?.kpis.find((k) => k.id === "waste")?.value).toBeNull();
    expect(
      dailyReadResultSchema.parse(
        await x.call("analytics.daily", { businessDate: "2026-10-05" }),
      ).snapshot,
    ).toBeNull();
    const earlier = dailyReadResultSchema.parse(
      await x.call("analytics.daily", { businessDate: "2026-10-04" }),
    );
    expect(earlier.snapshot?.businessDate).toBe("2026-10-04");
    expect(earlier.snapshot?.kpis[0]?.comparison.referenceValue).toBeNull();
    await expect(
      x.call("analytics.daily", { businessDate: "2026-02-30" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  } finally {
    x.db.close();
  }
});
it("returns receipt draft facts without local image URLs or publication, and hides foreign receipt IDs", async () => {
  const x = await setup();
  try {
    const receipt = {
      id: randomUUID(),
      storeId: x.f.storeId,
      processingStatus: "CAPTURED" as const,
      aiStatus: "PENDING" as const,
      duplicateStatus: "UNCHECKED" as const,
      detectedCashierNumber: "000123",
      version: 1,
      createdAt: x.f.conversation.createdAt,
      updatedAt: x.f.conversation.createdAt,
      syncState: "LOCAL_ONLY" as const,
      dirty: true,
    };
    await insertReceipt(x.a, receipt);
    await insertLine(x.a, {
      id: randomUUID(),
      storeId: x.f.storeId,
      receiptId: receipt.id,
      sourceLineIndex: 0,
      rawLabel: "TOMATE",
      quantity: "2",
      unitPrice: null,
      totalPrice: "5",
      matchStatus: "UNMATCHED",
      productNature: "UNKNOWN",
      validationStatus: "TO_REVIEW",
      version: 1,
      createdAt: receipt.createdAt,
      updatedAt: receipt.updatedAt,
      syncState: "LOCAL_ONLY",
      dirty: true,
    });
    const before = x.db.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get();
    const r = wasteReadResultSchema.parse(
      await x.call("waste.inspect", { receiptId: receipt.id }),
    );
    expect(r.snapshot?.receipt.detectedCashierNumber).toBe("000123");
    expect(r.snapshot?.lines[0]?.validationStatus).toBe("TO_REVIEW");
    expect(JSON.stringify(r)).not.toContain("localUri");
    expect(x.db.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get()).toEqual(
      before,
    );
    const foreign = { ...receipt, id: randomUUID(), storeId: randomUUID() };
    await insertReceipt(x.a, foreign);
    expect(
      wasteReadResultSchema.parse(
        await x.call("waste.inspect", { receiptId: foreign.id }),
      ).snapshot,
    ).toBeNull();
  } finally {
    x.db.close();
  }
});
it("pages period-overlapping retained offers with source references, excludes withdrawn/foreign/outside offers and replays typed results", async () => {
  const x = await setup();
  try {
    const f = await commercialChoiceFixture({ storeId: x.f.storeId });
    const a = { ...f.choice, saleStart: "2026-10-01", saleEnd: "2026-10-15" };
    const b = { ...a, id: randomUUID() };
    let itemIndex = 0;
    for (const c of [
      a,
      b,
      { ...a, id: randomUUID(), status: "WITHDRAWN" as const },
      { ...a, id: randomUUID(), storeId: randomUUID() },
      {
        ...a,
        id: randomUUID(),
        saleStart: "2026-11-01",
        saleEnd: "2026-11-02",
      },
    ])
      await applyCommercialChoice(x.a, c.storeId, {
        ...c,
        source: { ...c.source, itemIndex: itemIndex++ },
      });
    const input = { start: "2026-10-05", end: "2026-10-11", limit: 1 },
      op = randomUUID();
    const first = offersReadResultSchema.parse(
      await x.call("commercial.offers", input, op),
    );
    expect(first.hasMore).toBe(true);
    expect(first.offers).toHaveLength(1);
    expect(first.offers[0]?.validation).toBeNull();
    expect(first.offers[0]?.choice.source.sourceDocumentId).toBe(
      f.choice.source.sourceDocumentId,
    );
    expect(await x.call("commercial.offers", input, op)).toEqual(first);
    const second = offersReadResultSchema.parse(
      await x.call("commercial.offers", {
        ...input,
        afterId: first.nextAfterId,
      }),
    );
    expect(second.hasMore).toBe(false);
    expect(second.offers).toHaveLength(1);
    expect(second.offers[0]?.choice.id).not.toBe(first.offers[0]?.choice.id);
    await expect(
      x.call("commercial.offers", { start: "2026-10-11", end: "2026-10-01" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      x.call("commercial.offers", { ...input, storeId: randomUUID() }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  } finally {
    x.db.close();
  }
});
it("does not reuse commercial validation after the selected choice revision changes", async () => {
  const x = await setup();
  try {
    const f = await commercialChoiceFixture({ storeId: x.f.storeId });
    await applyCommercialChoice(x.a, x.f.storeId, f.choice);
    const { applyValidatedOffer } =
      await import("../commercial/validated-offer-repository");
    await applyValidatedOffer(x.a, x.f.storeId, {
      id: randomUUID(),
      storeId: x.f.storeId,
      choice: f.choice,
      status: "VALIDATED",
      sourceFields: [],
      evidence: [{ pageNumber: 1, quote: "Dramat raisin S41", region: null }],
      sourceReviewed: true,
      version: 1,
      createdAt: f.choice.createdAt,
    });
    const input = { start: f.choice.saleStart, end: f.choice.saleEnd };
    expect(
      offersReadResultSchema.parse(await x.call("commercial.offers", input))
        .offers[0]?.validation,
    ).not.toBeNull();
    await applyCommercialChoice(x.a, x.f.storeId, {
      ...f.choice,
      version: 2,
      note: "Révision humaine",
    });
    expect(
      offersReadResultSchema.parse(await x.call("commercial.offers", input))
        .offers[0]?.validation,
    ).toBeNull();
  } finally {
    x.db.close();
  }
});
