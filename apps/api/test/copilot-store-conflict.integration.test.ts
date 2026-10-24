import { createMongoSyncPullService } from "../src/sync/pull-service";
import { nativeCatalogueConflictFixture } from "../../../scripts/test-catalogue-conflict-fixtures";
import {
  isCatalogueConflictKind,
  catalogueConflictSchemas,
} from "@fl-copilot/domain";
import {
  applyProductMasterCommand,
  serializeProductMasterDocument,
} from "../src/products/product-master";
import { applyProductMasterChange } from "../../mobile/src/products/apply-product-master";
import { nativeCommercialDecisionConflictFixture } from "../../../scripts/test-commercial-decision-conflict-fixtures";
import { applyCommercialVersionDecision } from "../../mobile/src/commercial/version-decision-repository";
import { applyCommercialExecution } from "../../mobile/src/commercial/execution-repository";
import { applyCommercialVersionDecisionCommand } from "../src/commercial/version-decision-sync";
import { applyCommercialExecutionCommand } from "../src/commercial/execution-sync";
import { nativeCommercialConflictFixture } from "../../../scripts/test-commercial-conflict-fixtures";
import { applyCommercialChoice } from "../../mobile/src/commercial/offer-choice-repository";
import { applyCommercialPreparation } from "../../mobile/src/commercial/week-preparation-repository";
import { applyCommercialPlan } from "../../mobile/src/commercial/week-plan-repository";
import { applyCommercialChoiceCommand } from "../src/commercial/offer-choice-sync";
import { applyCommercialPreparationCommand } from "../src/commercial/week-preparation-sync";
import { applyCommercialPlanCommand } from "../src/commercial/week-plan-sync";
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
import {
  syncCommandSchema,
  syncPullQuerySchema,
  syncPushRequestSchema,
} from "@fl-copilot/sync-contracts";
import { createMongoSyncPushService } from "../src/sync/push-service";
import { ConflictRepository } from "../../mobile/src/sync/conflict-repository";
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
      ["FIELD_EVENT", "KEEP_LOCAL", "GROUP"],
      ["FIELD_EVENT", "ADOPT_REMOTE", "GROUP"],
      ["SETTINGS", "KEEP_LOCAL", "AI"],
      ["SETTINGS", "ADOPT_REMOTE", "FALLBACK"],
      ["SETTINGS", "KEEP_LOCAL", "GROUP"],
      ["SETTINGS", "ADOPT_REMOTE", "GROUP"],
      ["SETTINGS", "KEEP_LOCAL", "FOREIGN"],
      ["PRODUCT", "KEEP_LOCAL", "GROUP"],
      ["PRODUCT", "ADOPT_REMOTE", "GROUP"],
      ["IDENTIFIER", "KEEP_LOCAL", "GROUP"],
      ["IDENTIFIER", "ADOPT_REMOTE", "GROUP"],
      ["ALIAS", "KEEP_LOCAL", "GROUP"],
      ["ALIAS", "ADOPT_REMOTE", "GROUP"],
      ["PRODUCT", "KEEP_LOCAL", "AI"],
      ["PRODUCT", "ADOPT_REMOTE", "AI"],
      ["IDENTIFIER", "KEEP_LOCAL", "AI"],
      ["IDENTIFIER", "ADOPT_REMOTE", "AI"],
      ["ALIAS", "KEEP_LOCAL", "AI"],
      ["ALIAS", "ADOPT_REMOTE", "FALLBACK"],
      ["PRODUCT", "ADOPT_REMOTE", "DELETION"],
      ["IDENTIFIER", "ADOPT_REMOTE", "DELETION"],
      ["ALIAS", "ADOPT_REMOTE", "DELETION"],
      ["PRODUCT", "KEEP_LOCAL", "LOCAL_DELETION"],
      ["PRODUCT", "ADOPT_REMOTE", "LOCAL_DELETION"],
      ["IDENTIFIER", "KEEP_LOCAL", "LOCAL_DELETION"],
      ["IDENTIFIER", "ADOPT_REMOTE", "LOCAL_DELETION"],
      ["ALIAS", "KEEP_LOCAL", "LOCAL_DELETION"],
      ["ALIAS", "ADOPT_REMOTE", "LOCAL_DELETION"],
      ["PRODUCT", "KEEP_LOCAL", "FOREIGN"],
      ["ALIAS", "KEEP_LOCAL", "FOREIGN"],
      ["ALIAS", "KEEP_LOCAL", "REACTIVATION"],
      ["PRODUCT", "KEEP_LOCAL", "REACTIVATION"],
      ["COMMERCIAL_REFERENCE", "KEEP_LOCAL", "AI"],
      ["COMMERCIAL_REFERENCE", "ADOPT_REMOTE", "FALLBACK"],
      ["COMMERCIAL_REFERENCE", "KEEP_LOCAL", "REVERSED"],
      ["COMMERCIAL_REFERENCE", "KEEP_LOCAL", "FOREIGN"],
      ["COMMERCIAL_EXECUTION", "KEEP_LOCAL", "AI"],
      ["COMMERCIAL_EXECUTION", "ADOPT_REMOTE", "AI"],
      ["COMMERCIAL_EXECUTION", "KEEP_LOCAL", "FOREIGN"],
      ["COMMERCIAL_CHOICE", "KEEP_LOCAL", "AI"],
      ["COMMERCIAL_CHOICE", "ADOPT_REMOTE", "AI"],
      ["COMMERCIAL_PREPARATION", "KEEP_LOCAL", "AI"],
      ["COMMERCIAL_PREPARATION", "ADOPT_REMOTE", "AI"],
      ["COMMERCIAL_PLAN", "KEEP_LOCAL", "AI"],
      ["COMMERCIAL_PLAN", "ADOPT_REMOTE", "FALLBACK"],
      ["COMMERCIAL_PLAN", "KEEP_LOCAL", "FOREIGN"],
      ["NEED", "KEEP_LOCAL", "GROUP"],
      ["NEED", "ADOPT_REMOTE", "GROUP"],
      ["MEMBERSHIP", "KEEP_LOCAL", "GROUP"],
      ["MEMBERSHIP", "ADOPT_REMOTE", "GROUP"],
      ["SUBSTITUTION", "KEEP_LOCAL", "GROUP"],
      ["SUBSTITUTION", "ADOPT_REMOTE", "GROUP"],
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
        const s = isCatalogueConflictKind(kind)
            ? await nativeCatalogueConflictFixture(
                kind,
                ":memory:",
                mode === "REACTIVATION" ? "REMOTE" : undefined,
                mode === "DELETION",
                mode === "LOCAL_DELETION",
              )
            : kind === "COMMERCIAL_REFERENCE" || kind === "COMMERCIAL_EXECUTION"
              ? await nativeCommercialDecisionConflictFixture(
                  kind,
                  ":memory:",
                  mode === "REVERSED",
                )
              : kind === "COMMERCIAL_CHOICE" ||
                  kind === "COMMERCIAL_PREPARATION" ||
                  kind === "COMMERCIAL_PLAN"
                ? await nativeCommercialConflictFixture(kind)
                : kind === "NEED" ||
                    kind === "MEMBERSHIP" ||
                    kind === "SUBSTITUTION"
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
            PRODUCT: "products",
            IDENTIFIER: "productIdentifiers",
            ALIAS: "productAliases",
            COMMERCIAL_REFERENCE: "commercialVersionDecisions",
            COMMERCIAL_EXECUTION: "commercialExecutionTasks",
            COMMERCIAL_CHOICE: "commercialOfferChoices",
            COMMERCIAL_PREPARATION: "commercialWeekPreparations",
            COMMERCIAL_PLAN: "commercialWeekPlans",
            FIELD_EVENT: "storeProductEvents",
            SETTINGS: "storeContextSettings",
            NEED: "needUnits",
            MEMBERSHIP: "needMemberships",
            SUBSTITUTION: "productSubstitutions",
          }[kind];
          const mongoCatalogue = (entity: {
            id: string;
            createdAt: string;
            updatedAt: string;
            deletedAt?: string | null;
          }) => {
            const { id, ...rest } = entity;
            return {
              ...rest,
              _id: id,
              schemaVersion: 1,
              createdAt: new Date(entity.createdAt),
              updatedAt: new Date(entity.updatedAt),
              deletedAt: entity.deletedAt ? new Date(entity.deletedAt) : null,
            };
          };
          await collection(name).insertOne(
            isCatalogueConflictKind(kind)
              ? mongoCatalogue(r.remote)
              : { _id: r.remote.id, ...r.remote },
          );
          if (kind !== "PRODUCT")
            await collection("products").insertOne(
              isCatalogueConflictKind(kind) && "product" in r
                ? mongoCatalogue(r.product)
                : {
                    _id: s.product.id,
                    ...("product" in r ? r.product : s.product),
                  },
            );
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
          if ("fixture" in r) {
            const f = r.fixture,
              { id: productId, ...product } = f.product;
            await collection("products").insertOne({
              ...product,
              _id: productId,
              createdAt: new Date(f.product.createdAt),
              updatedAt: new Date(f.product.updatedAt),
            });
            const parents = [
              ["commercialVisualReadings", f.reading],
              ["commercialValidatedOffers", f.validated],
              ...(kind === "COMMERCIAL_CHOICE"
                ? []
                : [["commercialOfferChoices", f.choice]]),
              ...(kind === "COMMERCIAL_PREPARATION"
                ? []
                : [["commercialWeekPreparations", f.preparation]]),
            ] as const;
            for (const [parentName, value] of parents) {
              const entity = value as { id: string };
              await collection(parentName as string).insertOne({
                ...entity,
                _id: entity.id,
              });
            }
          }
          if ("other" in r) {
            await collection("commercialVisualReadings").insertOne({
              ...r.other.reading,
              _id: r.other.reading.id,
            });
            await collection("commercialPlanRevisions").insertOne({
              _id: r.fixture.plan.revisionId,
              id: r.fixture.plan.revisionId,
              storeId: chat.storeId,
              plan: r.fixture.plan,
              version: 1,
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
          if (mode === "DELETION" || mode === "LOCAL_DELETION") {
            // Exercise the real server conflict serializer before reviewing the deletion locally.
            const response = await createMongoSyncPushService({
              getDb: async () => db,
              close: async () => {},
              checkHealth: async () => "connected",
            }).push(
              syncPushRequestSchema.parse({
                syncProtocolVersion: 1,
                appVersion: "test",
                deviceId: s.scope.deviceId,
                storeId: chat.storeId,
                commands: [
                  {
                    commandId: r.command.commandId,
                    localSequence: r.command.localSequence,
                    type: r.command.commandType,
                    entityType: r.command.entityType,
                    entityId: r.command.entityId,
                    expectedRemoteVersion: r.command.expectedRemoteVersion,
                    createdAt: r.command.createdAt,
                    payload: r.command.payload,
                  },
                ],
              }),
              randomUUID(),
            );
            expect(response.results[0]).toMatchObject({
              status: "CONFLICT",
              remoteVersion: 2,
              remoteEntity: {
                deletedAt:
                  mode === "DELETION" ? "2026-10-20T18:00:00.000Z" : null,
              },
            });
            await s.a.runAsync(
              "DELETE FROM sync_conflicts WHERE id=?",
              r.conflict.id,
            );
            await new ConflictRepository(s.a).recordPushConflict(
              r.command,
              response.results[0]!,
            );
          }
          if (mode === "GROUP") {
            const command = await new OutboxRepository(s.a).enqueue({
              ...r.command,
              commandId: randomUUID(),
            });
            const response = await createMongoSyncPushService({
              getDb: async () => db,
              close: async () => {},
              checkHealth: async () => "connected",
            }).push(
              syncPushRequestSchema.parse({
                syncProtocolVersion: 1,
                appVersion: "test",
                deviceId: s.scope.deviceId,
                storeId: chat.storeId,
                commands: [
                  {
                    commandId: command.commandId,
                    localSequence: command.localSequence,
                    type: command.commandType,
                    entityType: command.entityType,
                    entityId: command.entityId,
                    expectedRemoteVersion: command.expectedRemoteVersion,
                    createdAt: command.createdAt,
                    payload: command.payload,
                  },
                ],
              }),
              randomUUID(),
            );
            expect(response.results[0]).toMatchObject({
              status: "CONFLICT",
              remoteVersion: 2,
            });
            await new ConflictRepository(s.a).recordPushConflict(
              command,
              response.results[0]!,
            );
            await s.a.runAsync(
              "UPDATE sync_outbox SET status='CONFLICT' WHERE command_id=?",
              command.commandId,
            );
            expect(
              (await new ConflictRepository(s.a).listOpen(chat.storeId)).length,
            ).toBe(2);
          }
          const state = await r.controller.open(card);
          expect(state.status).toBe("READY");
          if (
            mode === "REACTIVATION" ||
            mode === "DELETION" ||
            mode === "LOCAL_DELETION"
          ) {
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
                {
                  reactivateRejected:
                    mode === "REACTIVATION" && kind !== "PRODUCT",
                  retainWithdrawn: false,
                  activateProduct:
                    mode === "REACTIVATION" && kind === "PRODUCT",
                  acceptRemoteDeletion: mode === "DELETION",
                  confirmLocalDeletionChoice: mode === "LOCAL_DELETION",
                },
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
                {
                  reactivateRejected:
                    mode === "REACTIVATION" && kind !== "PRODUCT",
                  retainWithdrawn: false,
                  activateProduct:
                    mode === "REACTIVATION" && kind === "PRODUCT",
                  acceptRemoteDeletion: mode === "DELETION",
                  confirmLocalDeletionChoice: mode === "LOCAL_DELETION",
                },
              )
            ).status,
          ).toBe("COMPLETED");
          if (mode === "GROUP") {
            expect(
              await new ConflictRepository(s.a).listOpen(chat.storeId),
            ).toHaveLength(0);
            expect(
              s.db.prepare("SELECT COUNT(*) n FROM sync_conflicts").get()!.n,
            ).toBe(2);
          }
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
            if (mode === "LOCAL_DELETION") {
              const service = createMongoSyncPushService({
                getDb: async () => db,
                close: async () => {},
                checkHealth: async () => "connected",
              });
              const request = syncPushRequestSchema.parse({
                syncProtocolVersion: 1,
                appVersion: "test",
                storeId: chat.storeId,
                deviceId: s.scope.deviceId,
                commands: [wire],
              });
              expect(
                (await service.push(request, randomUUID())).results[0],
              ).toMatchObject({ status: "APPLIED", remoteVersion: 3 });
              expect(
                (await service.push(request, randomUUID())).results[0],
              ).toMatchObject({ status: "ALREADY_APPLIED", remoteVersion: 3 });
            } else
              await session.withTransaction(async () => {
                const applyCatalogue: typeof applyNeedUnitCommand = (
                  ctx,
                  store,
                  command,
                  requestId,
                  changes,
                ) =>
                  applyProductMasterCommand(
                    ctx,
                    store,
                    command,
                    requestId,
                    () => new Date(),
                    changes,
                  );
                const apply = {
                  PRODUCT: applyCatalogue,
                  IDENTIFIER: applyCatalogue,
                  ALIAS: applyCatalogue,
                  COMMERCIAL_REFERENCE: applyCommercialVersionDecisionCommand,
                  COMMERCIAL_EXECUTION: applyCommercialExecutionCommand,
                  COMMERCIAL_CHOICE: applyCommercialChoiceCommand,
                  COMMERCIAL_PREPARATION: applyCommercialPreparationCommand,
                  COMMERCIAL_PLAN: applyCommercialPlanCommand,
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
          if (
            mode === "LOCAL_DELETION" &&
            decision === "KEEP_LOCAL" &&
            isCatalogueConflictKind(kind)
          ) {
            const second = new DatabaseSync(":memory:"),
              local = new ReceiptTestDatabase(second);
            try {
              await runLocalMigrations(local);
              await applyProductMasterChange(local, chat.storeId, {
                entityType: r.entityType,
                entityId: r.remote.id,
                entityVersion: r.remote.version,
                operation: "UPSERT",
                entity: r.remote,
              });
              const page = await createMongoSyncPullService({
                getDb: async () => db,
                close: async () => {},
                checkHealth: async () => "connected",
              }).pull(chat.storeId, syncPullQuerySchema.parse({ limit: 100 }));
              const deletion = page.changes.find(
                (c) =>
                  c.entityType === r.entityType && c.entityId === r.remote.id,
              )!;
              expect(deletion).toMatchObject({
                operation: "DELETE",
                entityVersion: 3,
              });
              await applyProductMasterChange(local, chat.storeId, deletion);
              const table = {
                PRODUCT: "products",
                IDENTIFIER: "product_identifiers",
                ALIAS: "product_aliases",
              }[kind];
              expect(
                second
                  .prepare(`SELECT COUNT(*) n FROM ${table} WHERE id=?`)
                  .get(r.remote.id)!.n,
              ).toBe(0);
              expect(
                second.prepare("SELECT COUNT(*) n FROM sync_outbox").get()!.n,
              ).toBe(0);
            } finally {
              second.close();
            }
          }
          const restored = new DatabaseSync(":memory:"),
            adapter = new ReceiptTestDatabase(restored);
          try {
            await runLocalMigrations(adapter);
            const saved = await collection(name).findOne({ _id: r.remote.id });
            const { _id, duplicateKey, ...restoredPayload } = saved!;
            const payload = isCatalogueConflictKind(kind)
              ? serializeProductMasterDocument(
                  r.entityType,
                  saved as unknown as Parameters<
                    typeof serializeProductMasterDocument
                  >[1],
                )
              : restoredPayload;
            void _id;
            void duplicateKey;
            if (isCatalogueConflictKind(kind)) {
              const entity = catalogueConflictSchemas[kind].parse(payload);
              await applyProductMasterChange(adapter, chat.storeId, {
                entityType: r.entityType,
                entityId: entity.id,
                entityVersion: entity.version,
                operation: "UPSERT",
                entity,
              });
            } else {
              const apply = {
                COMMERCIAL_REFERENCE: applyCommercialVersionDecision,
                COMMERCIAL_EXECUTION: applyCommercialExecution,
                COMMERCIAL_CHOICE: applyCommercialChoice,
                COMMERCIAL_PREPARATION: applyCommercialPreparation,
                COMMERCIAL_PLAN: applyCommercialPlan,
                FIELD_EVENT: applyStoreProductEvent,
                SETTINGS: applyStoreContext,
                NEED: applyNeedUnit,
                MEMBERSHIP: applyNeedMembership,
                SUBSTITUTION: applyProductSubstitution,
              }[kind];
              await apply(adapter, chat.storeId, payload);
            }
            const table = {
              PRODUCT: "products",
              IDENTIFIER: "product_identifiers",
              ALIAS: "product_aliases",
              COMMERCIAL_REFERENCE: "commercial_version_decisions",
              COMMERCIAL_EXECUTION: "commercial_execution_tasks",
              COMMERCIAL_CHOICE: "commercial_offer_choices",
              COMMERCIAL_PREPARATION: "commercial_week_preparations",
              COMMERCIAL_PLAN: "commercial_week_plans",
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
            if (mode === "DELETION") {
              expect(payload).toMatchObject({
                deletedAt: "2026-10-20T18:00:00.000Z",
              });
              expect(
                restored.prepare(`SELECT deleted_at FROM ${table}`).get(),
              ).toMatchObject({ deleted_at: "2026-10-20T18:00:00.000Z" });
              expect(s.count("product_master_conflict_history")).toBe(1);
            }
            if (kind === "IDENTIFIER")
              expect(payload).toMatchObject({ value: "00042" });
            if (kind === "ALIAS")
              expect(payload).toMatchObject({ confidence: 0.8 });
            if (kind === "COMMERCIAL_REFERENCE") {
              const data = payload as {
                preference: string;
                before: { documentId: string };
                after: { documentId: string };
              };
              const local = "local" in r ? r.local : null;
              if (local && "preference" in local) {
                const chosen =
                  decision === "KEEP_LOCAL"
                    ? local.preference === "KEEP_PREVIOUS"
                      ? local.before.documentId
                      : local.after.documentId
                    : r.preview.basis.reference!.preference === "KEEP_PREVIOUS"
                      ? r.preview.basis.reference!.before.documentId
                      : r.preview.basis.reference!.after.documentId;
                expect(
                  data.preference === "KEEP_PREVIOUS"
                    ? data.before.documentId
                    : data.after.documentId,
                ).toBe(chosen);
              }
            }
            if (kind === "COMMERCIAL_EXECUTION") {
              expect(payload).toMatchObject({
                planRevisionId: r.preview.basis.execution!.planRevisionId,
                planChecksum: r.preview.basis.execution!.planChecksum,
                status: decision === "KEEP_LOCAL" ? "DONE" : "SKIPPED",
                completedAt:
                  decision === "KEEP_LOCAL" ? "2026-10-10T09:00:00.000Z" : null,
              });
            }
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
