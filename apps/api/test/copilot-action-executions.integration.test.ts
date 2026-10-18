import { randomUUID } from "node:crypto";
import { MongoClient, type Db, type Document } from "mongodb";
import {
  beforeAll,
  afterAll,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { actionExecutionFixture } from "../../../scripts/test-action-execution-fixtures";
import { decisionDigest } from "../../../scripts/test-copilot-decision-fixtures";
import { MercalysTestDatabase } from "../../../scripts/test-mercalys-sync-fixtures";
import { runMongoMigrations } from "../src/database/migrations";
import { runLocalMigrations } from "../../mobile/src/db/migrations";
import { CopilotActionExecutionRepository } from "../../mobile/src/copilot/action-execution-repository";
import { MobileSyncService } from "../../mobile/src/sync/sync-service";
import { OutboxRepository } from "../../mobile/src/sync/outbox-repository";
import { createMongoSyncPushService } from "../src/sync/push-service";
import { createMongoSyncPullService } from "../src/sync/pull-service";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service";
import {
  bootstrapQuerySchema,
  syncPullQuerySchema,
  syncCommandSchema,
  type SyncPushRequest,
} from "@fl-copilot/sync-contracts";
import {
  readActionExecutionPreview,
  readActionExecutions,
} from "../src/copilot/action-execution-tool";
import { runCopilotTurn } from "../src/copilot/turn-service";
import type { CopilotAiProvider } from "../src/copilot/ai-provider";
import {
  detectCopilotConflicts,
  scoreCopilotPriorities,
} from "@fl-copilot/analytics-core";
const uri = process.env.TEST_MONGODB_URI;
type Fixture = Awaited<ReturnType<typeof actionExecutionFixture>>;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "private generic action declarations",
  () => {
    let client: MongoClient, db: Db;
    const devices: MercalysTestDatabase[] = [];
    beforeAll(async () => {
      client = await MongoClient.connect(uri!);
      db = client.db(`fl_act_${randomUUID().replaceAll("-", "").slice(0, 20)}`);
      await runMongoMigrations(db);
    }, 60000);
    afterEach(() => {
      for (const d of devices.splice(0)) d.db.close();
    });
    afterAll(async () => {
      try {
        await db?.dropDatabase();
      } finally {
        await client?.close();
      }
    }, 60000);
    const service = () => ({
      getDb: async () => db,
      checkHealth: async () => "connected" as const,
      close: async () => {},
    });
    async function seed(includeCard = true) {
      const f = await actionExecutionFixture();
      devices.push(f.db);
      const insert = (name: string, row: Document & { _id: string }) =>
        db.collection<Document & { _id: string }>(name).insertOne(row);
      await insert("copilotConversations", {
        _id: f.conversation.id,
        ...f.conversation,
      });
      for (const m of [
        f.message,
        f.source,
        f.request,
        f.assistant,
        f.card,
        f.actionRequest,
        ...(includeCard ? [f.actionAssistant, f.actionCard] : []),
      ])
        await insert("copilotMessages", { _id: m.id, ...m });
      return f;
    }
    function transport(f: Fixture, ownerId = f.ownerId) {
      const push = createMongoSyncPushService(service()),
        pull = createMongoSyncPullService(service()),
        boot = createMongoSyncBootstrapService(service()),
        authority = {
          storeId: f.storeId,
          userId: ownerId,
          deviceId: f.deviceId,
          sessionId: randomUUID(),
          storeName: "Test",
          role: "MANAGER" as const,
        },
        q = { copilotHistory: "true", copilotActionExecutions: "true" };
      return {
        push: (r: SyncPushRequest) => push.push(r, randomUUID(), ownerId),
        pull: (storeId: string, cursor: string) =>
          pull.pull(
            storeId,
            syncPullQuerySchema.parse({ ...q, cursor }),
            ownerId,
          ),
        bootstrap: () =>
          boot.bootstrap(authority, bootstrapQuerySchema.parse(q)),
        rawPush: push,
        rawPull: pull,
        rawBootstrap: boot,
        authority,
      };
    }
    const sync = (f: Fixture, device = f.db) =>
      new MobileSyncService(device, transport(f), {
        appVersion: "test",
        deviceId: f.deviceId,
        copilotOwnerId: f.ownerId,
        copilotHistory: true,
        copilotActionExecutions: true,
      });
    async function confirm(f: Fixture) {
      const s = await f.repository.open(f.actionCard);
      return f.repository.save(f.actionCard, s.review);
    }
    it("prepares and atomically produces a real private tool card with replay but no execution or acceptance until explicit confirmation", async () => {
      const f = await seed(false),
        preview = await readActionExecutionPreview(
          db,
          {
            storeId: f.storeId,
            ownerId: f.ownerId,
            conversationId: f.conversation.id,
          },
          f.input,
        );
      expect(preview.status).toBe("READY");
      const generate = vi.fn(async () => ({
        output: {
          language: "fr-FR",
          summary: "La réalisation est prête à être confirmée.",
          facts: preview.evidence.map((e) => ({ evidenceId: e.id })),
          interpretation: [],
          recommendations: [],
          questions: [],
        },
        metadata: {
          requestedModel: "test",
          resolvedModel: "test",
          responseId: "action-test",
          inputTokens: null,
          outputTokens: null,
        },
        toolEvidence: preview.evidence,
        actionExecutionPreviews: [preview],
      }));
      const deps = {
        db,
        provider: { model: "test", generate } as CopilotAiProvider,
        authorize: async () => ({
          storeId: f.storeId,
          ownerId: f.ownerId,
          canRespond: true,
        }),
        now: () => new Date(f.actionAssistant.createdAt),
        loadContext: async () =>
          detectCopilotConflicts({
            batch: scoreCopilotPriorities({
              storeId: f.storeId,
              evaluatedAt: f.actionAssistant.createdAt,
              candidates: [],
            }),
            intents: [],
          }),
      };
      const turn = {
        conversationId: f.conversation.id,
        userMessageId: f.actionRequest.id,
        replyId: f.actionAssistant.id,
      };
      await runCopilotTurn(deps, turn);
      expect((await runCopilotTurn(deps, turn)).alreadyApplied).toBe(true);
      expect(generate).toHaveBeenCalledOnce();
      expect(
        await db
          .collection("actionExecutions")
          .countDocuments({ storeId: f.storeId }),
      ).toBe(0);
      expect(
        await db
          .collection("copilotDecisions")
          .countDocuments({ storeId: f.storeId }),
      ).toBe(0);
      expect(
        await db
          .collection<{ _id: string }>("copilotMessages")
          .findOne({ _id: f.actionCard.id }),
      ).toMatchObject({ role: "TOOL" });
    }, 60000);
    it("pushes an offline confirmation once, restores it on a second SQLite database, and propagates withdrawal while keeping business records untouched", async () => {
      const f = await seed();
      await confirm(f);
      await sync(f).sync(f.storeId);
      await sync(f).sync(f.storeId);
      expect((await f.repository.open(f.actionCard)).syncState).toBe("SYNCED");
      const second = new MercalysTestDatabase();
      devices.push(second);
      await runLocalMigrations(second);
      await sync(f, second).sync(f.storeId);
      const repo = new CopilotActionExecutionRepository(
        second,
        f.actionScope,
        decisionDigest,
        randomUUID,
        () => "2026-10-18T13:00:00.000Z",
      );
      let s = await repo.open(f.actionCard);
      expect(s.status).toBe("CONFIRMED");
      expect(s.link?.snapshot.actuals).toEqual(f.input.actuals);
      s = await repo.save(f.actionCard, s.review, true);
      await sync(f, second).sync(f.storeId);
      await sync(f).sync(f.storeId);
      expect((await f.repository.open(f.actionCard)).link?.status).toBe(
        "WITHDRAWN",
      );
      expect(
        await db.collection("syncChanges").countDocuments({
          storeId: f.storeId,
          entityType: "copilot_action_execution",
        }),
      ).toBe(2);
      for (const collection of [
        "copilotDecisions",
        "commercialExecutionTasks",
        "salesObservations",
        "wasteObservations",
      ])
        expect(
          await db
            .collection(collection)
            .countDocuments({ storeId: f.storeId }),
        ).toBe(0);
    }, 60000);
    it("isolates bootstrap, pull, bounded reads and cached command replay by actor, while legacy clients receive no new records", async () => {
      const f = await seed();
      await confirm(f);
      const commands = await new OutboxRepository(f.db).listPending(f.storeId);
      const r: SyncPushRequest = {
        syncProtocolVersion: 1,
        appVersion: "test",
        deviceId: f.deviceId,
        storeId: f.storeId,
        commands: commands.map((c) =>
          syncCommandSchema.parse({ ...c, type: c.commandType }),
        ),
      };
      const own = transport(f);
      await own.push(r);
      const other = transport(f, randomUUID());
      expect(
        (await other.bootstrap()).entities.copilotActionExecutions,
      ).toEqual([]);
      expect(
        (await other.rawPush.push(r, "other", other.authority.userId))
          .results[0],
      ).toMatchObject({ status: "REJECTED" });
      expect(
        (
          await other.rawPull.pull(
            f.storeId,
            syncPullQuerySchema.parse({
              copilotHistory: "true",
              copilotActionExecutions: "true",
            }),
            other.authority.userId,
          )
        ).changes,
      ).toEqual([]);
      expect(
        (
          await own.rawBootstrap.bootstrap(
            own.authority,
            bootstrapQuerySchema.parse({ copilotHistory: "true" }),
          )
        ).entities.copilotActionExecutions,
      ).toBeUndefined();
      expect(
        (
          await own.rawPull.pull(
            f.storeId,
            syncPullQuerySchema.parse({ copilotHistory: "true" }),
            f.ownerId,
          )
        ).changes.some((c) => c.entityType === "copilot_action_execution"),
      ).toBe(false);
      const page = { recommendationId: null, afterId: null, limit: 5 };
      expect(
        (
          await readActionExecutions(
            db,
            { storeId: f.storeId, ownerId: other.authority.userId },
            page,
          )
        ).entries,
      ).toEqual([]);
      expect(
        (
          await readActionExecutions(
            db,
            { storeId: f.storeId, ownerId: f.ownerId },
            page,
          )
        ).entries,
      ).toHaveLength(1);
    }, 60000);
    it("coalesces two devices confirming the same immutable card and never restores an old declaration after withdrawal", async () => {
      const f = await seed(),
        saved = await confirm(f),
        e = saved.link!,
        push = transport(f).rawPush;
      const request = (
        entity: typeof e,
        expected: number | null = null,
      ): SyncPushRequest => ({
        syncProtocolVersion: 1,
        appVersion: "test",
        deviceId: randomUUID(),
        storeId: f.storeId,
        commands: [
          {
            commandId: randomUUID(),
            localSequence: 1,
            type: "COPILOT_ACTION_EXECUTION_UPSERT",
            entityType: "copilot_action_execution",
            entityId: e.id,
            payload: entity,
            expectedRemoteVersion: expected,
            createdAt: entity.withdrawnAt ?? entity.createdAt,
          },
        ],
      });
      await push.push(request(e), "first", f.ownerId);
      expect(
        (
          await push.push(
            request({ ...e, createdAt: "2026-10-18T12:01:00.000Z" }),
            "second",
            f.ownerId,
          )
        ).results[0]?.remoteEntity,
      ).toMatchObject({ createdAt: e.createdAt });
      const retired = {
        ...e,
        version: 2 as const,
        status: "WITHDRAWN" as const,
        withdrawnAt: "2026-10-18T13:00:00.000Z",
      };
      await push.push(request(retired, 1), "withdraw", f.ownerId);
      expect(
        (await push.push(request(e), "late", f.ownerId)).results[0]
          ?.remoteEntity,
      ).toMatchObject({ status: "WITHDRAWN", version: 2 });
      expect(
        await db.collection("syncChanges").countDocuments({
          storeId: f.storeId,
          entityType: "copilot_action_execution",
        }),
      ).toBe(2);
    }, 60000);
    it("rejects forged content or source proofs and preserves an offline historical declaration when the source is hidden after capture", async () => {
      const f = await seed(),
        saved = await confirm(f),
        e = saved.link!,
        push = transport(f).rawPush;
      const request = (entity: typeof e): SyncPushRequest => ({
        syncProtocolVersion: 1,
        appVersion: "test",
        deviceId: f.deviceId,
        storeId: f.storeId,
        commands: [
          {
            commandId: randomUUID(),
            localSequence: 1,
            type: "COPILOT_ACTION_EXECUTION_UPSERT",
            entityType: "copilot_action_execution",
            entityId: e.id,
            payload: entity,
            expectedRemoteVersion: null,
            createdAt: entity.createdAt,
          },
        ],
      });
      expect(
        (
          await push.push(
            request({
              ...e,
              snapshot: { ...e.snapshot, action: "Fausse réalisation" },
            }),
            "forged",
            f.ownerId,
          )
        ).results[0]?.status,
      ).toBe("REJECTED");
      await db
        .collection<{ _id: string }>("copilotConversations")
        .updateOne(
          { _id: f.conversation.id },
          { $set: { deletedMessageIds: [f.source.id] } },
        );
      expect(
        (await push.push(request(e), "historical", f.ownerId)).results[0]
          ?.status,
      ).toBe("APPLIED");
      const preview = await readActionExecutionPreview(
        db,
        {
          storeId: f.storeId,
          ownerId: f.ownerId,
          conversationId: f.conversation.id,
        },
        f.input,
      );
      expect(preview.status).toBe("SOURCE_UNAVAILABLE");
    }, 60000);
    it("keeps local intent on exhausted capacity and paginates owned historical records without counting them as physical executions", async () => {
      const f = await seed();
      await db
        .collection<{
          _id: string;
          storeId: string;
          ownerId: string;
          count: number;
        }>("actionExecutionCounters")
        .insertOne({
          _id: `${f.storeId}:${f.ownerId}`,
          storeId: f.storeId,
          ownerId: f.ownerId,
          count: 500,
        });
      await confirm(f);
      await sync(f).sync(f.storeId);
      expect((await f.repository.open(f.actionCard)).status).toBe("ERROR");
      expect(
        await db
          .collection("actionExecutions")
          .countDocuments({ storeId: f.storeId }),
      ).toBe(0);
      const e = (await f.repository.open(f.actionCard)).link!;
      for (let i = 0; i < 6; i++) {
        const id = randomUUID();
        await db
          .collection<Document & { _id: string }>("actionExecutions")
          .insertOne({ _id: id, ...e, id, proposalMessageId: id });
      }
      const first = await readActionExecutions(
        db,
        { storeId: f.storeId, ownerId: f.ownerId },
        { recommendationId: null, afterId: null, limit: 5 },
      );
      expect(first.entries).toHaveLength(5);
      expect(first.hasMore).toBe(true);
      expect(
        (
          await readActionExecutions(
            db,
            { storeId: f.storeId, ownerId: f.ownerId },
            { recommendationId: null, afterId: first.nextAfterId, limit: 5 },
          )
        ).entries,
      ).toHaveLength(1);
      expect(first.evidence[0]?.value).toContain("même action physique");
    }, 60000);
    it("serializes confirmation then withdrawal captured before the first synchronization without losing either intent", async () => {
      const f = await seed();
      let s = await confirm(f);
      s = await f.repository.save(f.actionCard, s.review, true);
      expect(s.link?.version).toBe(2);
      await sync(f).sync(f.storeId);
      expect((await f.repository.open(f.actionCard)).link?.status).toBe(
        "WITHDRAWN",
      );
      expect((await f.repository.open(f.actionCard)).syncState).toBe("SYNCED");
      expect(
        await db.collection("syncChanges").countDocuments({
          storeId: f.storeId,
          entityType: "copilot_action_execution",
        }),
      ).toBe(2);
    }, 60000);
  },
);
