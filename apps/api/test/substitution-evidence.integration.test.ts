import { mongoMigrations } from "../src/database/migrations";
import { randomUUID } from "node:crypto";
import { Decimal128 } from "mongodb";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { evidenceFixture } from "../../../scripts/test-evidence-fixtures";
import { storeEventCapturePayload } from "@fl-copilot/domain";
import type { SyncPushRequest } from "@fl-copilot/sync-contracts";
import { createMongoDatabase } from "../src/database/mongo";
import { parseEnvironment } from "../src/config";
import type { DatabaseService } from "../src/database/types";
import { createMongoSyncPushService } from "../src/sync/push-service";
import { createMongoSyncChangeService } from "../src/sync/sync-change-service";
import { createMongoSyncPullService } from "../src/sync/pull-service";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service";
import { createSubstitutionEvidenceProcessor } from "../src/substitution/processor";
import type { EvidenceWork } from "../src/substitution-evidence-work";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "daily substitution evidence transactions",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `flc_evidence_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
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
    function request(
      storeId: string,
      type: string,
      entityType: string,
      id: string,
      payload: unknown,
      expected: number | null = null,
    ): SyncPushRequest {
      return {
        syncProtocolVersion: 1,
        appVersion: "test",
        deviceId: randomUUID(),
        storeId,
        commands: [
          {
            commandId: randomUUID(),
            localSequence: 1,
            type,
            entityType,
            entityId: id,
            expectedRemoteVersion: expected,
            createdAt: "2026-10-10T12:00:00Z",
            payload: payload as never,
          },
        ],
      };
    }
    async function seed() {
      const f = await evidenceFixture(),
        db = await database.getDb();
      for (const p of [f.product, f.substitute]) {
        const { id, ...value } = p;
        await db.collection("products").insertOne({
          ...value,
          _id: id,
          createdAt: new Date(p.createdAt),
          updatedAt: new Date(p.updatedAt),
        } as never);
      }
      await db
        .collection("needUnits")
        .insertOne({ ...f.need, _id: f.need.id } as never);
      for (const s of f.input.sales)
        await db.collection("salesObservations").insertOne({
          ...s,
          _id: s.id,
          quantity: Decimal128.fromString("1"),
          salesValue:
            s.salesValue === null ? null : Decimal128.fromString(s.salesValue),
          validationStatus: "VALIDATED",
          updatedAt: new Date(s.updatedAt),
          deletedAt: null,
        } as never);
      const push = createMongoSyncPushService(database);
      expect(
        (
          await push.push(
            request(
              f.need.storeId,
              "PRODUCT_SUBSTITUTION_UPSERT",
              "product_substitution",
              f.substitution.id,
              f.substitution,
            ),
            "relation",
          )
        ).results[0]?.status,
      ).toBe("APPLIED");
      expect(
        (
          await push.push(
            request(
              f.need.storeId,
              "CREATE_STORE_EVENT",
              "store_product_event",
              f.event.id,
              storeEventCapturePayload(f.event),
            ),
            "event",
          )
        ).results[0]?.status,
      ).toBe("APPLIED");
      const due = async () => {
        await db
          .collection<EvidenceWork>("substitutionEvidenceWork")
          .updateOne(
            { _id: f.event.id },
            { $set: { nextAttemptAt: new Date("2026-10-10T11:00:00Z") } },
          );
      };
      await due();
      return {
        ...f,
        db,
        push,
        due,
        processor: createSubstitutionEvidenceProcessor(
          database,
          () => new Date(f.input.now),
        ),
      };
    }
    it("backfills previously synchronized USER observations idempotently without inventing a candidate", async () => {
      const f = await evidenceFixture(),
        db = await database.getDb();
      await db
        .collection("storeProductEvents")
        .insertOne({ ...f.event, _id: f.event.id } as never);
      expect(
        await db
          .collection("substitutionEvidenceWork")
          .countDocuments({ storeId: f.need.storeId }),
      ).toBe(0);
      const migration = mongoMigrations.find((m) => m.version === 29)!;
      await migration.up(db);
      await migration.up(db);
      expect(
        await db
          .collection("substitutionEvidenceWork")
          .countDocuments({ storeId: f.need.storeId }),
      ).toBe(1);
      const processor = createSubstitutionEvidenceProcessor(
        database,
        () => new Date(f.input.now),
      );
      expect(await processor.process(f.need.storeId, f.event.id)).toMatchObject(
        { status: "COMPUTED", count: 0 },
      );
      expect(
        (
          await db
            .collection("substitutionEvidenceStates")
            .findOne({ storeId: f.need.storeId })
        )?.status,
      ).toBe("NO_RELATIONS");
    }, 30000);
    it("queues atomically with capture, derives one daily comparison and retains declared relation metrics", async () => {
      const f = await seed();
      const state = await f.db
        .collection("substitutionEvidenceStates")
        .findOne({ storeId: f.need.storeId, eventId: f.event.id });
      expect(state?.status).toBe("QUEUED");
      expect(
        await f.processor.process(f.need.storeId, f.event.id),
      ).toMatchObject({ status: "COMPUTED", count: 1 });
      const e = await f.db
        .collection("substitutionEvidence")
        .findOne({ storeId: f.need.storeId, eventId: f.event.id });
      expect(e).toMatchObject({
        status: "READY",
        actualSalesValue: "135.00",
        expectedSalesValue: "100.000000",
        observedVariationPct: "35.000000",
        actualQuantity: null,
      });
      expect(
        await f.db
          .collection("productSubstitutions")
          .findOne({ _id: f.substitution.id } as never),
      ).toMatchObject({
        version: 1,
        status: "VALIDATED",
        confidence: null,
        evidenceCount: 0,
        relationshipScore: null,
      });
      expect(
        await f.db
          .collection("substitutionEvidenceHistory")
          .countDocuments({ storeId: f.need.storeId }),
      ).toBe(1);
    }, 30000);
    it("does not duplicate current evidence/history on repeated recovery and restricts parallel leases", async () => {
      const f = await seed();
      const results = await Promise.all([
        f.processor.process(f.need.storeId, f.event.id),
        f.processor.process(f.need.storeId, f.event.id),
      ]);
      expect(results.filter((r) => r.status === "COMPUTED")).toHaveLength(1);
      expect(results.filter((r) => r.status === "NOT_DUE")).toHaveLength(1);
      await f.due();
      await f.processor.process(f.need.storeId, f.event.id);
      expect(
        await f.db
          .collection("substitutionEvidenceHistory")
          .countDocuments({ storeId: f.need.storeId }),
      ).toBe(1);
      expect(
        await f.db
          .collection("substitutionEvidence")
          .countDocuments({ storeId: f.need.storeId }),
      ).toBe(1);
    }, 30000);
    it("versions corrected source sales atomically while preserving the previous comparison snapshot", async () => {
      const f = await seed();
      await f.processor.process(f.need.storeId, f.event.id);
      const initial = await f.db
        .collection("substitutionEvidence")
        .findOne({ storeId: f.need.storeId });
      const session = f.db.client.startSession();
      try {
        await session.withTransaction(async () => {
          await f.db.collection("salesObservations").updateOne(
            { _id: f.input.sales[0]!.id } as never,
            {
              $set: {
                salesValue: Decimal128.fromString("120"),
                version: 2,
                updatedAt: new Date(f.input.now),
              },
            },
            { session },
          );
          await createMongoSyncChangeService(
            () => new Date(f.input.now),
          ).append(
            { database: f.db, session },
            {
              storeId: f.need.storeId,
              entityId: f.input.sales[0]!.id,
              entityType: "sales_observation",
              entityVersion: 2,
              operation: "UPSERT",
            },
          );
        });
      } finally {
        await session.endSession();
      }
      expect(
        (
          await f.db
            .collection("substitutionEvidenceStates")
            .findOne({ storeId: f.need.storeId })
        )?.status,
      ).toBe("QUEUED");
      await f.due();
      await f.processor.process(f.need.storeId, f.event.id);
      const corrected = await f.db
        .collection("substitutionEvidence")
        .findOne({ storeId: f.need.storeId });
      expect(corrected).toMatchObject({
        _id: initial!._id,
        version: 2,
        actualSalesValue: "120.00",
        observedVariationPct: "20.000000",
      });
      const history = await f.db
        .collection("substitutionEvidenceHistory")
        .find({ storeId: f.need.storeId })
        .sort({ version: 1 })
        .toArray();
      expect(history[0]?.evidence.actualSalesValue).toBe("135.00");
      expect(history).toHaveLength(2);
    }, 30000);
    it("withdraws eligibility on explicit rejection and never reactivates or changes the relationship score", async () => {
      const f = await seed();
      await f.processor.process(f.need.storeId, f.event.id);
      expect(
        (
          await f.push.push(
            request(
              f.need.storeId,
              "PRODUCT_SUBSTITUTION_UPSERT",
              "product_substitution",
              f.substitution.id,
              { ...f.substitution, status: "REJECTED", version: 2 },
              1,
            ),
            "reject",
          )
        ).results[0]?.status,
      ).toBe("APPLIED");
      await f.due();
      await f.processor.process(f.need.storeId, f.event.id);
      expect(
        await f.db
          .collection("substitutionEvidence")
          .findOne({ storeId: f.need.storeId }),
      ).toMatchObject({
        status: "INELIGIBLE",
        observedVariationPct: null,
        evidenceStrength: null,
      });
      expect(
        await f.db
          .collection("productSubstitutions")
          .findOne({ _id: f.substitution.id } as never),
      ).toMatchObject({
        status: "REJECTED",
        evidenceCount: 0,
        confidence: null,
      });
    }, 30000);
    it("records no fictional zero when imports disappear, and keeps source lineage history", async () => {
      const f = await seed();
      await f.db
        .collection("salesObservations")
        .deleteOne({ _id: f.input.sales[0]!.id } as never);
      await f.processor.process(f.need.storeId, f.event.id);
      expect(
        await f.db
          .collection("substitutionEvidence")
          .findOne({ storeId: f.need.storeId }),
      ).toMatchObject({
        status: "MISSING_SALES",
        actualSalesValue: null,
        observedVariationPct: null,
      });
    }, 30000);
    it("does not read another store or mutate metrics on a forged job scope", async () => {
      const f = await seed();
      expect(await f.processor.process(randomUUID(), f.event.id)).toMatchObject(
        { status: "NOT_DUE" },
      );
      expect(
        await f.db
          .collection("substitutionEvidence")
          .countDocuments({ storeId: f.need.storeId }),
      ).toBe(0);
    }, 30000);
    it("protects old sync clients and restores read-only evidence/state for capable clients", async () => {
      const f = await seed();
      await f.processor.process(f.need.storeId, f.event.id);
      const pull = createMongoSyncPullService(database);
      expect((await pull.pull(f.need.storeId, { limit: 500 })).changes).toEqual(
        [],
      );
      const page = await pull.pull(f.need.storeId, {
        limit: 500,
        substitutionEvidence: "true",
      });
      expect(
        page.changes.some((c) => c.entityType === "substitution_evidence"),
      ).toBe(true);
      expect(
        page.changes.some(
          (c) => c.entityType === "substitution_evidence_state",
        ),
      ).toBe(true);
      const boot = createMongoSyncBootstrapService(database),
        store = {
          storeId: f.need.storeId,
          storeName: "Test",
          role: "MANAGER",
          userId: randomUUID(),
          sessionId: randomUUID(),
          deviceId: randomUUID(),
        };
      expect(
        (await boot.bootstrap(store, { rawObservationDays: 90 })).entities
          .dailySubstitutionEvidence,
      ).toBeUndefined();
      expect(
        (
          await boot.bootstrap(store, {
            rawObservationDays: 90,
            substitutionEvidence: "true",
          })
        ).entities.dailySubstitutionEvidence,
      ).toHaveLength(1);
    }, 30000);
  },
);
