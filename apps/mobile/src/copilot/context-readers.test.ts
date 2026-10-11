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
async function setup(storeId?: string) {
  const db = new DatabaseSync(":memory:"),
    a = new Adapter(db),
    f = chatFixture(randomUUID);
  if (storeId) {
    f.storeId = storeId;
    f.conversation.storeId = storeId;
  }
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
  const runtime = new CopilotToolRuntime(a, () => "2026-10-11T12:00:00.000Z");
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
it("reads interval-overlapping store events with scope, closure boundaries, pagination and unresolved sync state", async () => {
  const x = await setup();
  try {
    const { applyStoreProductEvent } =
      await import("../needs/store-event-repository");
    const base = {
      storeId: x.f.storeId,
      productId: randomUUID(),
      type: "OUT_OF_STOCK" as const,
      startedAt: "2026-10-10T08:00:00.000Z",
      endedAt: null,
      severity: null,
      comment: null,
      clientCapturedAt: "2026-10-10T10:00:00.000Z",
      source: "USER" as const,
      sourceDocumentId: null,
      status: "ACTIVE" as const,
      version: 1,
      createdAt: "2026-10-10T10:00:00.000Z",
      updatedAt: "2026-10-10T10:00:00.000Z",
    };
    const one = { ...base, id: randomUUID() },
      two = { ...base, id: randomUUID(), type: "QUALITY_ISSUE" as const };
    for (const e of [
      one,
      two,
      {
        ...base,
        id: randomUUID(),
        status: "CLOSED" as const,
        endedAt: "2026-10-10T09:00:00.000Z",
      },
      { ...base, id: randomUUID(), storeId: randomUUID() },
    ])
      await applyStoreProductEvent(x.a, e.storeId, e);
    await x.a.runAsync(
      "UPDATE store_product_events SET sync_state='CONFLICT' WHERE id=?",
      two.id,
    );
    const { eventsReadResultSchema } = await import("@fl-copilot/domain");
    const input = {
      startAt: "2026-10-10T11:00:00+02:00",
      endAt: "2026-10-10T12:00:00+02:00",
      limit: 1,
    };
    const first = eventsReadResultSchema.parse(
      await x.call("store.events", input),
    );
    expect(first.startAt).toBe("2026-10-10T09:00:00.000Z");
    expect(first.events).toHaveLength(1);
    expect(first.hasMore).toBe(true);
    const second = eventsReadResultSchema.parse(
      await x.call("store.events", { ...input, afterId: first.nextAfterId }),
    );
    expect(second.hasMore).toBe(false);
    expect(
      new Set([...first.events, ...second.events].map((e) => e.entity.id)),
    ).toEqual(new Set([one.id, two.id]));
    expect(
      [...first.events, ...second.events].find((e) => e.entity.id === two.id)
        ?.syncState,
    ).toBe("CONFLICT");
    await expect(
      x.call("store.events", { ...input, endAt: input.startAt }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  } finally {
    x.db.close();
  }
});
it("preserves directed substitution rules, declared basis, unknown stock, refusals and event exclusions without business writes", async () => {
  const { substitutionFixture } =
    await import("../../../../scripts/test-substitution-fixtures");
  const f = await substitutionFixture(),
    x = await setup(f.need.storeId);
  try {
    const { ProductMasterRepository } =
      await import("../products/product-master-repository");
    const { applyNeedUnit } = await import("../needs/repository");
    const { applyProductSubstitution } =
      await import("../needs/substitution-repository");
    const { applyStoreProductEvent } =
      await import("../needs/store-event-repository");
    const { substitutesReadResultSchema } = await import("@fl-copilot/domain");
    for (const p of [f.product, f.substitute])
      await new ProductMasterRepository(x.a).upsertProduct(p, {
        commandId: randomUUID(),
        deviceId: randomUUID(),
      });
    await applyNeedUnit(x.a, f.need.storeId, f.need);
    await applyProductSubstitution(x.a, f.need.storeId, f.substitution);
    const before = x.db.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get();
    const first = substitutesReadResultSchema.parse(
      await x.call("substitution.lookup", { productId: f.product.id }),
    );
    expect(first.candidates[0]?.availability).toBe("UNKNOWN");
    expect(first.candidates[0]?.relationships[0]?.basis).toBe("DECLARED");
    expect(
      first.candidates[0]?.relationships[0]?.relation.relationshipScore,
    ).toBeNull();
    expect(x.db.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get()).toEqual(
      before,
    );
    expect(
      substitutesReadResultSchema.parse(
        await x.call("substitution.lookup", { productId: f.substitute.id }),
      ).candidates,
    ).toHaveLength(0);
    await applyStoreProductEvent(x.a, f.need.storeId, {
      id: randomUUID(),
      storeId: f.need.storeId,
      productId: f.substitute.id,
      type: "OUT_OF_STOCK",
      startedAt: "2026-10-11T08:00:00.000Z",
      endedAt: null,
      severity: null,
      comment: null,
      clientCapturedAt: "2026-10-11T08:00:00.000Z",
      source: "USER",
      sourceDocumentId: null,
      status: "ACTIVE",
      version: 1,
      createdAt: "2026-10-11T08:00:00.000Z",
      updatedAt: "2026-10-11T08:00:00.000Z",
    });
    const blocked = substitutesReadResultSchema.parse(
      await x.call("substitution.lookup", { productId: f.product.id }),
    );
    expect(blocked.candidates).toHaveLength(0);
    expect(blocked.excluded[0]?.reason).toBe("OUT_OF_STOCK");
    await applyProductSubstitution(x.a, f.need.storeId, {
      ...f.substitution,
      status: "REJECTED",
      version: 2,
    });
    expect(
      substitutesReadResultSchema.parse(
        await x.call("substitution.lookup", { productId: f.product.id }),
      ).excluded[0]?.reason,
    ).toBe("REJECTED");
    await expect(
      x.call("substitution.lookup", {
        productId: f.product.id,
        at: "2027-01-01T00:00:00Z",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  } finally {
    x.db.close();
  }
});
it("reads only settings-matching weekly cache offline, marks expired forecasts stale, retains provenance and invalidates changed settings", async () => {
  const x = await setup();
  try {
    const { storeContextFixture } =
        await import("../../../../scripts/test-store-context-fixtures"),
      { weeklyContextFixture } =
        await import("../../../../scripts/test-weekly-context-fixtures");
    const { applyStoreContext } = await import("../store/context-repository"),
      { WeeklyContextRepository } =
        await import("../store/weekly-context-repository");
    const { storeWeekReadResultSchema } = await import("@fl-copilot/domain");
    const settings = {
        ...storeContextFixture(),
        id: x.f.storeId,
        storeId: x.f.storeId,
      },
      context = weeklyContextFixture(settings);
    await applyStoreContext(x.a, x.f.storeId, settings);
    await new WeeklyContextRepository(x.a).save(context, settings);
    const result = storeWeekReadResultSchema.parse(
      await x.call("store.week", { weekStart: context.weekStart }),
    );
    expect(result.settings?.postalCode).toBe("92600");
    expect(result.context?.weather.status).toBe("STALE");
    expect(result.context?.weather.retrievedAt).toBe(
      context.weather.retrievedAt,
    );
    expect(result.context?.weather.sourceUrl).toBe(context.weather.sourceUrl);
    expect(
      (await new WeeklyContextRepository(x.a).get(settings, context.weekStart))
        ?.weather.status,
    ).toBe("AVAILABLE");
    expect(
      storeWeekReadResultSchema.parse(
        await x.call("store.week", { weekStart: "2026-10-12" }),
      ).context,
    ).toBeNull();
    await applyStoreContext(x.a, x.f.storeId, {
      ...settings,
      version: 2,
      city: "Paris",
    });
    expect(
      storeWeekReadResultSchema.parse(
        await x.call("store.week", { weekStart: context.weekStart }),
      ).context,
    ).toBeNull();
    await expect(
      x.call("store.week", { weekStart: "2026-10-11" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  } finally {
    x.db.close();
  }
});
