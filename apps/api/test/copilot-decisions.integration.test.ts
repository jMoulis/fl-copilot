import { randomUUID } from "node:crypto";
import { MongoClient, type Db, type Document } from "mongodb";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import {
  decisionFixture,
  decisionNativeFixture,
  saveDecision,
  decisionChoiceFixture,
  withoutMongoId,
} from "../../../scripts/test-copilot-decision-fixtures";
import { MercalysTestDatabase } from "../../../scripts/test-mercalys-sync-fixtures";
import { runLocalMigrations } from "../../mobile/src/db/migrations";
import { CopilotDecisionRepository } from "../../mobile/src/copilot/decision-repository";
import { decisionDigest } from "../../../scripts/test-copilot-decision-fixtures";
import { OutboxRepository } from "../../mobile/src/sync/outbox-repository";
import { MobileSyncService } from "../../mobile/src/sync/sync-service";
import { runMongoMigrations } from "../src/database/migrations";
import { createMongoSyncPushService } from "../src/sync/push-service";
import { createMongoSyncPullService } from "../src/sync/pull-service";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service";
import {
  bootstrapQuerySchema,
  syncPullQuerySchema,
  syncCommandSchema,
  type SyncPushRequest,
} from "@fl-copilot/sync-contracts";
import { runCopilotTurn } from "../src/copilot/turn-service";
import type { CopilotAiProvider } from "../src/copilot/ai-provider";
import {
  detectCopilotConflicts,
  scoreCopilotPriorities,
} from "@fl-copilot/analytics-core";
import { readRecommendationDecisions } from "../src/copilot/decision-read-tool";
import { readRecommendationTracking } from "../src/copilot/recommendation-tracking-tool";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "private recommendation decisions",
  () => {
    let client: MongoClient, db: Db;
    beforeAll(async () => {
      client = await MongoClient.connect(uri!);
      db = client.db(
        `fl_decisions_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
      );
      await runMongoMigrations(db);
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
    async function seed(f = decisionFixture(), includeCard = true) {
      await db
        .collection<Document & { _id: string }>("copilotConversations")
        .insertOne({ _id: f.conversation.id, ...f.conversation });
      for (const m of [
        f.message,
        f.source,
        f.request,
        ...(includeCard ? [f.assistant, f.card] : []),
      ])
        await db
          .collection<Document & { _id: string }>("copilotMessages")
          .insertOne({ _id: m.id, ...m });
      return f;
    }
    function transport(
      f: ReturnType<typeof decisionFixture>,
      ownerId = f.ownerId,
    ) {
      const push = createMongoSyncPushService(service()),
        pull = createMongoSyncPullService(service()),
        boot = createMongoSyncBootstrapService(service()),
        q = { copilotHistory: "true", copilotDecisions: "true" };
      const authority = {
        storeId: f.storeId,
        userId: ownerId,
        sessionId: randomUUID(),
        deviceId: f.deviceId,
        storeName: "Pilote",
        role: "MANAGER" as const,
      };
      return {
        push: (r: SyncPushRequest) => push.push(r, randomUUID(), ownerId),
        pull: (id: string, cursor: string) =>
          pull.pull(id, syncPullQuerySchema.parse({ ...q, cursor }), ownerId),
        bootstrap: () =>
          boot.bootstrap(authority, bootstrapQuerySchema.parse(q)),
        rawPush: push,
        rawPull: pull,
        rawBoot: boot,
        authority,
      };
    }
    function sync(
      f: ReturnType<typeof decisionFixture>,
      device: MercalysTestDatabase,
    ) {
      return new MobileSyncService(device, transport(f), {
        appVersion: "test",
        deviceId: f.deviceId,
        copilotHistory: true,
        copilotDecisions: true,
        copilotOwnerId: f.ownerId,
      });
    }
    it("creates a tracking card atomically from an owned earlier advice and replays the private reply once", async () => {
      const f = await seed(decisionFixture(), false),
        preview = await readRecommendationTracking(
          db,
          {
            storeId: f.storeId,
            ownerId: f.ownerId,
            conversationId: f.conversation.id,
          },
          f.input,
        );
      const generate = vi.fn(async () => ({
        output: {
          language: "fr-FR",
          summary: "Le suivi est préparé.",
          facts: preview.evidence.map((e) => ({ evidenceId: e.id })),
          interpretation: [],
          recommendations: [],
          questions: [],
        },
        metadata: {
          requestedModel: "test",
          resolvedModel: "test",
          responseId: "tracking-test",
          inputTokens: null,
          outputTokens: null,
        },
        toolEvidence: preview.evidence,
        recommendationTrackingPreviews: [preview],
      }));
      const dependencies = {
        db,
        provider: { model: "test", generate } as CopilotAiProvider,
        authorize: async () => ({
          storeId: f.storeId,
          ownerId: f.ownerId,
          canRespond: true,
        }),
        loadContext: async () =>
          detectCopilotConflicts({
            batch: scoreCopilotPriorities({
              storeId: f.storeId,
              evaluatedAt: f.assistant.createdAt,
              candidates: [],
            }),
            intents: [],
          }),
        now: () => new Date(f.assistant.createdAt),
      };
      const turn = {
        conversationId: f.conversation.id,
        userMessageId: f.request.id,
        replyId: f.assistant.id,
      };
      await runCopilotTurn(dependencies, turn);
      expect((await runCopilotTurn(dependencies, turn)).alreadyApplied).toBe(
        true,
      );
      expect(generate).toHaveBeenCalledOnce();
      const cards = await db
        .collection("copilotMessages")
        .find({ conversationId: f.conversation.id, role: "TOOL" })
        .toArray();
      expect(cards).toHaveLength(1);
      expect(withoutMongoId(cards[0]!)).toEqual(f.card);
      expect(
        await db
          .collection("copilotDecisions")
          .countDocuments({ storeId: f.storeId }),
      ).toBe(0);
    });
    it("synchronizes an offline choice once, restores it on another device and isolates old clients/foreign owners", async () => {
      const f = await seed(),
        a = await decisionNativeFixture(f),
        b = new MercalysTestDatabase();
      try {
        await runLocalMigrations(b);
        const saved = (await saveDecision(a, "ACCEPT")).decision!,
          pending = (
            await new OutboxRepository(a.db).listPending(f.storeId)
          )[0]!;
        await sync(f, a.db).sync(f.storeId);
        expect((await a.repo.open(f.card)).syncState).toBe("SYNCED");
        const push = transport(f).rawPush;
        const replay = await push.push(
          {
            syncProtocolVersion: 1,
            appVersion: "test",
            deviceId: f.deviceId,
            storeId: f.storeId,
            commands: [
              syncCommandSchema.parse({
                ...pending,
                type: pending.commandType,
              }),
            ],
          },
          randomUUID(),
          f.ownerId,
        );
        expect(replay.results[0]?.status).toBe("ALREADY_APPLIED");
        await sync(f, b).sync(f.storeId);
        const other = new CopilotDecisionRepository(
          b,
          a.scope,
          decisionDigest,
          randomUUID,
        );
        expect((await other.open(f.card)).decision).toEqual(saved);
        const t = transport(f);
        expect(
          (
            await t.rawBoot.bootstrap(
              t.authority,
              bootstrapQuerySchema.parse({ copilotHistory: "true" }),
            )
          ).entities.copilotDecisions,
        ).toBeUndefined();
        expect(
          (
            await t.rawPull.pull(
              f.storeId,
              syncPullQuerySchema.parse({ copilotHistory: "true" }),
              f.ownerId,
            )
          ).changes.some((c) => c.entityType === "copilot_decision"),
        ).toBe(false);
        const foreign = transport(f, randomUUID());
        expect((await foreign.bootstrap()).entities.copilotDecisions).toEqual(
          [],
        );
        expect(
          (
            await foreign.rawPull.pull(
              f.storeId,
              syncPullQuerySchema.parse({
                copilotHistory: "true",
                copilotDecisions: "true",
              }),
              foreign.authority.userId,
            )
          ).changes.some((c) => c.entityType === "copilot_decision"),
        ).toBe(false);
        const denied = await push.push(
          {
            syncProtocolVersion: 1,
            appVersion: "test",
            deviceId: f.deviceId,
            storeId: f.storeId,
            commands: [
              syncCommandSchema.parse({
                ...pending,
                type: pending.commandType,
              }),
            ],
          },
          randomUUID(),
          randomUUID(),
        );
        expect(denied.results[0]?.status).toBe("REJECTED");
        expect(denied.results[0]?.remoteEntity).toBeUndefined();
        expect(
          await db
            .collection("copilotDecisions")
            .countDocuments({ storeId: f.storeId }),
        ).toBe(1);
        expect(
          await db
            .collection("commercialExecutionTasks")
            .countDocuments({ storeId: f.storeId }),
        ).toBe(0);
      } finally {
        a.db.db.close();
        b.db.close();
      }
    });
    it.each([true, false])(
      "requires explicit resolution of two-device contradictory choices (local=%s)",
      async (useLocal) => {
        const f = await seed(),
          a = await decisionNativeFixture(f),
          b = await decisionNativeFixture(f);
        try {
          await saveDecision(a, "ACCEPT");
          await saveDecision(b, "REJECT");
          await sync(f, a.db).sync(f.storeId);
          await sync(f, b.db).sync(f.storeId);
          const compared = await b.repo.open(f.card);
          expect(compared.status).toBe("CONFLICT");
          expect(compared.decision?.revisions.at(-1)?.type).toBe("REJECT");
          expect(compared.remote?.revisions.at(-1)?.type).toBe("ACCEPT");
          await b.repo.resolve(f.card, useLocal, compared.review);
          await sync(f, b.db).sync(f.storeId);
          await sync(f, a.db).sync(f.storeId);
          expect(
            (await a.repo.open(f.card)).decision?.revisions.map((r) => r.type),
          ).toEqual(useLocal ? ["ACCEPT", "REJECT"] : ["ACCEPT"]);
        } finally {
          a.db.db.close();
          b.db.db.close();
        }
      },
    );
    it.each(["HISTORY", "DIGEST", "HIDDEN", "PAST_DATE"])(
      "rejects forged/revoked decision context without changing any existing history (%s)",
      async (mode) => {
        const f = await seed(),
          native = await decisionNativeFixture(f);
        try {
          await saveDecision(native, "ACCEPT");
          await sync(f, native.db).sync(f.storeId);
          await saveDecision(native, "MODIFY");
          const c = (
            await new OutboxRepository(native.db).listPending(f.storeId)
          )[0]!;
          if (typeof c.payload !== "object" || !c.payload)
            throw Error("Invalid fixture");
          const payload = c.payload as Record<string, unknown>;
          if (mode === "DIGEST") payload.proposalDigest = "0".repeat(64);
          if (mode === "HISTORY")
            (payload.revisions as Array<Record<string, unknown>>)[0]!.type =
              "REJECT";
          if (mode === "HIDDEN")
            await db
              .collection<Document & { _id: string }>("copilotConversations")
              .updateOne(
                { _id: f.conversation.id },
                { $set: { deletedMessageIds: [f.source.id] } },
              );
          if (mode === "PAST_DATE")
            Object.assign(
              (payload.revisions as Array<Record<string, unknown>>).at(-1)!,
              {
                ...decisionChoiceFixture("POSTPONE"),
                postponeUntil: "2026-10-01",
              },
            );
          const r = await transport(f).push({
            syncProtocolVersion: 1,
            appVersion: "test",
            deviceId: f.deviceId,
            storeId: f.storeId,
            commands: [syncCommandSchema.parse({ ...c, type: c.commandType })],
          });
          expect(r.results[0]?.status).toBe("REJECTED");
          expect(
            (
              await db
                .collection("copilotDecisions")
                .findOne({ _id: f.recommendationId as never })
            )?.version,
          ).toBe(1);
        } finally {
          native.db.db.close();
        }
      },
    );
    it("lets the copilot inspect saved choices with source qualifications, explicit pages and owner isolation", async () => {
      const f = await seed(),
        native = await decisionNativeFixture(f);
      try {
        await saveDecision(native, "MODIFY");
        await sync(f, native.db).sync(f.storeId);
        const input = {
          conversationId: f.conversation.id,
          recommendationId: null,
          afterId: null,
          limit: 1,
        };
        const r = await readRecommendationDecisions(
          db,
          { storeId: f.storeId, ownerId: f.ownerId },
          input,
        );
        expect(r.entries[0]).toMatchObject({
          id: f.recommendationId,
          latest: { type: "MODIFY" },
          basis: { quote: f.input.quote },
          sourceState: "ACTIVE",
          historyCount: 1,
        });
        expect(r.evidence[0]?.value).toContain("pas preuve d’exécution");
        expect(
          (
            await readRecommendationDecisions(
              db,
              { storeId: f.storeId, ownerId: randomUUID() },
              input,
            )
          ).status,
        ).toBe("CONVERSATION_UNAVAILABLE");
        const global = await readRecommendationDecisions(
          db,
          { storeId: f.storeId, ownerId: f.ownerId },
          { ...input, conversationId: null },
        );
        expect(global.entries.map((e) => e.id)).toEqual([f.recommendationId]);
        const next = await readRecommendationDecisions(
          db,
          { storeId: f.storeId, ownerId: f.ownerId },
          { ...input, afterId: f.recommendationId },
        );
        expect(next.entries).toEqual([]);
        await db
          .collection<Document & { _id: string }>("copilotConversations")
          .updateOne(
            { _id: f.conversation.id },
            { $set: { status: "ARCHIVED" } },
          );
        expect(
          (
            await readRecommendationDecisions(
              db,
              { storeId: f.storeId, ownerId: f.ownerId },
              input,
            )
          ).entries[0]?.sourceState,
        ).toBe("INACTIVE_SOURCE");
      } finally {
        native.db.db.close();
      }
    });
    it("retains a pending local choice when the bounded remote journal has reached capacity", async () => {
      const f = await seed(),
        native = await decisionNativeFixture(f);
      try {
        await saveDecision(native, "ACCEPT");
        await db
          .collection<Document & { _id: string }>("copilotDecisionCounters")
          .insertOne({
            _id: `${f.storeId}:${f.ownerId}`,
            storeId: f.storeId,
            ownerId: f.ownerId,
            count: 500,
          });
        const command = (
          await new OutboxRepository(native.db).listPending(f.storeId)
        )[0]!;
        const result = await transport(f).push({
          syncProtocolVersion: 1,
          appVersion: "test",
          deviceId: f.deviceId,
          storeId: f.storeId,
          commands: [
            syncCommandSchema.parse({ ...command, type: command.commandType }),
          ],
        });
        expect(result.results[0]?.status).toBe("REJECTED");
        expect(result.results[0]?.error?.code).toBe("COPILOT_DECISION_LIMIT");
        expect(
          (await native.repo.open(f.card)).decision?.revisions.at(-1)?.type,
        ).toBe("ACCEPT");
        expect(
          await db
            .collection("copilotDecisions")
            .countDocuments({ storeId: f.storeId }),
        ).toBe(0);
      } finally {
        native.db.db.close();
      }
    });
  },
);
