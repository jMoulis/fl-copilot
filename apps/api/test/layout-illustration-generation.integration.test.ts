import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import type { Document } from "mongodb";
import { createMongoDatabase } from "../src/database/mongo";
import { parseEnvironment } from "../src/config";
import type { DatabaseService } from "../src/database/types";
import {
  createLayoutIllustrationGeneration,
  ILLUSTRATION_GENERATIONS,
} from "../src/copilot/layout-illustration-generation";
import { createLayoutIllustrationFiles } from "../src/copilot/layout-illustration-files";
import { createMongoSyncPushService } from "../src/sync/push-service";
import { createMongoSyncPullService } from "../src/sync/pull-service";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service";
import {
  syncPushRequestSchema,
  syncPullQuerySchema,
  bootstrapQuerySchema,
  copilotHistoryQuerySchema,
} from "@fl-copilot/sync-contracts";
import { readCopilotHistory } from "../src/copilot/history";
import { illustrationGenerationFixture } from "../../../scripts/test-layout-illustration-generation";
import { OutboxRepository } from "../../mobile/src/sync/outbox-repository";
import { applyBootstrap } from "../../mobile/src/sync/apply-bootstrap";
import { applyPullPage } from "../../mobile/src/sync/apply-pull-page";
import { AllocationSqliteAdapter } from "../../../scripts/test-physical-allocation-sqlite";
import { runLocalMigrations } from "../../mobile/src/db/migrations";
import { LayoutIllustrationGenerationRepository } from "../../mobile/src/copilot/layout-illustration-generation-repository";
import { illustrationDigest } from "../../../scripts/test-layout-illustration-preparations";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "one authorized illustration attempt through canonical synchronization",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `fl_illustration_gen_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
        }),
      );
      await database.getDb();
    }, 60000);
    afterAll(async () => {
      try {
        await (await database.getDb()).dropDatabase();
      } finally {
        await database.close();
      }
    }, 60000);
    async function seed(
      attempts = 3,
      policyPatch: Partial<
        import("@fl-copilot/domain").LayoutIllustrationGenerationPolicy
      > = {},
    ) {
      const f = await illustrationGenerationFixture(),
        db = await database.getDb(),
        put = async (
          name: string,
          id: string,
          value: Record<string, unknown>,
        ) =>
          db
            .collection<Document & { _id: string }>(name)
            .insertOne({ _id: id, ...value });
      await put("storeMemberships", randomUUID(), {
        storeId: f.scope.storeId,
        userId: f.scope.ownerId,
        active: true,
        role: "MANAGER",
      });
      await put("copilotConversations", f.conversation.id, f.conversation);
      for (const m of [f.user, f.assistant, f.card])
        await put("copilotMessages", m.id, m);
      await put("storeLayouts", f.scope.storeId, f.reference);
      for (const plan of [
        { ...f.first, content: f.reference.content },
        f.reference,
      ])
        await put("storeLayoutRevisions", plan.revisionId, {
          id: plan.revisionId,
          storeId: f.scope.storeId,
          plan,
          version: 1,
        });
      for (const p of f.sources.products) {
        const { id, ...rest } = p;
        await put("products", id, {
          ...rest,
          schemaVersion: 1,
          createdAt: new Date(p.createdAt),
          updatedAt: new Date(p.updatedAt),
          deletedAt: null,
        });
      }
      await put("commercialOfferChoices", f.choice.choice.id, {
        ...f.choice.choice,
        duplicateKey: randomUUID(),
      });
      await put("copilotLayoutIllustrations", f.preparation.id, f.preparation);
      const bytes = new Map<string, Uint8Array>();
      let failImage = false,
        clock = new Date("2026-10-20T17:00:10.000Z");
      const storage = {
          read: async (key: string) => bytes.get(key) ?? null,
          writeImmutable: async (key: string, value: Uint8Array) => {
            if (failImage && key.includes("/image-"))
              throw Error("TEST_BLOB_OFFLINE");
            const previous = bytes.get(key);
            if (previous) expect(previous).toEqual(value);
            else bytes.set(key, new Uint8Array(value));
          },
        },
        files = createLayoutIllustrationFiles(database, storage),
        provider = { generate: vi.fn(async () => f.output) },
        config = {
          enabled: true,
          policy: {
            ...f.policy,
            storeDailyAttempts: attempts,
            globalDailyAttempts: 1000,
            globalDailyReservedUsdMicros: 1_000_000_000,
            ...policyPatch,
          },
          signingSecret: "synthetic-quote-secret-for-test-only-0001",
        },
        now = () => clock,
        service = createLayoutIllustrationGeneration(
          database,
          config,
          files,
          provider,
          now,
        ),
        push = createMongoSyncPushService(database, now, undefined, service),
        scope = {
          ...f.scope,
          storeId: f.scope.storeId,
          userId: f.scope.ownerId,
        },
        repo = new LayoutIllustrationGenerationRepository(
          f.a,
          f.scope,
          illustrationDigest,
          () => clock.toISOString(),
        );
      async function quote() {
        const q = await service.quote(scope, f.preparation.id);
        if (q.state !== "READY") throw Error("TEST_QUOTE_NOT_READY");
        return q.quote;
      }
      async function request(
        q = undefined as Awaited<ReturnType<typeof quote>> | undefined,
      ) {
        const id = randomUUID();
        await repo.confirm(f.card, q ?? (await quote()), {
          id,
          deviceId: f.ids.deviceId,
        });
        const command = (
          await new OutboxRepository(f.a).listPending(f.scope.storeId)
        ).find((c) => c.commandId === id)!;
        return syncPushRequestSchema.parse({
          syncProtocolVersion: 1,
          appVersion: "test",
          deviceId: f.ids.deviceId,
          storeId: f.scope.storeId,
          commands: [
            {
              commandId: command.commandId,
              localSequence: command.localSequence,
              type: command.commandType,
              entityType: command.entityType,
              entityId: command.entityId,
              expectedRemoteVersion: null,
              createdAt: command.createdAt,
              payload: command.payload,
            },
          ],
        });
      }
      return {
        ...f,
        dbMongo: db,
        archivedBytes: bytes,
        files,
        provider,
        config,
        service,
        push,
        scope,
        repo,
        quote,
        request,
        now,
        advance: (ms: number) => {
          clock = new Date(+clock + ms);
        },
        failImage: (v: boolean) => {
          failImage = v;
        },
      };
    }
    it("quotes without spending, accepts one local decision, generates once, conserves the original and restores progress on a second SQLite device", async () => {
      const f = await seed();
      try {
        const q = await f.quote();
        expect(f.provider.generate).not.toHaveBeenCalled();
        const req = await f.request(q),
          id = req.commands[0]!.entityId,
          ack = await f.push.push(req, "gen", f.scope.userId);
        expect(ack.results[0]?.status).toBe("APPLIED");
        expect((await f.service.read(f.scope, id)).status).toBe("QUEUED");
        const beforeProcessing = await createMongoSyncBootstrapService(
          database,
        ).bootstrap(
          {
            ...f.scope,
            role: "MANAGER",
            storeName: "Synthetic",
            sessionId: randomUUID(),
            deviceId: randomUUID(),
          },
          bootstrapQuerySchema.parse({
            copilotHistory: "true",
            layoutIllustrationGenerations: "true",
          }),
        );
        const result = await f.service.process(id);
        expect(result.status).toBe("SUCCEEDED");
        expect(f.provider.generate).toHaveBeenCalledTimes(1);
        expect((await f.service.process(id)).status).toBe("SUCCEEDED");
        expect(
          (await f.push.push(req, "retry", f.scope.userId)).results[0]?.status,
        ).toBe("ALREADY_APPLIED");
        expect(f.provider.generate).toHaveBeenCalledTimes(1);
        const manifest = await f.files.manifest(f.scope, f.preparation.id);
        expect(manifest.state).toBe("READY");
        if (manifest.state !== "READY") throw Error("TEST_MANIFEST_NOT_READY");
        expect(
          (await f.files.read(f.scope, f.preparation.id, id, "original")).bytes,
        ).toEqual(f.output.original.bytes);
        const snapshot = await createMongoSyncBootstrapService(
          database,
        ).bootstrap(
          {
            ...f.scope,
            role: "MANAGER",
            storeName: "Synthetic",
            sessionId: randomUUID(),
            deviceId: randomUUID(),
          },
          bootstrapQuerySchema.parse({
            copilotHistory: "true",
            layoutIllustrations: "true",
            layoutIllustrationGenerations: "true",
            storeLayouts: "true",
            physicalAllocations: "true",
            commercialChoices: "true",
          }),
        );
        expect(snapshot.entities.layoutIllustrationGenerations).toHaveLength(1);
        const dbB = new DatabaseSync(":memory:"),
          b = new AllocationSqliteAdapter(dbB);
        try {
          await runLocalMigrations(b);
          await applyBootstrap(b, f.scope.storeId, snapshot, f.scope.userId);
          expect(
            await new LayoutIllustrationGenerationRepository(
              b,
              f.scope,
              illustrationDigest,
              () => f.now().toISOString(),
            ).find(f.card),
          ).toMatchObject({
            entity: { id, status: "SUCCEEDED" },
            syncState: "SYNCED",
          });
        } finally {
          dbB.close();
        }
        const page = await createMongoSyncPullService(database).pull(
          f.scope.storeId,
          syncPullQuerySchema.parse({
            cursor: beforeProcessing.cursor,
            copilotHistory: "true",
            layoutIllustrationGenerations: "true",
            limit: 100,
          }),
          f.scope.userId,
        );
        const progress = page.changes.filter(
          (c) => c.entityType === "copilot_layout_illustration_generation",
        );
        expect(progress.length).toBeGreaterThan(0);
        expect(
          progress.some(
            (c) => (c.entity as { status?: string }).status === "SUCCEEDED",
          ),
        ).toBe(true);
        await applyPullPage(f.a, f.scope.storeId, page, f.scope.userId);
        expect(await f.repo.find(f.card)).toMatchObject({
          entity: { id, status: "SUCCEEDED" },
          syncState: "PENDING",
        });
        const legacyPage = await createMongoSyncPullService(database).pull(
          f.scope.storeId,
          syncPullQuerySchema.parse({
            cursor: beforeProcessing.cursor,
            copilotHistory: "true",
            limit: 100,
          }),
          f.scope.userId,
        );
        expect(
          legacyPage.changes.some(
            (c) => c.entityType === "copilot_layout_illustration_generation",
          ),
        ).toBe(false);
        const budget = await f.dbMongo
          .collection<{
            _id: string;
            attempts: number;
            reservedUsdMicros: number;
          }>("layoutIllustrationBudgets")
          .findOne({ _id: `store:${f.scope.storeId}:2026-10-20` });
        expect(budget).toMatchObject({
          attempts: 1,
          reservedUsdMicros: f.policy.estimatedCostUsdMicros,
        });
      } finally {
        f.db.close();
      }
    });
    it("acknowledges an accepted decision for a demoted active owner but refuses a fresh decision and an inactive owner", async () => {
      const f = await seed();
      try {
        const req = await f.request();
        const fresh = await f.request();
        expect(
          (await f.push.push(req, "manager", f.scope.userId)).results[0]
            ?.status,
        ).toBe("APPLIED");
        await f.dbMongo
          .collection("storeMemberships")
          .updateOne(
            { storeId: f.scope.storeId, userId: f.scope.userId },
            { $set: { role: "STAFF" } },
          );
        expect(
          (await f.push.push(req, "staff-ack", f.scope.userId)).results[0]
            ?.status,
        ).toBe("ALREADY_APPLIED");
        expect(
          (await f.push.push(fresh, "staff-new", f.scope.userId)).results[0]
            ?.status,
        ).toBe("REJECTED");
        await f.dbMongo
          .collection("storeMemberships")
          .updateOne(
            { storeId: f.scope.storeId, userId: f.scope.userId },
            { $set: { active: false } },
          );
        expect(
          (await f.push.push(req, "inactive", f.scope.userId)).results[0]
            ?.status,
        ).toBe("REJECTED");
        expect(f.provider.generate).not.toHaveBeenCalled();
      } finally {
        f.db.close();
      }
    });
    it("rejects tampered, foreign and expired decisions before reserving a budget or invoking a provider", async () => {
      for (const mode of ["signature", "expired", "foreign"]) {
        const f = await seed();
        try {
          const req = await f.request();
          if (mode === "signature")
            (
              req.commands[0]!.payload as { quote: { signature: string } }
            ).quote.signature = "0".repeat(64);
          if (mode === "expired") f.advance(300_000);
          const response = await f.push.push(
            req,
            "invalid",
            mode === "foreign" ? randomUUID() : f.scope.userId,
          );
          expect(response.results[0]?.status).toBe("REJECTED");
          expect(
            await f.dbMongo
              .collection(ILLUSTRATION_GENERATIONS)
              .countDocuments({ storeId: f.scope.storeId }),
          ).toBe(0);
          expect(
            await f.dbMongo
              .collection<Document & { _id: string }>(
                "layoutIllustrationBudgets",
              )
              .countDocuments({ _id: `store:${f.scope.storeId}:2026-10-20` }),
          ).toBe(0);
          expect(f.provider.generate).not.toHaveBeenCalled();
        } finally {
          f.db.close();
        }
      }
    });
    it("reserves daily attempts once and refuses a reused quote, a concurrent active request and an exhausted daily allowance", async () => {
      const f = await seed(1);
      try {
        const req = await f.request(),
          id = req.commands[0]!.entityId;
        expect(
          (await f.push.push(req, "first", f.scope.userId)).results[0]?.status,
        ).toBe("APPLIED");
        const other = await f.request();
        expect(
          (await f.push.push(other, "active", f.scope.userId)).results[0]
            ?.status,
        ).toBe("REJECTED");
        await f.service.process(id);
        const more = await f.request();
        expect(
          (await f.push.push(more, "limited", f.scope.userId)).results[0]?.error
            ?.code,
        ).toBe("LAYOUT_ILLUSTRATION_LIMIT_REACHED");
        const used = structuredClone(req);
        const next = randomUUID();
        used.commands[0]!.commandId = next;
        used.commands[0]!.entityId = next;
        (used.commands[0]!.payload as { id: string }).id = next;
        expect(
          (await f.push.push(used, "used-quote", f.scope.userId)).results[0]
            ?.error?.code,
        ).toBe("LAYOUT_ILLUSTRATION_QUOTE_USED");
        expect(f.provider.generate).toHaveBeenCalledTimes(1);
      } finally {
        f.db.close();
      }
    });
    it("never calls the provider twice when two workers race, including a restarted processor", async () => {
      const f = await seed();
      try {
        const req = await f.request();
        await f.push.push(req, "queue", f.scope.userId);
        const id = req.commands[0]!.entityId;
        let entered!: () => void, release!: () => void;
        const ready = new Promise<void>((r) => {
            entered = r;
          }),
          blocked = new Promise<void>((r) => {
            release = r;
          });
        f.provider.generate.mockImplementation(async () => {
          entered();
          await blocked;
          return f.output;
        });
        const running = f.service.process(id);
        await ready;
        const restarted = createLayoutIllustrationGeneration(
          database,
          f.config,
          f.files,
          f.provider,
          f.now,
        );
        expect((await restarted.process(id)).status).toBe("SUBMITTED");
        expect(f.provider.generate).toHaveBeenCalledTimes(1);
        release();
        expect((await running).status).toBe("SUCCEEDED");
        expect((await restarted.process(id)).status).toBe("SUCCEEDED");
        expect(f.provider.generate).toHaveBeenCalledTimes(1);
      } finally {
        f.db.close();
      }
    });
    it("retains an uncertain submitted outcome and its budget instead of retrying a lost provider response", async () => {
      const f = await seed();
      try {
        const req = await f.request();
        await f.push.push(req, "queue", f.scope.userId);
        const id = req.commands[0]!.entityId;
        f.provider.generate.mockRejectedValue(
          Error("TEST_PROVIDER_RESPONSE_LOST"),
        );
        expect(await f.service.process(id)).toMatchObject({
          status: "OUTCOME_UNKNOWN",
          reason: "RESULT_UNCERTAIN",
        });
        expect(await f.service.process(id)).toMatchObject({
          status: "OUTCOME_UNKNOWN",
        });
        expect(f.provider.generate).toHaveBeenCalledTimes(1);
        expect(await f.service.pending(f.scope.storeId)).toEqual([]);
      } finally {
        f.db.close();
      }
    });
    it("recovers interrupted archiving from the same original with no second provider call", async () => {
      const f = await seed();
      try {
        const req = await f.request();
        await f.push.push(req, "queue", f.scope.userId);
        const id = req.commands[0]!.entityId;
        f.failImage(true);
        expect(await f.service.process(id)).toMatchObject({
          status: "OUTCOME_UNKNOWN",
          reason: "ARCHIVE_PENDING",
        });
        expect(f.archivedBytes.size).toBeGreaterThan(0);
        f.failImage(false);
        const restart = createLayoutIllustrationGeneration(
          database,
          f.config,
          f.files,
          f.provider,
          f.now,
        );
        expect((await restart.process(id)).status).toBe("SUCCEEDED");
        expect(f.provider.generate).toHaveBeenCalledTimes(1);
        expect(
          (await f.files.read(f.scope, f.preparation.id, id, "original")).bytes,
        ).toEqual(f.output.original.bytes);
      } finally {
        f.db.close();
      }
    });
    it("rechecks expiry, source freshness, membership and disabled policy before submission and never activates an older unpaid preparation", async () => {
      for (const mode of ["expired", "source", "role", "disabled"]) {
        const f = await seed();
        try {
          expect(await f.service.pending(f.scope.storeId)).toEqual([]);
          const req = await f.request();
          await f.push.push(req, "queue", f.scope.userId);
          const id = req.commands[0]!.entityId;
          if (mode === "expired") f.advance(300_000);
          if (mode === "source")
            await f.dbMongo
              .collection("products")
              .updateOne(
                { storeId: f.scope.storeId },
                { $inc: { version: 1 } },
              );
          if (mode === "role")
            await f.dbMongo
              .collection("storeMemberships")
              .updateOne(
                { storeId: f.scope.storeId, userId: f.scope.userId },
                { $set: { role: "STAFF" } },
              );
          const service =
            mode === "disabled"
              ? createLayoutIllustrationGeneration(
                  database,
                  { enabled: false },
                  f.files,
                  undefined,
                  f.now,
                )
              : f.service;
          expect((await service.process(id)).status).toBe("NOT_SUBMITTED");
          expect(f.provider.generate).not.toHaveBeenCalled();
          expect((await service.process(id)).status).toBe("NOT_SUBMITTED");
        } finally {
          f.db.close();
        }
      }
    });
    it("conserves already-produced bytes after authority withdrawal but denies subsequent private result and progress reads", async () => {
      const f = await seed();
      try {
        const req = await f.request();
        await f.push.push(req, "queue", f.scope.userId);
        const id = req.commands[0]!.entityId;
        f.provider.generate.mockImplementation(async () => {
          await f.dbMongo
            .collection("storeMemberships")
            .updateOne(
              { storeId: f.scope.storeId, userId: f.scope.userId },
              { $set: { active: false } },
            );
          return f.output;
        });
        expect((await f.service.process(id)).status).toBe("SUCCEEDED");
        expect(f.archivedBytes.size).toBe(4);
        await expect(f.service.read(f.scope, id)).rejects.toThrow(
          "UNAVAILABLE",
        );
        await expect(
          f.files.manifest(f.scope, f.preparation.id),
        ).rejects.toThrow("UNAVAILABLE");
        await expect(
          f.service.read({ ...f.scope, userId: randomUUID() }, id),
        ).rejects.toThrow("UNAVAILABLE");
      } finally {
        f.db.close();
      }
    });
    it("serializes simultaneous confirmations against one shared global estimate allowance", async () => {
      const f = await seed(3, {
          globalDailyAttempts: 1,
          globalDailyReservedUsdMicros: 500_000,
        }),
        other = await seed(3, {
          id: f.config.policy.id,
          globalDailyAttempts: 1,
          globalDailyReservedUsdMicros: 500_000,
        });
      try {
        f.advance(3 * 86400000);
        other.advance(3 * 86400000);
        const [one, two] = await Promise.all([f.request(), other.request()]);
        const results = await Promise.all([
          f.push.push(one, "global-one", f.scope.userId),
          other.push.push(two, "global-two", other.scope.userId),
        ]);
        expect(results.map((r) => r.results[0]?.status).sort()).toEqual([
          "APPLIED",
          "REJECTED",
        ]);
        expect(
          await f.dbMongo
            .collection<{
              _id: string;
              attempts: number;
              reservedUsdMicros: number;
            }>("layoutIllustrationBudgets")
            .findOne({ _id: "global:2026-10-23" }),
        ).toMatchObject({ attempts: 1, reservedUsdMicros: 500_000 });
        expect(f.provider.generate).not.toHaveBeenCalled();
        expect(other.provider.generate).not.toHaveBeenCalled();
      } finally {
        f.db.close();
        other.db.close();
      }
    });
    it("bounds owner history pages and hides generation changes from older clients", async () => {
      const f = await seed();
      try {
        const req = await f.request();
        await f.push.push(req, "queue", f.scope.userId);
        const page = await readCopilotHistory(
          f.dbMongo,
          f.scope.storeId,
          f.scope.userId,
          copilotHistoryQuerySchema.parse({
            recordType: "LAYOUT_ILLUSTRATION_GENERATIONS",
            limit: 1,
          }),
        );
        expect(page.layoutIllustrationGenerations).toHaveLength(1);
        expect(page.layoutIllustrations).toBeUndefined();
        const foreign = await readCopilotHistory(
          f.dbMongo,
          f.scope.storeId,
          randomUUID(),
          copilotHistoryQuerySchema.parse({
            recordType: "LAYOUT_ILLUSTRATION_GENERATIONS",
          }),
        );
        expect(foreign.layoutIllustrationGenerations).toEqual([]);
        const legacy = await createMongoSyncBootstrapService(
          database,
        ).bootstrap(
          {
            ...f.scope,
            role: "MANAGER",
            storeName: "Synthetic",
            sessionId: randomUUID(),
            deviceId: randomUUID(),
          },
          bootstrapQuerySchema.parse({ copilotHistory: "true" }),
        );
        expect(legacy.entities.layoutIllustrationGenerations).toBeUndefined();
      } finally {
        f.db.close();
      }
    });
  },
);
