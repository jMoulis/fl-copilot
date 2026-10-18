import { randomUUID } from "node:crypto";
import { MongoClient, type Db, type Document } from "mongodb";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { executionLinkFixture } from "../../../scripts/test-execution-link-fixtures";
import { decisionDigest } from "../../../scripts/test-copilot-decision-fixtures";
import { MercalysTestDatabase } from "../../../scripts/test-mercalys-sync-fixtures";
import { runMongoMigrations } from "../src/database/migrations";
import { runLocalMigrations } from "../../mobile/src/db/migrations";
import { CopilotExecutionLinkRepository } from "../../mobile/src/copilot/execution-link-repository";
import { MobileSyncService } from "../../mobile/src/sync/sync-service";
import { OutboxRepository } from "../../mobile/src/sync/outbox-repository";
import { createMongoSyncPushService } from "../src/sync/push-service";
import { createMongoSyncPullService } from "../src/sync/pull-service";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service";
import {
  syncCommandSchema,
  bootstrapQuerySchema,
  syncPullQuerySchema,
  type SyncPushRequest,
} from "@fl-copilot/sync-contracts";
import { copilotExecutionLinkSchema } from "@fl-copilot/domain";
import {
  readExecutionLinkPreview,
  readExecutionLinks,
} from "../src/copilot/execution-link-tool";
import { runCopilotTurn } from "../src/copilot/turn-service";
import type { CopilotAiProvider } from "../src/copilot/ai-provider";
import {
  detectCopilotConflicts,
  scoreCopilotPriorities,
} from "@fl-copilot/analytics-core";
const uri = process.env.TEST_MONGODB_URI,
  enabled = process.env.TEST_MONGODB_TRANSACTIONS === "true";
type Fixture = Awaited<ReturnType<typeof executionLinkFixture>>;
describe.skipIf(!uri || !enabled)(
  "private decision/execution associations",
  () => {
    let client: MongoClient, db: Db;
    const devices: MercalysTestDatabase[] = [];
    beforeAll(async () => {
      client = await MongoClient.connect(uri!);
      db = client.db(
        `fl_links_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
      );
      await runMongoMigrations(db);
    }, 60000);
    afterEach(() => {
      for (const d of devices.splice(0)) d.db.close();
    }, 60000);
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
    async function seed(includeLinkCard = true) {
      const f = await executionLinkFixture();
      devices.push(f.db);
      const insert = async (
        name: string,
        row: Document & {
          _id: string;
        },
      ) =>
        db
          .collection<
            Document & {
              _id: string;
            }
          >(name)
          .insertOne(row);
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
        f.linkRequest,
        ...(includeLinkCard ? [f.linkAssistant, f.linkCard] : []),
      ])
        await insert("copilotMessages", { _id: m.id, ...m });
      await insert("copilotDecisions", { _id: f.decision.id, ...f.decision });
      await insert("commercialWeekPlans", {
        _id: f.business.plan.id,
        ...f.business.plan,
      });
      await insert("commercialPlanRevisions", {
        _id: f.business.plan.revisionId,
        id: f.business.plan.revisionId,
        storeId: f.storeId,
        plan: f.business.plan,
        version: 1,
      });
      await insert("commercialExecutionTasks", {
        _id: f.business.task.id,
        ...f.business.task,
      });
      await db.collection("commercialExecutionHistory").insertOne({
        storeId: f.storeId,
        taskId: f.business.task.id,
        version: f.business.task.version,
        commandId: randomUUID(),
        plan: f.business.task,
      });
      return f;
    }
    function transport(f: Fixture, ownerId = f.ownerId) {
      const push = createMongoSyncPushService(service()),
        pull = createMongoSyncPullService(service()),
        bootstrap = createMongoSyncBootstrapService(service());
      const authority = {
          storeId: f.storeId,
          userId: ownerId,
          sessionId: randomUUID(),
          deviceId: f.deviceId,
          storeName: "Pilote",
          role: "MANAGER" as const,
        },
        q = {
          copilotHistory: "true",
          copilotDecisions: "true",
          copilotExecutionLinks: "true",
        };
      return {
        push: (r: SyncPushRequest) => push.push(r, randomUUID(), ownerId),
        pull: (storeId: string, cursor: string) =>
          pull.pull(
            storeId,
            syncPullQuerySchema.parse({ ...q, cursor }),
            ownerId,
          ),
        bootstrap: () =>
          bootstrap.bootstrap(authority, bootstrapQuerySchema.parse(q)),
        rawPush: push,
        rawPull: pull,
        rawBootstrap: bootstrap,
        authority,
      };
    }
    const sync = (f: Fixture, device = f.db) =>
      new MobileSyncService(device, transport(f), {
        appVersion: "test",
        deviceId: f.deviceId,
        copilotOwnerId: f.ownerId,
        copilotHistory: true,
        copilotDecisions: true,
        copilotExecutionLinks: true,
      });
    async function confirm(f: Fixture) {
      const s = await f.repository.open(f.linkCard);
      return f.repository.save(f.linkCard, s.review);
    }
    it("produces an owned confirmation card atomically and replays the private turn without creating an association", async () => {
      const f = await seed(false),
        preview = await readExecutionLinkPreview(
          db,
          { storeId: f.storeId, ownerId: f.ownerId },
          f.input,
        );
      expect(preview.status).toBe("READY");
      const generate = vi.fn(async () => ({
        output: {
          language: "fr-FR",
          summary: "L’association est prête à être confirmée.",
          facts: preview.evidence.map((e) => ({ evidenceId: e.id })),
          interpretation: [],
          recommendations: [],
          questions: [],
        },
        metadata: {
          requestedModel: "test",
          resolvedModel: "test",
          responseId: "link-test",
          inputTokens: null,
          outputTokens: null,
        },
        toolEvidence: preview.evidence,
        executionLinkPreviews: [preview],
      }));
      const deps = {
        db,
        provider: { model: "test", generate } as CopilotAiProvider,
        authorize: async () => ({
          storeId: f.storeId,
          ownerId: f.ownerId,
          canRespond: true,
        }),
        now: () => new Date(f.linkAssistant.createdAt),
        loadContext: async () =>
          detectCopilotConflicts({
            batch: scoreCopilotPriorities({
              storeId: f.storeId,
              evaluatedAt: f.linkAssistant.createdAt,
              candidates: [],
            }),
            intents: [],
          }),
      };
      const turn = {
        conversationId: f.conversation.id,
        userMessageId: f.linkRequest.id,
        replyId: f.linkAssistant.id,
      };
      await runCopilotTurn(deps, turn);
      expect((await runCopilotTurn(deps, turn)).alreadyApplied).toBe(true);
      expect(generate).toHaveBeenCalledOnce();
      const card = await db
        .collection("copilotMessages")
        .findOne({ _id: f.linkCard.id as never });
      expect(card?.role).toBe("TOOL");
      expect(
        await db
          .collection("copilotExecutionLinks")
          .countDocuments({ storeId: f.storeId }),
      ).toBe(0);
    }, 60000);
    it("synchronizes an offline confirmation exactly once, restores it on a second device and propagates withdrawal without changing the choice/task", async () => {
      const f = await seed();
      await confirm(f);
      await sync(f).sync(f.storeId);
      await sync(f).sync(f.storeId);
      expect((await f.repository.open(f.linkCard)).syncState).toBe("SYNCED");
      const restored = new MercalysTestDatabase();
      devices.push(restored);
      await runLocalMigrations(restored);
      await sync(f, restored).sync(f.storeId);
      const repo = new CopilotExecutionLinkRepository(
        restored,
        f.linkScope,
        decisionDigest,
        randomUUID,
        () => "2026-10-18T13:00:00.000Z",
      );
      let s = await repo.open(f.linkCard);
      expect(s.status).toBe("CONFIRMED");
      expect(s.link?.snapshot.decision.revision.type).toBe("MODIFY");
      await repo.save(f.linkCard, s.review, true);
      await sync(f, restored).sync(f.storeId);
      await sync(f).sync(f.storeId);
      s = await f.repository.open(f.linkCard);
      expect(s.status).toBe("WITHDRAWN");
      expect(s.syncState).toBe("SYNCED");
      expect(
        await db
          .collection("copilotExecutionLinks")
          .countDocuments({ storeId: f.storeId }),
      ).toBe(1);
      expect(
        await db
          .collection("copilotDecisions")
          .findOne({ _id: f.decision.id as never }),
      ).toEqual({ _id: f.decision.id, ...f.decision });
      expect(
        await db
          .collection("commercialExecutionTasks")
          .findOne({ _id: f.business.task.id as never }),
      ).toEqual({ _id: f.business.task.id, ...f.business.task });
      expect(
        await db.collection("syncChanges").countDocuments({
          storeId: f.storeId,
          entityType: "copilot_execution_link",
        }),
      ).toBe(2);
    }, 60000);
    it("keeps links private on bootstrap, pull, read and cached command replay; old clients receive no new entities", async () => {
      const f = await seed(),
        before = await transport(f).bootstrap();
      await confirm(f);
      const command = (
        await new OutboxRepository(f.db).listPending(f.storeId)
      )[0]!;
      await sync(f).sync(f.storeId);
      const other = transport(f, randomUUID()),
        foreign = await other.bootstrap();
      expect(foreign.entities.copilotExecutionLinks).toEqual([]);
      const page = await other.rawPull.pull(
        f.storeId,
        syncPullQuerySchema.parse({
          copilotHistory: "true",
          copilotExecutionLinks: "true",
          cursor: before.cursor,
        }),
        other.authority.userId,
      );
      expect(
        page.changes.some((c) => c.entityType === "copilot_execution_link"),
      ).toBe(false);
      const result = await other.rawPush.push(
        {
          syncProtocolVersion: 1,
          appVersion: "test",
          storeId: f.storeId,
          deviceId: f.deviceId,
          commands: [
            syncCommandSchema.parse({ ...command, type: command.commandType }),
          ],
        },
        randomUUID(),
        other.authority.userId,
      );
      expect(result.results[0]?.status).toBe("REJECTED");
      expect(result.results[0]?.remoteEntity).toBeUndefined();
      const own = transport(f),
        legacy = await own.rawBootstrap.bootstrap(
          own.authority,
          bootstrapQuerySchema.parse({ copilotHistory: "true" }),
        );
      expect(legacy.entities.copilotExecutionLinks).toBeUndefined();
      const legacyPage = await own.rawPull.pull(
        f.storeId,
        syncPullQuerySchema.parse({ copilotHistory: "true" }),
        f.ownerId,
      );
      expect(
        legacyPage.changes.some(
          (c) => c.entityType === "copilot_execution_link",
        ),
      ).toBe(false);
      expect(
        (
          await readExecutionLinks(
            db,
            { storeId: f.storeId, ownerId: other.authority.userId },
            { recommendationId: null, afterId: null, limit: 5 },
          )
        ).entries,
      ).toEqual([]);
    }, 60000);
    it("rejects a forged association payload instead of writing through the immutable private card", async () => {
      const f = await seed(),
        state = await confirm(f),
        entity = state.link!;
      const forged = copilotExecutionLinkSchema.parse({
        ...entity,
        snapshot: {
          ...entity.snapshot,
          task: { ...entity.snapshot.task, note: "Fausse déclaration" },
        },
      });
      const result = await transport(f).rawPush.push(
        {
          syncProtocolVersion: 1,
          appVersion: "test",
          storeId: f.storeId,
          deviceId: f.deviceId,
          commands: [
            {
              commandId: randomUUID(),
              localSequence: 1,
              type: "COPILOT_EXECUTION_LINK_UPSERT",
              entityType: "copilot_execution_link",
              entityId: forged.id,
              expectedRemoteVersion: null,
              createdAt: forged.createdAt,
              payload: forged,
            },
          ],
        },
        randomUUID(),
        f.ownerId,
      );
      expect(result.results[0]?.status).toBe("REJECTED");
      expect(
        await db
          .collection("copilotExecutionLinks")
          .countDocuments({ storeId: f.storeId }),
      ).toBe(0);
    }, 60000);
    it("retains the exact historical versions when the remote choice/task changes after offline confirmation", async () => {
      const f = await seed();
      await confirm(f);
      const next = {
        ...f.decision,
        version: 2,
        updatedAt: "2026-10-18T12:00:20.000Z",
        revisions: [
          ...f.decision.revisions,
          {
            ...f.decision.revisions[0]!,
            type: "REJECT",
            modifiedAction: null,
            version: 2,
            decidedAt: "2026-10-18T12:00:20.000Z",
          },
        ],
      };
      await db
        .collection("copilotDecisions")
        .replaceOne(
          { _id: f.decision.id as never },
          { _id: f.decision.id as never, ...next },
        );
      await db.collection("commercialExecutionTasks").updateOne(
        { _id: f.business.task.id as never },
        {
          $set: {
            version: 2,
            status: "TODO",
            completedAt: null,
            updatedAt: "2026-10-18T12:00:20.000Z",
          },
        },
      );
      await sync(f).sync(f.storeId);
      const read = await readExecutionLinks(
        db,
        { storeId: f.storeId, ownerId: f.ownerId },
        { recommendationId: f.decision.id, afterId: null, limit: 5 },
      );
      expect(read.entries[0]?.snapshot.decision.version).toBe(1);
      expect(read.entries[0]?.snapshot.task.version).toBe(1);
      expect(read.evidence[0]?.value).toContain(
        "pas forcément des versions actuelles",
      );
      expect(
        (
          await db
            .collection("commercialExecutionTasks")
            .findOne({ _id: f.business.task.id as never })
        )?.version,
      ).toBe(2);
    }, 60000);
    it("coalesces two devices confirming the same card, retains the first confirmation timestamp and never reactivates a withdrawn link", async () => {
      const f = await seed();
      await confirm(f);
      const first = (
        await new OutboxRepository(f.db).listPending(f.storeId)
      )[0]!;
      await sync(f).sync(f.storeId);
      const original = copilotExecutionLinkSchema.parse(first.payload),
        duplicate = { ...original, createdAt: "2026-10-18T12:30:00.000Z" },
        push = transport(f).rawPush;
      const send = (
        payload: typeof original,
        expectedRemoteVersion: number | null,
      ) =>
        push.push(
          {
            syncProtocolVersion: 1,
            appVersion: "test",
            storeId: f.storeId,
            deviceId: randomUUID(),
            commands: [
              {
                commandId: randomUUID(),
                localSequence: 1,
                type: "COPILOT_EXECUTION_LINK_UPSERT",
                entityType: "copilot_execution_link",
                entityId: payload.id,
                expectedRemoteVersion,
                createdAt: payload.withdrawnAt ?? payload.createdAt,
                payload,
              },
            ],
          },
          randomUUID(),
          f.ownerId,
        );
      const r = await send(duplicate, null);
      expect(
        copilotExecutionLinkSchema.parse(r.results[0]?.remoteEntity).createdAt,
      ).toBe(original.createdAt);
      const withdrawal = {
        ...original,
        version: 2 as const,
        withdrawnAt: "2026-10-18T13:00:00.000Z",
      };
      expect((await send(withdrawal, 1)).results[0]?.status).toBe("APPLIED");
      expect(
        copilotExecutionLinkSchema.parse(
          (await send(duplicate, null)).results[0]?.remoteEntity,
        ).version,
      ).toBe(2);
    }, 60000);
    it("refuses exhausted capacity while preserving the unsynchronized local association", async () => {
      const f = await seed();
      await confirm(f);
      await db
        .collection<{
          _id: string;
          [key: string]: unknown;
        }>("copilotExecutionLinkCounters")
        .insertOne({
          _id: `${f.storeId}:${f.ownerId}`,
          storeId: f.storeId,
          ownerId: f.ownerId,
          count: 500,
        });
      await sync(f).sync(f.storeId);
      const s = await f.repository.open(f.linkCard);
      expect(s.status).toBe("ERROR");
      expect(s.link?.snapshot.decision.id).toBe(f.decision.id);
      expect(
        await db
          .collection("copilotExecutionLinks")
          .countDocuments({ storeId: f.storeId }),
      ).toBe(0);
    }, 60000);
    it("reads five-link pages with explicit withdrawn history, a stable UUID cursor and private owner boundaries", async () => {
      const f = await seed(),
        s = await confirm(f),
        e = s.link!;
      for (let i = 0; i < 6; i++) {
        const id = randomUUID();
        await db
          .collection<
            Document & {
              _id: string;
            }
          >("copilotExecutionLinks")
          .insertOne({
            _id: id,
            ...e,
            id,
            proposalMessageId: id,
            ...(i === 0
              ? { version: 2, withdrawnAt: "2026-10-18T13:00:00.000Z" }
              : {}),
          });
      }
      const scope = { storeId: f.storeId, ownerId: f.ownerId },
        first = await readExecutionLinks(db, scope, {
          recommendationId: f.decision.id,
          afterId: null,
          limit: 5,
        }),
        last = await readExecutionLinks(db, scope, {
          recommendationId: f.decision.id,
          afterId: first.nextAfterId,
          limit: 5,
        });
      expect(first.hasMore).toBe(true);
      expect(first.entries).toHaveLength(5);
      expect(last.hasMore).toBe(false);
      expect(last.entries).toHaveLength(1);
      expect(
        new Set([...first.entries, ...last.entries].map((e) => e.id)).size,
      ).toBe(6);
      expect(
        [...first.entries, ...last.entries].some((e) => e.version === 2),
      ).toBe(true);
      expect(
        (
          await readExecutionLinks(
            db,
            { storeId: randomUUID(), ownerId: f.ownerId },
            { recommendationId: null, afterId: null, limit: 5 },
          )
        ).entries,
      ).toEqual([]);
    }, 60000);
  },
);
