import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { prepareStoreProductEvent } from "@fl-copilot/domain";
import { runLocalMigrations } from "../db/migrations";
import { journalObservations } from "./journal-observations";

it("reads only the store's overlapping declared events across Paris DST, without loading products or writing", async () => {
  const db = new DatabaseSync(":memory:");
  const tx = {
    async execAsync(sql: string) {
      db.exec(sql);
    },
    async runAsync(sql: string, ...p: (string | number | null)[]) {
      return db.prepare(sql).run(...p);
    },
    async getFirstAsync<T>(sql: string, ...p: (string | number | null)[]) {
      return (db.prepare(sql).get(...p) as T) ?? null;
    },
    async getAllAsync<T>(sql: string, ...p: (string | number | null)[]) {
      return db.prepare(sql).all(...p) as T[];
    },
  };
  try {
    await runLocalMigrations(tx);
    const store = randomUUID(),
      product = randomUUID();
    await tx.runAsync(
      "INSERT INTO products(id,store_id,label,category,nature,sales_unit,status,version,created_at,updated_at) VALUES(?,?,?,'UNKNOWN','UNKNOWN','UNKNOWN','ACTIVE',1,?,?)",
      product,
      store,
      "Banane vrac",
      "2026-10-01T00:00:00Z",
      "2026-10-01T00:00:00Z",
    );
    async function event(
      startedAt: string,
      endedAt: string | null,
      storeId = store,
    ) {
      const entity = prepareStoreProductEvent(storeId, {
        event: {
          id: randomUUID(),
          productId: product,
          type: "OUT_OF_STOCK",
          startedAt,
          endedAt,
          clientCapturedAt: "2026-10-28T12:00:00Z",
        },
      });
      await tx.runAsync(
        "INSERT INTO store_product_events(id,store_id,product_id,payload_json,sync_state,dirty) VALUES(?,?,?,?,'PENDING',1)",
        entity.id,
        storeId,
        product,
        JSON.stringify(entity),
      );
      return entity.id;
    }
    const first = await event("2026-10-24T22:30:00Z", "2026-10-25T23:30:00Z");
    const second = await event("2026-10-25T22:30:00Z", null);
    await event("2026-10-24T20:00:00Z", "2026-10-24T21:59:00Z");
    await event("2026-10-25T23:01:00Z", null);
    await event("2026-10-25T12:00:00Z", null, randomUUID());
    const result = await journalObservations(
      tx,
      store,
      "2026-10-25",
      "2026-10-28",
    );
    expect(result.map((r) => r.entity.id)).toEqual([second, first]);
    expect(
      result.every(
        (r) => r.label === "Banane vrac" && r.syncState === "PENDING",
      ),
    ).toBe(true);
    expect(
      await journalObservations(tx, store, "2026-10-29", "2026-10-28"),
    ).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get()).toEqual({
      n: 0,
    });
  } finally {
    db.close();
  }
});
