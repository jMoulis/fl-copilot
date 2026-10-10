import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect, vi } from "vitest";
import type {
  BootstrapResponse,
  SyncPullResponse,
} from "@fl-copilot/sync-contracts";
import type { ProductSubstitution } from "@fl-copilot/domain";
import { substitutionFixture } from "../../../../scripts/test-substitution-fixtures";
import { SubstituteLookupRepository } from "./lookup-repository";
import { StoreProductEventRepository } from "./store-event-repository";
import { applyBootstrap } from "../sync/apply-bootstrap";
import { applyPullPage } from "../sync/apply-pull-page";
import { runLocalMigrations } from "../db/migrations";
import type { OutboxDatabase } from "../sync/outbox-repository";
class Adapter implements OutboxDatabase {
  transactions = 0;
  constructor(readonly db: DatabaseSync) {}
  async execAsync(s: string) {
    this.db.exec(s);
  }
  async runAsync(s: string, ...p: Array<string | number | null>) {
    return this.db.prepare(s).run(...p);
  }
  async getFirstAsync<T>(s: string, ...p: Array<string | number | null>) {
    return (this.db.prepare(s).get(...p) as T) ?? null;
  }
  async getAllAsync<T>(s: string, ...p: Array<string | number | null>) {
    return this.db.prepare(s).all(...p) as T[];
  }
  async withExclusiveTransactionAsync(
    task: (tx: OutboxDatabase) => Promise<void>,
  ) {
    this.transactions++;
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
  const f = await substitutionFixture(),
    dir = mkdtempSync(join(tmpdir(), "fl-lookup_")),
    path = join(dir, "local.db");
  let db = new DatabaseSync(path),
    tx = new Adapter(db);
  await runLocalMigrations(tx);
  const snapshot: BootstrapResponse = {
    protocolVersion: 1,
    store: { id: f.need.storeId, name: "Test", role: "MANAGER" },
    snapshotRevision: "lookup-revision",
    cursor: "initial",
    historyPolicy: { rawObservationDays: 90 },
    serverTime: f.need.createdAt,
    entities: {
      syncTestEntities: [],
      products: [f.product, f.substitute],
      productIdentifiers: [
        {
          id: randomUUID(),
          storeId: f.need.storeId,
          productId: f.substitute.id,
          type: "EAN",
          value: "0000123456789",
          source: "USER",
          status: "VALIDATED",
          version: 1,
          createdAt: f.need.createdAt,
          updatedAt: f.need.updatedAt,
        },
      ],
      productAliases: [],
      needUnits: [],
      needMemberships: [],
      productSubstitutions: [],
      salesObservations: [],
      wasteObservations: [],
      commercialOperations: [],
      offers: [],
      marketSignals: [],
      executionInstructions: [],
      storeEvents: [],
      productDailyPerformance: [],
      departmentDailyPerformance: [],
      recommendations: [],
      decisions: [],
      actionExecutions: [],
      needUnitCatalogue: [f.need],
      directedProductSubstitutions: [f.substitution],
    },
  };
  await applyBootstrap(tx, f.need.storeId, snapshot);
  return {
    ...f,
    dir,
    path,
    get db() {
      return db;
    },
    get tx() {
      return tx;
    },
    reopen() {
      db.close();
      db = new DatabaseSync(path);
      tx = new Adapter(db);
    },
    dispose() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
const at = "2026-10-10T12:00:00.000Z";
it("restores the confirmed graph through bootstrap and finds A → B across restart with every network request disabled", async () => {
  const f = await setup(),
    network = vi.fn(async () => {
      throw Error("NETWORK_DISABLED");
    });
  vi.stubGlobal("fetch", network);
  try {
    f.reopen();
    const repo = new SubstituteLookupRepository(f.tx),
      before = f.tx.transactions;
    const value = await repo.read(f.need.storeId, f.product.id, undefined, at);
    expect(f.tx.transactions).toBe(before + 1);
    expect(value.result.candidates.map((c) => c.productId)).toEqual([
      f.substitute.id,
    ]);
    expect(value.result.candidates[0]).toMatchObject({
      basis: "DECLARED",
      availability: "UNKNOWN",
      syncState: "SYNCED",
    });
    expect(value.identifiers[f.substitute.id]).toBe("EAN : 0000123456789");
    expect(
      (await repo.read(f.need.storeId, f.substitute.id, undefined, at)).result
        .candidates,
    ).toEqual([]);
    expect(
      (await repo.read(randomUUID(), f.product.id, undefined, at)).result
        .status,
    ).toBe("SOURCE_UNAVAILABLE");
    expect(network).not.toHaveBeenCalled();
    expect(f.db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()!.n).toBe(0);
    expect(
      f.db
        .prepare("SELECT category,nature,sales_unit FROM products WHERE id=?")
        .get(f.substitute.id),
    ).toEqual({
      category: "UNKNOWN",
      nature: "UNKNOWN",
      sales_unit: "UNKNOWN",
    });
  } finally {
    vi.unstubAllGlobals();
    f.dispose();
  }
});
it("uses an offline pending stockout immediately, persists it through restart and admits the candidate again only after explicit closure", async () => {
  const f = await setup();
  try {
    const events = new StoreProductEventRepository(f.tx),
      ctx = { commandId: randomUUID(), deviceId: randomUUID(), capturedAt: at };
    const event = await events.create(
      f.need.storeId,
      {
        event: {
          id: randomUUID(),
          productId: f.substitute.id,
          type: "OUT_OF_STOCK",
          startedAt: "2026-10-10T10:00:00Z",
          clientCapturedAt: at,
        },
      },
      ctx,
    );
    f.reopen();
    const result = (
      await new SubstituteLookupRepository(f.tx).read(
        f.need.storeId,
        f.product.id,
        undefined,
        at,
      )
    ).result;
    expect(result.candidates).toEqual([]);
    expect(result.excluded[0]!.reason).toBe("OUT_OF_STOCK");
    expect(f.db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()!.n).toBe(1);
    await new StoreProductEventRepository(f.tx).close(
      f.need.storeId,
      event.id,
      "2026-10-10T11:00:00Z",
      { ...ctx, commandId: randomUUID() },
    );
    expect(
      (
        await new SubstituteLookupRepository(f.tx).read(
          f.need.storeId,
          f.product.id,
          undefined,
          at,
        )
      ).result.candidates,
    ).toHaveLength(1);
    expect(f.db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()!.n).toBe(2);
  } finally {
    f.dispose();
  }
});
it("reads later canonical learned metrics from pull and excludes an explicit rejection without changing the replicated graph", async () => {
  const f = await setup();
  try {
    const learned: ProductSubstitution = {
      ...f.substitution,
      version: 2,
      status: "LEARNING",
      observedSubstitution: 0.52,
      relationshipScore: 0.85,
      confidence: 0.08,
      evidenceCount: 2,
      lastEvidenceAt: at,
    };
    const page = (entity: ProductSubstitution): SyncPullResponse => ({
      nextCursor: `revision-${entity.version}`,
      hasMore: false,
      serverTime: at,
      changes: [
        {
          sequence: String(entity.version),
          entityType: "product_substitution",
          entityId: entity.id,
          entityVersion: entity.version,
          operation: "UPSERT",
          entity,
          changedAt: at,
        },
      ],
    });
    await applyPullPage(f.tx, f.need.storeId, page(learned));
    f.reopen();
    const repo = new SubstituteLookupRepository(f.tx),
      result = (await repo.read(f.need.storeId, f.product.id, undefined, at))
        .result;
    expect(result.candidates[0]).toMatchObject({
      fit: 0.85,
      basis: "LEARNED",
      relation: { confidence: 0.08, evidenceCount: 2 },
    });
    await applyPullPage(
      f.tx,
      f.need.storeId,
      page({ ...learned, status: "REJECTED", version: 3 }),
    );
    const rejected = (
      await repo.read(f.need.storeId, f.product.id, undefined, at)
    ).result;
    expect(rejected.candidates).toEqual([]);
    expect(rejected.excluded[0]!.reason).toBe("REJECTED");
    expect(
      JSON.parse(
        f.db
          .prepare("SELECT payload_json FROM product_substitutions WHERE id=?")
          .get(learned.id)!.payload_json as string,
      ).status,
    ).toBe("REJECTED");
    expect(f.db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()!.n).toBe(0);
  } finally {
    f.dispose();
  }
});
it("refuses conflicted or failed graph parents locally while preserving the records for review", async () => {
  const f = await setup();
  try {
    f.db
      .prepare(
        "UPDATE product_substitutions SET sync_state='CONFLICT' WHERE id=?",
      )
      .run(f.substitution.id);
    const repo = new SubstituteLookupRepository(f.tx);
    expect(
      (await repo.read(f.need.storeId, f.product.id, undefined, at)).result
        .excluded[0]!.reason,
    ).toBe("RELATION_SYNC_UNRESOLVED");
    f.db
      .prepare(
        "UPDATE product_substitutions SET sync_state='SYNCED' WHERE id=?",
      )
      .run(f.substitution.id);
    f.db
      .prepare("UPDATE need_units SET sync_state='ERROR' WHERE id=?")
      .run(f.need.id);
    expect(
      (await repo.read(f.need.storeId, f.product.id, undefined, at)).result
        .excluded[0]!.reason,
    ).toBe("NEED_UNAVAILABLE");
    expect(
      f.db.prepare("SELECT COUNT(*) n FROM product_substitutions").get()!.n,
    ).toBe(1);
    expect(f.db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()!.n).toBe(0);
  } finally {
    f.dispose();
  }
});
