import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import {
  prepareJournalNote,
  journalNoteCapture,
  prepareStoreProductEvent,
} from "@fl-copilot/domain";
import { createMongoDatabase } from "../src/database/mongo";
import { parseEnvironment } from "../src/config";
import type { DatabaseService } from "../src/database/types";
import type { SyncPushRequest } from "@fl-copilot/sync-contracts";
import { createMongoSyncPushService } from "../src/sync/push-service";
import { createMongoSyncPullService } from "../src/sync/pull-service";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service";
import { readFieldEvents } from "../src/copilot/field-events-tool";
import { VisualTestDatabase } from "../../../scripts/test-visual-sqlite";
import { runLocalMigrations } from "../../mobile/src/db/migrations";
import { MobileSyncService } from "../../mobile/src/sync/sync-service";
import { JournalNoteRepository } from "../../mobile/src/journal/journal-note-repository";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "store Journal notes",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `journal_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
        }),
      );
      await database.getDb();
    });
    afterAll(async () => {
      try {
        await (await database.getDb()).dropDatabase();
      } finally {
        await database.close();
      }
    });
    function fixture() {
      const storeId = randomUUID(),
        note = prepareJournalNote(storeId, {
          id: randomUUID(),
          text: "Travaux devant l’entrée",
          startDate: "2026-11-12",
          endDate: "2026-11-14",
          capturedAt: "2026-11-13T08:00:00Z",
        });
      return {
        storeId,
        note,
        store: {
          storeId,
          storeName: "Test",
          role: "MANAGER",
          userId: randomUUID(),
          sessionId: randomUUID(),
          deviceId: randomUUID(),
        },
      };
    }
    function request(
      f: ReturnType<typeof fixture>,
      withdraw = false,
    ): SyncPushRequest {
      return {
        syncProtocolVersion: 1,
        appVersion: "test",
        storeId: f.storeId,
        deviceId: randomUUID(),
        commands: [
          {
            commandId: randomUUID(),
            localSequence: 1,
            type: withdraw ? "WITHDRAW_JOURNAL_NOTE" : "CREATE_JOURNAL_NOTE",
            entityType: "store_journal_note",
            entityId: f.note.id,
            expectedRemoteVersion: withdraw ? 1 : null,
            createdAt: "2026-11-13T09:00:00Z",
            payload: withdraw
              ? {
                  withdrawnAt: "2026-11-13T09:00:00Z",
                  capture: journalNoteCapture(f.note),
                }
              : journalNoteCapture(f.note),
          },
        ],
      };
    }
    it("synchronizes offline capture to a second SQLite device, withdraws without resurrection and restores a fresh device", async () => {
      const f = fixture(),
        push = createMongoSyncPushService(database),
        pull = createMongoSyncPullService(database),
        boot = createMongoSyncBootstrapService(database);
      const raws = [
        new DatabaseSync(":memory:"),
        new DatabaseSync(":memory:"),
        new DatabaseSync(":memory:"),
      ];
      try {
        const devices = raws.map((d) => new VisualTestDatabase(d));
        for (const d of devices) await runLocalMigrations(d);
        const service = (d: VisualTestDatabase) =>
          new MobileSyncService(
            d,
            {
              bootstrap: () =>
                boot.bootstrap(f.store, {
                  rawObservationDays: 90,
                  journalNotes: "true",
                }),
              push: (r) => push.push(r, "notes-device"),
              pull: (_, cursor) =>
                pull.pull(f.storeId, {
                  cursor,
                  limit: 500,
                  journalNotes: "true",
                }),
            },
            { deviceId: randomUUID(), appVersion: "test", journalNotes: true },
          );
        const a = new JournalNoteRepository(devices[0]!),
          b = new JournalNoteRepository(devices[1]!);
        await a.create(f.storeId, journalNoteCapture(f.note), {
          commandId: randomUUID(),
          deviceId: randomUUID(),
        });
        expect(await service(devices[0]!).sync(f.storeId)).toMatchObject({
          pushed: 1,
          failed: 0,
        });
        // Simulate an installed client whose cursor has already passed the note.
        await new MobileSyncService(
          devices[1]!,
          {
            bootstrap: () =>
              boot.bootstrap(f.store, { rawObservationDays: 90 }),
            push: (r) => push.push(r, "legacy"),
            pull: (_, cursor) => pull.pull(f.storeId, { cursor, limit: 500 }),
          },
          { deviceId: randomUUID(), appVersion: "legacy" },
        ).bootstrap(f.storeId);
        await service(devices[1]!).sync(f.storeId);
        expect((await b.list(f.storeId, "2026-11-14")).rows[0]!.entity).toEqual(
          f.note,
        );
        await b.withdraw(f.storeId, f.note.id, {
          commandId: randomUUID(),
          deviceId: randomUUID(),
          capturedAt: "2026-11-13T09:00:00Z",
        });
        await service(devices[1]!).sync(f.storeId);
        await service(devices[0]!).sync(f.storeId);
        expect((await a.list(f.storeId, "2026-11-13")).rows).toEqual([]);
        await service(devices[2]!).sync(f.storeId);
        expect(
          (
            await new JournalNoteRepository(devices[2]!).list(
              f.storeId,
              "2026-11-13",
              null,
              true,
            )
          ).rows[0]!.entity,
        ).toMatchObject({ text: f.note.text, version: 2 });
        const db = await database.getDb();
        expect(
          await db
            .collection("storeJournalNoteHistory")
            .countDocuments({ storeId: f.storeId }),
        ).toBe(2);
        expect(
          await db
            .collection("salesObservations")
            .countDocuments({ storeId: f.storeId }),
        ).toBe(0);
      } finally {
        for (const r of raws) r.close();
      }
    }, 30000);
    it("replays exactly once, preserves immutable content, rejects foreign scope and excludes old sync clients", async () => {
      const f = fixture(),
        push = createMongoSyncPushService(database),
        r = request(f);
      expect((await push.push(r, "create")).results[0]!.status).toBe("APPLIED");
      expect((await push.push(r, "replay")).results[0]!.status).toBe(
        "ALREADY_APPLIED",
      );
      const forged = request(f);
      forged.commands[0]!.payload = {
        ...journalNoteCapture(f.note),
        text: "Réécrit",
      };
      expect((await push.push(forged, "forged")).results[0]!.status).toBe(
        "REJECTED",
      );
      const foreign = request(f, true);
      foreign.storeId = randomUUID();
      expect((await push.push(foreign, "foreign")).results[0]!.status).toBe(
        "REJECTED",
      );
      const pull = createMongoSyncPullService(database),
        boot = createMongoSyncBootstrapService(database);
      expect((await pull.pull(f.storeId, { limit: 500 })).changes).toEqual([]);
      expect(
        (await boot.bootstrap(f.store, { rawObservationDays: 90 })).entities
          .journalNotes,
      ).toBeUndefined();
      expect(
        (
          await boot.bootstrap(f.store, {
            rawObservationDays: 90,
            journalNotes: "true",
          })
        ).entities.journalNotes,
      ).toHaveLength(1);
      expect(
        (await pull.pull(f.storeId, { limit: 500, journalNotes: "true" }))
          .changes[0]!.entity,
      ).toMatchObject({ id: f.note.id });
      expect(
        (await push.push(request(f, true), "withdraw")).results[0]!.status,
      ).toBe("APPLIED");
      expect(
        (await push.push(request(f), "create-after-withdraw")).results[0]!
          .remoteEntity,
      ).toMatchObject({ version: 2 });
    }, 20000);
    it("pages notes with product episodes without skipping tied UUIDs, filters scope/withdrawal and keeps the installed tool envelope", async () => {
      const f = fixture(),
        db = await database.getDb(),
        push = createMongoSyncPushService(database);
      const notes = Array.from({ length: 8 }, () =>
        prepareJournalNote(f.storeId, {
          ...journalNoteCapture(f.note),
          id: randomUUID(),
        }),
      );
      for (const note of notes)
        await push.push(request({ ...f, note }), "note");
      const onlyNotes = await readFieldEvents(db, f.storeId, {
        startAt: "2026-11-13T00:00:00Z",
        endAt: "2026-11-14T00:00:00Z",
        productId: null,
        afterId: null,
        limit: 10,
      });
      expect(
        onlyNotes.evidence.filter((e) => e.label === "Note du magasin"),
      ).toHaveLength(8);
      expect(onlyNotes.hasMore).toBe(false);
      const tied = notes.map((n) => n.id).sort()[0]!,
        productId = randomUUID();
      const event = prepareStoreProductEvent(f.storeId, {
        event: {
          id: tied,
          productId,
          type: "LOW_STOCK",
          startedAt: "2026-11-13T08:00:00Z",
          clientCapturedAt: "2026-11-13T09:00:00Z",
        },
      });
      await db
        .collection("storeProductEvents")
        .insertMany(
          notes.map((n) => ({ ...event, id: n.id, _id: n.id })) as never,
        );
      await db.collection("products").insertOne({
        _id: productId,
        storeId: f.storeId,
        label: "Produit",
      } as never);
      const input = {
        startAt: "2026-11-13T00:00:00Z",
        endAt: "2026-11-14T00:00:00Z",
        productId: null,
        afterId: null as string | null,
        limit: 1,
      };
      const mixed = await readFieldEvents(db, f.storeId, {
        ...input,
        limit: 10,
      });
      expect(mixed.evidence).toHaveLength(11);
      expect(mixed.events).toHaveLength(5);
      expect(mixed.hasMore).toBe(true);
      const seen = new Set<string>();
      let pages = 0;
      do {
        const result = await readFieldEvents(db, f.storeId, input);
        expect(result.evidence.length).toBeLessThanOrEqual(11);
        for (const e of result.evidence)
          if (e.label === "Note du magasin") seen.add(e.sourceId!);
        if (++pages === 1) {
          expect(result.events[0]!.event.id).toBe(tied);
          expect(seen.has(tied)).toBe(true);
        }
        input.afterId = result.nextAfterId;
        if (!result.hasMore) break;
      } while (pages < 20);
      expect(seen.size).toBe(8);
      expect(pages).toBe(8);
      expect(
        (
          await readFieldEvents(db, f.storeId, {
            ...input,
            afterId: null,
            productId,
          })
        ).evidence.some((e) => e.label === "Note du magasin"),
      ).toBe(false);
      await push.push(
        request({ ...f, note: notes.find((n) => n.id === tied)! }, true),
        "remove",
      );
      const after = await readFieldEvents(db, f.storeId, {
        ...input,
        afterId: null,
        limit: 10,
      });
      expect(
        after.evidence.some(
          (e) => e.sourceId === tied && e.label === "Note du magasin",
        ),
      ).toBe(false);
      expect(
        (await readFieldEvents(db, randomUUID(), { ...input, afterId: null }))
          .evidence,
      ).toHaveLength(1);
    }, 30000);
  },
);
