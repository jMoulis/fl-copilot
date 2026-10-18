import { nativeNeedConflictFixture } from "../../../scripts/test-need-conflict-fixtures";
import { applyNeedUnit } from "../../mobile/src/needs/repository";
import { applyNeedMembership } from "../../mobile/src/needs/membership-repository";
import { applyProductSubstitution } from "../../mobile/src/needs/substitution-repository";
import { applyNeedUnitCommand } from "../src/need-unit-sync";
import { applyNeedMembershipCommand } from "../src/need-membership-sync";
import { applyProductSubstitutionCommand } from "../src/product-substitution-sync";
import { DatabaseSync } from "node:sqlite";
import { ReceiptTestDatabase } from "../../../scripts/test-receipt-publication-sqlite";
import { runLocalMigrations } from "../../mobile/src/db/migrations";
import { applyStoreProductEvent } from "../../mobile/src/needs/store-event-repository";
import { applyStoreContext } from "../../mobile/src/store/context-repository";
import { randomUUID } from "node:crypto";
import { MongoClient, type Db, type Document } from "mongodb";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import {
  copilotMessageSchema,
  readStoreConflictProposal,
} from "@fl-copilot/domain";
import {
  detectCopilotConflicts,
  scoreCopilotPriorities,
} from "@fl-copilot/analytics-core";
import { syncCommandSchema } from "@fl-copilot/sync-contracts";
import { nativeStoreConflictFixture } from "../../../scripts/test-store-conflict-fixtures";
import { storeContextFixture } from "../../../scripts/test-store-context-fixtures";
import { runMongoMigrations } from "../src/database/migrations";
import { previewStoreConflict } from "../src/copilot/store-conflict-tool";
import { runCopilotTurn } from "../src/copilot/turn-service";
import type { CopilotAiProvider } from "../src/copilot/ai-provider";
import { applyCopilotRecord } from "../../mobile/src/copilot/conversation-repository";
import { OutboxRepository } from "../../mobile/src/sync/outbox-repository";
import { applyStoreContextCommand } from "../src/store-context-sync";
import { applyStoreProductEventCommand } from "../src/store-product-event-sync";
import { createMongoSyncChangeService } from "../src/sync/sync-change-service";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)(
  "reviewed store conflicts on disposable Atlas and actual SQLite",
  () => {
    let client: MongoClient, db: Db;
    const collection = (name: string) =>
      db.collection<Document & { _id: string }>(name);
    beforeAll(async () => {
      client = await MongoClient.connect(uri!);
      db = client.db(
        `fl_store_conflict_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
      );
      await runMongoMigrations(db);
    });
    afterAll(async () => {
      try {
        await db?.dropDatabase();
      } finally {
        await client?.close();
      }
    });
    it("reads settings without exposing the stored device point and rejects foreign scope", async () => {
      const settings = {
        ...storeContextFixture(),
        locationMode: "POINT",
        position: {
          latitude: 48.91,
          longitude: 2.29,
          capturedAt: "2026-10-09T08:00:00.000Z",
          source: "DEVICE",
        },
      };
      await collection("storeContextSettings").insertOne({
        _id: settings.id,
        ...settings,
      });
      const result = await previewStoreConflict(db, settings.storeId, {
        kind: "SETTINGS",
        entityId: null,
      });
      expect(result.basis.settings?.locationMode).toBe("POINT");
      expect(JSON.stringify(result)).not.toMatch(
        /latitude|longitude|48\.91|2\.29|capturedAt/,
      );
      await expect(
        previewStoreConflict(db, randomUUID(), {
          kind: "SETTINGS",
          entityId: null,
        }),
      ).rejects.toThrow("UNAVAILABLE");
      expect(
        await collection("syncChanges").countDocuments({
          storeId: settings.storeId,
        }),
      ).toBe(0);
    });
    it.skipIf(process.env.TEST_MONGODB_TRANSACTIONS !== "true").each([
      ["FIELD_EVENT", "KEEP_LOCAL", "AI"],
      ["FIELD_EVENT", "ADOPT_REMOTE", "AI"],
      ["SETTINGS", "KEEP_LOCAL", "AI"],
      ["SETTINGS", "ADOPT_REMOTE", "FALLBACK"],
      ["SETTINGS", "KEEP_LOCAL", "FOREIGN"],
      ["NEED", "KEEP_LOCAL", "AI"],
      ["NEED", "ADOPT_REMOTE", "AI"],
      ["MEMBERSHIP", "KEEP_LOCAL", "AI"],
      ["MEMBERSHIP", "ADOPT_REMOTE", "AI"],
      ["SUBSTITUTION", "KEEP_LOCAL", "AI"],
      ["SUBSTITUTION", "ADOPT_REMOTE", "FALLBACK"],
      ["MEMBERSHIP", "KEEP_LOCAL", "FOREIGN"],
      ["MEMBERSHIP", "KEEP_LOCAL", "REACTIVATION"],
      ["SUBSTITUTION", "KEEP_LOCAL", "REACTIVATION"],
    ] as const)(
      "commits the private comparison then resolves and syncs canonically (%s/%s/%s)",
      async (kind, decision, mode) => {
        const s =
            kind === "NEED" || kind === "MEMBERSHIP" || kind === "SUBSTITUTION"
              ? await nativeNeedConflictFixture(
                  kind,
                  ":memory:",
                  mode === "REACTIVATION" ? "REMOTE" : undefined,
                )
              : await nativeStoreConflictFixture(kind),
          r = s.review,
          chat = s.f.chat,
          session = client.startSession();
        try {
          const name = {
            FIELD_EVENT: "storeProductEvents",
            SETTINGS: "storeContextSettings",
            NEED: "needUnits",
            MEMBERSHIP: "needMemberships",
            SUBSTITUTION: "productSubstitutions",
          }[kind];
          await collection(name).insertOne({ _id: r.remote.id, ...r.remote });
          await collection("products").insertOne({
            _id: s.product.id,
            ...("product" in r ? r.product : s.product),
          });
          if ("need" in r) {
            await collection("products").insertOne({
              _id: r.substitute.id,
              ...r.substitute,
            });
            if (kind !== "NEED")
              await collection("needUnits").insertOne({
                _id: r.need.id,
                ...r.need,
              });
          }
          await collection("copilotConversations").insertOne({
            _id: chat.conversation.id,
            ...chat.conversation,
          });
          await collection("copilotMessages").insertOne({
            _id: chat.message.id,
            ...chat.message,
          });
          const preview = await previewStoreConflict(
            db,
            chat.storeId,
            r.preview.input,
          );
          if (mode === "FOREIGN") preview.basis.storeId = randomUUID();
          const generate = vi.fn(async () => ({
            output: {
              language: "fr-FR" as const,
              summary:
                "La comparaison est prête. Aucune version n’est retenue.",
              facts: [
                {
                  evidenceId:
                    mode === "FALLBACK"
                      ? "unknown-evidence"
                      : preview.evidence[0]!.id,
                },
              ],
              interpretation: [],
              recommendations: [],
              questions: [],
            },
            metadata: {
              requestedModel: "test",
              resolvedModel: "test",
              responseId: "test",
              inputTokens: null,
              outputTokens: null,
            },
            toolEvidence: preview.evidence,
            storeConflictPreviews: [preview],
          }));
          const deps = {
              db,
              provider: { model: "test", generate } as CopilotAiProvider,
              authorize: async () => ({
                storeId: chat.storeId,
                ownerId: chat.ownerId,
                canRespond: true,
              }),
              loadContext: async () =>
                detectCopilotConflicts({
                  batch: scoreCopilotPriorities({
                    storeId: chat.storeId,
                    evaluatedAt: chat.message.createdAt,
                    candidates: [],
                  }),
                  intents: [],
                }),
            },
            turn = {
              conversationId: chat.conversation.id,
              userMessageId: chat.message.id,
              replyId: randomUUID(),
            };
          if (mode === "FOREIGN") {
            await expect(runCopilotTurn(deps, turn)).rejects.toThrow();
            expect(
              await collection("copilotMessages").countDocuments({
                conversationId: chat.conversation.id,
                role: { $in: ["ASSISTANT", "TOOL"] },
              }),
            ).toBe(0);
            return;
          }
          await runCopilotTurn(deps, turn);
          const rows = await collection("copilotMessages")
              .find({
                conversationId: chat.conversation.id,
                role: { $in: ["ASSISTANT", "TOOL"] },
              })
              .toArray(),
            messages = rows.map(({ _id, ...m }) => {
              void _id;
              return copilotMessageSchema.parse(m);
            });
          expect(messages).toHaveLength(2);
          const card = messages.find((m) => m.role === "TOOL")!;
          expect(readStoreConflictProposal(card).content.basis).toEqual(
            preview.basis,
          );
          await s.a.withExclusiveTransactionAsync(async (tx) => {
            for (const m of messages)
              await applyCopilotRecord(tx, chat, "copilot_message", m);
          });
          const state = await r.controller.open(card);
          expect(state.status).toBe("READY");
          if (mode === "REACTIVATION") {
            await expect(
              r.controller.confirm(
                card,
                state.review!.basisHash,
                decision,
                true,
              ),
            ).rejects.toThrow();
            expect(s.count("copilot_tool_results")).toBe(0);
          }
          expect(
            (
              await r.controller.confirm(
                card,
                state.review!.basisHash,
                decision,
                true,
                undefined,
                mode === "REACTIVATION",
              )
            ).status,
          ).toBe("COMPLETED");
          expect(
            (
              await r.controller.confirm(
                card,
                state.review!.basisHash,
                decision,
                true,
                undefined,
                mode === "REACTIVATION",
              )
            ).status,
          ).toBe("COMPLETED");
          const commands = (
            await new OutboxRepository(s.a).listPending(chat.storeId)
          ).filter((c) => c.entityType === r.entityType);
          expect(commands).toHaveLength(decision === "KEEP_LOCAL" ? 1 : 0);
          for (const command of commands) {
            const wire = syncCommandSchema.parse({
              commandId: command.commandId,
              localSequence: command.localSequence,
              type: command.commandType,
              entityType: command.entityType,
              entityId: command.entityId,
              expectedRemoteVersion: command.expectedRemoteVersion,
              payload: command.payload,
              createdAt: command.createdAt,
            });
            await session.withTransaction(async () => {
              const apply = {
                FIELD_EVENT: applyStoreProductEventCommand,
                SETTINGS: applyStoreContextCommand,
                NEED: applyNeedUnitCommand,
                MEMBERSHIP: applyNeedMembershipCommand,
                SUBSTITUTION: applyProductSubstitutionCommand,
              }[kind];
              const result = await apply(
                { database: db, session },
                chat.storeId,
                wire,
                randomUUID(),
                createMongoSyncChangeService(),
              );
              expect(result.resultStatus).toBe("APPLIED");
            });
          }
          expect(
            (await collection(name).findOne({ _id: r.remote.id }))!.version,
          ).toBe(decision === "KEEP_LOCAL" ? 3 : 2);
          const restored = new DatabaseSync(":memory:"),
            adapter = new ReceiptTestDatabase(restored);
          try {
            await runLocalMigrations(adapter);
            const saved = await collection(name).findOne({ _id: r.remote.id });
            const { _id, ...payload } = saved!;
            void _id;
            const apply = {
              FIELD_EVENT: applyStoreProductEvent,
              SETTINGS: applyStoreContext,
              NEED: applyNeedUnit,
              MEMBERSHIP: applyNeedMembership,
              SUBSTITUTION: applyProductSubstitution,
            }[kind];
            await apply(adapter, chat.storeId, payload);
            const table = {
              FIELD_EVENT: "store_product_events",
              SETTINGS: "store_context_settings",
              NEED: "need_units",
              MEMBERSHIP: "need_memberships",
              SUBSTITUTION: "product_substitutions",
            }[kind];
            expect(
              restored
                .prepare(`SELECT id,store_id,sync_state FROM ${table}`)
                .get(),
            ).toMatchObject({
              id: r.remote.id,
              store_id: chat.storeId,
              sync_state: "SYNCED",
            });
            if (kind === "SUBSTITUTION")
              expect(payload).toMatchObject({
                evidenceCount: 4,
                relationshipScore: 0.7,
                confidence: 0.8,
              });
            expect(
              restored.prepare("SELECT COUNT(*) n FROM sync_outbox").get()!.n,
            ).toBe(0);
          } finally {
            restored.close();
          }
          expect((await runCopilotTurn(deps, turn)).alreadyApplied).toBe(true);
          expect(generate).toHaveBeenCalledOnce();
          for (const name of ["salesObservations", "wasteObservations"])
            expect(
              await collection(name).countDocuments({ storeId: chat.storeId }),
            ).toBe(0);
        } finally {
          s.db.close();
          await session.endSession();
        }
      },
    );
  },
);
