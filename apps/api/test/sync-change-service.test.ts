import { Long } from "mongodb";
import { describe, expect, it } from "vitest";
import {
  SyncChangeService,
  type SyncChangeDocument,
  type SyncChangeStore,
} from "../src/sync/sync-change-service.js";

class InMemorySyncChangeStore implements SyncChangeStore<undefined> {
  private readonly counters = new Map<string, Long>();
  readonly changes: SyncChangeDocument[] = [];

  async allocateSequence(_context: undefined, storeId: string) {
    const next = (this.counters.get(storeId) ?? Long.ZERO).add(Long.ONE);
    this.counters.set(storeId, next);
    return next;
  }

  async insert(_context: undefined, change: SyncChangeDocument) {
    if (
      this.changes.some(
        (candidate) =>
          candidate.storeId === change.storeId &&
          candidate.sequence.equals(change.sequence),
      )
    ) {
      throw new Error("Duplicate store sequence.");
    }
    this.changes.push(change);
  }
}

describe("SyncChangeService", () => {
  it("allocates unique gap-free sequences under concurrent writes", async () => {
    const store = new InMemorySyncChangeStore();
    let nextId = 0;
    const service = new SyncChangeService(
      store,
      () => new Date("2026-09-26T23:00:00.000Z"),
      () => `change-${++nextId}`,
    );

    const changes = await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        service.append(undefined, {
          storeId: "11111111-1111-4111-8111-111111111111",
          entityType: "sync_test_entity",
          entityId: `entity-${index}`,
          operation: "UPSERT",
          entityVersion: 1,
        }),
      ),
    );

    expect(
      changes
        .map((change) => change.sequence.toNumber())
        .sort((left, right) => left - right),
    ).toEqual(Array.from({ length: 50 }, (_, index) => index + 1));
    expect(
      new Set(changes.map((change) => change.sequence.toString())).size,
    ).toBe(50);
  });

  it("maintains an independent sequence for each store", async () => {
    const store = new InMemorySyncChangeStore();
    const service = new SyncChangeService(store);
    const append = (storeId: string, entityId: string) =>
      service.append(undefined, {
        storeId,
        entityType: "sync_test_entity",
        entityId,
        operation: "DELETE",
        entityVersion: 2,
      });

    const [firstA, firstB, secondA] = await Promise.all([
      append("store-a", "entity-a1"),
      append("store-b", "entity-b1"),
      append("store-a", "entity-a2"),
    ]);

    expect(firstA.sequence.toString()).toBe("1");
    expect(firstB.sequence.toString()).toBe("1");
    expect(secondA.sequence.toString()).toBe("2");
  });
});
