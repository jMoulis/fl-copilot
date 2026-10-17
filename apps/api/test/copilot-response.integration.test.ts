import { readConversationCheckpoint } from "../src/copilot/context-checkpoint";
import { readConversationContext } from "../src/copilot/conversation-history-tool";
import { buildInformationRequestMessages } from "../src/copilot/information-request-messages";
import { readAnsweredInformationContext } from "../src/copilot/answered-information";
import { buildProductProposalMessages } from "../src/copilot/product-proposal-messages";
import { appendCopilotToolRecord } from "../src/copilot/response-store";
import { compareProductClassification } from "@fl-copilot/domain";
import {
  readProductClassificationPreview,
  readProductClassificationBatchPreview,
} from "../src/copilot/product-preview-tool";
import { readAttachedSources } from "../src/copilot/attached-sources";
import { readCopilotStoreSettings } from "../src/copilot/store-settings-tool";
import { storeContextFixture } from "../../../scripts/test-store-context-fixtures";
import {
  readNeedCatalogue,
  readNeedMemberships,
} from "../src/copilot/need-tools";
import { membershipFixture } from "../../../scripts/test-membership-fixtures";
import { readCommercialPlan } from "../src/copilot/commercial-plan-tool";
import { commercialExecutionFixture } from "../../../scripts/test-commercial-execution-fixtures";
import { wasteReceiptDraftSchema } from "@fl-copilot/sync-contracts";
import { readWasteReceipt } from "../src/copilot/waste-receipt-tool";
import { readStoreSourceDocuments } from "../src/copilot/commercial-documents-tool";
import { wastePublicationFixture } from "../../../scripts/test-waste-publication-fixtures";
import { readSubstitutes } from "../src/copilot/substitutes-tool";
import { substitutionFixture } from "../../../scripts/test-substitution-fixtures";
import { readFieldEvents } from "../src/copilot/field-events-tool";
import {
  prepareStoreProductEvent,
  storeProductEventSchema,
} from "@fl-copilot/domain";
import { readProductSearch } from "../src/copilot/product-search-tool";
import {
  readCommercialDocuments,
  readCommercialPdf,
} from "../src/copilot/commercial-documents-tool";
import { readCommercialOffers } from "../src/copilot/commercial-offers-tool";
import { commercialChoiceFixture } from "../../../scripts/test-commercial-choice-fixtures";
import { commercialOfferValidationSource } from "@fl-copilot/commercial-core";
import { readPeriodAnalysis } from "../src/copilot/period-analysis-tool";
import { mongoMigrations } from "../src/database/migrations";
import { readProductAnalysis } from "../src/copilot/product-analysis-tool";
import { readDailyAnalysis } from "../src/copilot/daily-analysis-tool";
import { readConversationGenerationHistory } from "../src/copilot/generation-history";
import { readLatestDepartmentEvidence } from "../src/copilot/daily-evidence";
import { buildDepartmentDailyPerformance } from "@fl-copilot/analytics-core";
import { buildApp } from "../src/build-app";
import { parseEnvironment } from "../src/config";
import type { AuthService } from "../src/auth/service";
import { randomUUID } from "node:crypto";
import { MongoClient, type Db } from "mongodb";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { chatFixture } from "../../../scripts/test-chat-fixtures";
import { appendCopilotResponse } from "../src/copilot/response-store";
import { createMongoSyncChangeService } from "../src/sync/sync-change-service";
import { acquireTurnLease } from "../src/copilot/turn-lease";
import { runCopilotTurn } from "../src/copilot/turn-service";
import {
  CopilotAiError,
  type CopilotAiProvider,
  type CopilotGenerationRequest,
} from "../src/copilot/ai-provider";
import {
  detectCopilotConflicts,
  scoreCopilotPriorities,
} from "@fl-copilot/analytics-core";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "assistant response transactions",
  () => {
    let client: MongoClient, db: Db;
    beforeAll(async () => {
      client = new MongoClient(uri!);
      await client.connect();
      db = client.db(
        `fl_reply_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
      );
      for (const name of [
        "copilotConversations",
        "copilotMessages",
        "syncStoreCounters",
        "syncChanges",
      ])
        await db.createCollection(name);
    });
    afterAll(async () => {
      if (db) await db.dropDatabase();
      if (client) await client.close();
    });
    async function fixture() {
      const f = chatFixture(randomUUID);
      await db
        .collection<{ _id: string }>("copilotConversations")
        .insertOne({ _id: f.conversation.id, ...f.conversation });
      await db
        .collection<{ _id: string }>("copilotMessages")
        .insertOne({ _id: f.message.id, ...f.message });
      const message = {
        ...f.message,
        id: randomUUID(),
        role: "ASSISTANT" as const,
        text: "Réponse testée",
        attachments: [],
        replyToMessageId: f.message.id,
      };
      return {
        ...f,
        response: message,
        authority: { storeId: f.storeId, ownerId: f.ownerId, canRespond: true },
      };
    }
    it("binds current message attachments to owned upload metadata and withholds unavailable/private source fields", async () => {
      const storeId = randomUUID();
      const refs = Array.from({ length: 7 }, () => ({
        sourceDocumentId: randomUUID(),
        filename: "Nom capturé inexact.pdf",
        mediaType: "image/jpeg",
      }));
      for (const [index, ref] of refs.slice(0, 6).entries()) {
        await db.collection("sourceDocuments").insertOne({
          _id: ref.sourceDocumentId,
          storeId: index === 2 ? randomUUID() : storeId,
          sourceType: "WEEKLY_COMMERCIAL_PDF",
          originalFilename:
            index === 2
              ? "Confidentiel autre magasin.pdf"
              : "Brief original.pdf",
          mimeType: "application/pdf",
          remoteUploadStatus:
            index === 1 ? "PENDING" : index === 4 ? "INVALID" : "CONFIRMED",
          createdAt: new Date("2026-10-13T08:00:00Z"),
          ...(index === 3 ? { deletedAt: new Date() } : {}),
          ...(index === 5 ? { mimeType: null } : {}),
          objectKey: "private/secret-object-key",
          blobUrl: "https://private.invalid/secret-token",
          checksum: "private-checksum",
        } as never);
      }
      const result = await readAttachedSources(db, storeId, refs);
      expect(result.map((source) => source.sourceDocumentId)).toEqual(
        refs.map((ref) => ref.sourceDocumentId),
      );
      expect(result.map((source) => source.status)).toEqual([
        "CONFIRMED",
        "PENDING_UPLOAD",
        "UNAVAILABLE",
        "UNAVAILABLE",
        "UNAVAILABLE",
        "UNAVAILABLE",
        "UNAVAILABLE",
      ]);
      expect(result[0]).toMatchObject({
        filename: "Brief original.pdf",
        mediaType: "application/pdf",
        registeredAt: "2026-10-13T08:00:00.000Z",
        sourceType: "WEEKLY_COMMERCIAL_PDF",
      });
      expect(result[2]).toMatchObject({
        filename: null,
        mediaType: null,
        sourceType: null,
        registeredAt: null,
      });
      for (const secret of [
        "secret-object-key",
        "secret-token",
        "private-checksum",
        "Confidentiel",
        "Nom capturé",
      ])
        expect(JSON.stringify(result)).not.toContain(secret);
      await db
        .collection("sourceDocuments")
        .updateOne({ _id: refs[1]!.sourceDocumentId } as never, {
          $set: { remoteUploadStatus: "CONFIRMED" },
        });
      expect(
        (await readAttachedSources(db, storeId, [refs[1]!]))[0]!.status,
      ).toBe("CONFIRMED");
      expect(await readAttachedSources(db, storeId, [])).toEqual([]);
      await expect(
        readAttachedSources(
          db,
          storeId,
          Array.from({ length: 11 }, () => refs[0]!),
        ),
      ).rejects.toThrow();
    });
    it("reads only owned synchronized settings and withholds device coordinates/capture metadata", async () => {
      const entity = storeContextFixture();
      const storeId = entity.storeId;
      const missing = await readCopilotStoreSettings(db, storeId, {});
      expect(missing.settings).toBeNull();
      expect(missing.evidence[0]!.value).toContain("non synchronisée");
      const point = {
        ...entity,
        locationMode: "POINT" as const,
        position: {
          latitude: 48.91234567,
          longitude: 2.28765432,
          capturedAt: "2026-10-13T09:23:45Z",
          source: "DEVICE" as const,
        },
      };
      await db
        .collection("storeContextSettings")
        .insertOne({ _id: storeId, ...point } as never);
      const result = await readCopilotStoreSettings(db, storeId, {});
      expect(result.settings).toMatchObject({
        city: entity.city,
        postalCode: entity.postalCode,
        schoolZone: "C",
        locationMode: "POINT",
      });
      expect(result.settings).not.toHaveProperty("position");
      expect(JSON.stringify(result)).not.toContain("48.91234567");
      expect(JSON.stringify(result)).not.toContain("2.28765432");
      expect(JSON.stringify(result)).not.toContain("09:23:45");
      expect(
        (await readCopilotStoreSettings(db, randomUUID(), {})).settings,
      ).toBeNull();
      await expect(
        readCopilotStoreSettings(db, storeId, { storeId: randomUUID() }),
      ).rejects.toThrow();
      await db
        .collection("storeContextSettings")
        .updateOne({ _id: storeId } as never, {
          $set: { city: "Paris", postalCode: "75001", version: 2 },
        });
      const changed = await readCopilotStoreSettings(db, storeId, {});
      expect(changed.evidence[0]!.id).not.toBe(result.evidence[0]!.id);
      expect(changed.evidence[0]!.sourceVersion).toBe(2);
      await db
        .collection("storeContextSettings")
        .updateOne({ _id: storeId } as never, { $set: { id: randomUUID() } });
      await expect(readCopilotStoreSettings(db, storeId, {})).rejects.toThrow();
    });
    it("reads overlapping field episodes across a Paris DST day with source/status separation, pagination and historical labels", async () => {
      const storeId = randomUUID(),
        productId = randomUUID(),
        otherId = randomUUID();
      const make = (startedAt: string, endedAt: string | null = null) =>
        prepareStoreProductEvent(storeId, {
          event: {
            id: randomUUID(),
            productId,
            type: "OUT_OF_STOCK",
            startedAt,
            endedAt,
            severity: "HIGH",
            comment: "Constaté en rayon",
            clientCapturedAt: "2026-10-26T12:00:00Z",
          },
        });
      const old = make("2026-10-24T21:00:00Z", "2026-10-24T23:00:00Z"),
        late = make("2026-10-25T22:30:00Z");
      const pdf = {
        ...make("2026-10-24T22:30:00Z"),
        source: "COMMERCIAL_PDF" as const,
        sourceDocumentId: randomUUID(),
        status: "TO_REVIEW" as const,
      };
      const elsewhere = {
        ...make("2026-10-25T12:00:00Z"),
        productId: otherId,
        type: "LOW_STOCK" as const,
      };
      await db
        .collection<{ _id: string }>("storeProductEvents")
        .insertMany(
          [
            old,
            late,
            pdf,
            elsewhere,
            make("2026-10-24T20:00:00Z", "2026-10-24T22:00:00Z"),
            make("2026-10-25T23:00:00Z"),
            { ...late, id: randomUUID(), storeId: randomUUID() },
          ].map((e) => ({ _id: e.id, ...e })),
        );
      await db
        .collection<{
          _id: string;
          storeId: string;
          label: string;
          deletedAt: Date;
        }>("products")
        .insertOne({
          _id: productId,
          storeId,
          label: "BANANE VRAC",
          deletedAt: new Date("2026-10-26T12:00:00Z"),
        });
      const input = {
        startAt: "2026-10-25T00:00:00+02:00",
        endAt: "2026-10-26T00:00:00+01:00",
        productId: null,
        afterId: null,
        limit: 10,
      };
      const all = await readFieldEvents(db, storeId, input);
      expect(all.startAt).toBe("2026-10-24T22:00:00.000Z");
      expect(all.endAt).toBe("2026-10-25T23:00:00.000Z");
      expect(all.events.map((r) => r.event.id).sort()).toEqual(
        [old.id, late.id, pdf.id, elsewhere.id].sort(),
      );
      expect(
        all.events.find((r) => r.event.id === old.id)?.productLabel,
      ).toContain("Produit retiré");
      expect(
        all.events.find((r) => r.event.id === elsewhere.id)?.productLabel,
      ).toBe("Produit à identifier");
      expect(all.evidence.find((e) => e.sourceId === pdf.id)?.factKind).toBe(
        "SOURCE_INSTRUCTION",
      );
      expect(all.evidence.find((e) => e.sourceId === late.id)?.factKind).toBe(
        "OBSERVED",
      );
      expect(all.evidence.at(-1)?.value).toContain(
        "ne prouve pas le stock actuel",
      );
      const selected = await readFieldEvents(db, storeId, {
        ...input,
        productId,
      });
      expect(selected.events).toHaveLength(3);
      await expect(
        readFieldEvents(db, storeId, { ...input, productId: randomUUID() }),
      ).rejects.toThrow("COPILOT_EVENTS_PRODUCT_UNAVAILABLE");
      const first = await readFieldEvents(db, storeId, { ...input, limit: 1 });
      expect(first.hasMore).toBe(true);
      const rest = await readFieldEvents(db, storeId, {
        ...input,
        afterId: first.nextAfterId,
      });
      expect(rest.events).toHaveLength(3);
      expect(rest.hasMore).toBe(false);
      expect(rest.nextAfterId).toBeNull();
      const empty = await readFieldEvents(db, storeId, {
        ...input,
        startAt: "2026-01-01T00:00:00Z",
        endAt: "2026-01-02T00:00:00Z",
      });
      expect(empty.events).toEqual([]);
      expect(empty.evidence[0]?.value).toContain(
        "ne prouve pas une absence de rupture",
      );
      const before = all.evidence.find((e) => e.sourceId === late.id)!.id;
      await db
        .collection<{ _id: string }>("storeProductEvents")
        .updateOne(
          { _id: late.id },
          { $set: { version: 2, comment: "Correction du constat" } },
        );
      expect(
        (await readFieldEvents(db, storeId, input)).evidence.find(
          (e) => e.sourceId === late.id,
        )!.id,
      ).not.toBe(before);
    });
    it("reads scoped shopper needs and memberships with review/refusal provenance and real Mongo product identities", async () => {
      const f = await membershipFixture(),
        storeId = f.need.storeId;
      await mongoMigrations.find((m) => m.version === 34)!.up(db);
      expect(
        await db
          .collection("needMemberships")
          .indexExists("need_membership_need_cursor"),
      ).toBe(true);
      expect(
        await db
          .collection("needMemberships")
          .indexExists("need_membership_product_cursor"),
      ).toBe(true);
      await db.collection("needUnits").insertMany([
        { _id: f.need.id, ...f.need },
        {
          _id: randomUUID(),
          ...f.need,
          id: randomUUID(),
          storeId: randomUUID(),
        },
      ] as never);
      for (let i = 0; i < 5; i++) {
        const id = randomUUID();
        await db.collection("needUnits").insertOne({
          ...f.need,
          _id: id,
          id,
          code: `BESOIN_${i}`,
          status: i % 2 ? "INACTIVE" : "TO_REVIEW",
        } as never);
      }
      const toProduct = (p: typeof f.product) => {
        const { id, ...data } = p;
        return {
          ...data,
          _id: id,
          schemaVersion: 1,
          createdAt: new Date(p.createdAt),
          updatedAt: new Date(p.updatedAt),
          deletedAt: p.deletedAt ? new Date(p.deletedAt) : null,
        };
      };
      await db.collection("products").insertOne(toProduct(f.product) as never);
      const other = { ...f.product, id: randomUUID(), label: "Tomate ronde" };
      await db.collection("products").insertOne(toProduct(other) as never);
      const proposed = {
        ...f.membership,
        id: randomUUID(),
        productId: other.id,
        status: "PROPOSED",
        humanConfirmed: false,
        source: "AI_PROPOSED",
      };
      const rejected = {
        ...f.membership,
        id: randomUUID(),
        productId: randomUUID(),
        status: "REJECTED",
      };
      await db
        .collection("needMemberships")
        .insertMany(
          [
            f.membership,
            proposed,
            rejected,
            { ...f.membership, id: randomUUID(), storeId: randomUUID() },
          ].map((m) => ({ _id: m.id, ...m })) as never,
        );
      const catalogue = await readNeedCatalogue(db, storeId, {
        afterId: null,
        limit: 5,
      });
      expect(catalogue.needs).toHaveLength(5);
      expect(catalogue.nextAfterId).not.toBeNull();
      const remaining = await readNeedCatalogue(db, storeId, {
        afterId: catalogue.nextAfterId,
        limit: 5,
      });
      expect(remaining.needs).toHaveLength(1);
      expect(remaining.nextAfterId).toBeNull();
      const input = {
        needUnitId: f.need.id,
        productId: null,
        afterId: null,
        limit: 10,
      };
      const result = await readNeedMemberships(db, storeId, input);
      expect(result.memberships.map((m) => m.entity.status).sort()).toEqual([
        "PROPOSED",
        "REJECTED",
        "VALIDATED",
      ]);
      expect(
        result.memberships.find((m) => m.entity.id === f.membership.id)!
          .product,
      ).toMatchObject({ id: f.product.id, nature: "UNKNOWN" });
      expect(
        result.memberships.find((m) => m.entity.id === rejected.id)!.product,
      ).toBeNull();
      expect(
        result.evidence.find((e) => e.sourceId === proposed.id)!.value,
      ).toContain("Proposée");
      expect(
        result.evidence.find((e) => e.sourceId === rejected.id)!.value,
      ).toContain("Refusée");
      const page = await readNeedMemberships(db, storeId, {
        ...input,
        limit: 1,
      });
      const next = await readNeedMemberships(db, storeId, {
        ...input,
        afterId: page.nextAfterId,
      });
      expect(next.memberships).toHaveLength(2);
      expect(next.nextAfterId).toBeNull();
      expect(
        (
          await readNeedMemberships(db, storeId, {
            ...input,
            productId: f.product.id,
          })
        ).memberships,
      ).toHaveLength(1);
      expect(
        (
          await readNeedMemberships(db, storeId, {
            ...input,
            needUnitId: null,
            productId: f.product.id,
          })
        ).memberships,
      ).toHaveLength(1);
      await expect(
        readNeedMemberships(db, randomUUID(), input),
      ).rejects.toThrow("PARENT_UNAVAILABLE");
      await expect(
        readNeedMemberships(db, storeId, { ...input, needUnitId: null }),
      ).rejects.toThrow();
      const before = result.evidence.find(
        (e) => e.sourceId === f.membership.id,
      )!.id;
      await db
        .collection("needMemberships")
        .updateOne({ _id: f.membership.id } as never, {
          $set: { version: 2, strength: 0.9 },
        });
      await db
        .collection("products")
        .updateOne({ _id: f.product.id } as never, {
          $set: { deletedAt: new Date(f.product.createdAt) },
        });
      const retired = await readNeedMemberships(db, storeId, input);
      expect(
        retired.evidence.find((e) => e.sourceId === f.membership.id)!.value,
      ).toContain("retiré");
      expect(
        retired.evidence.find((e) => e.sourceId === f.membership.id)!.id,
      ).not.toBe(before);
      await db.collection("needUnits").updateOne({ _id: f.need.id } as never, {
        $set: { status: "INACTIVE" },
      });
      expect(
        (await readNeedMemberships(db, storeId, input)).memberships[0]!.need
          ?.status,
      ).toBe("INACTIVE");
      await db
        .collection("needUnits")
        .updateOne({ _id: f.need.id } as never, { $set: { id: randomUUID() } });
      await expect(readNeedMemberships(db, storeId, input)).rejects.toThrow(
        "SCOPE",
      );
      expect(
        (await readNeedCatalogue(db, randomUUID(), { afterId: null, limit: 5 }))
          .needs,
      ).toEqual([]);
    });
    it("reads the saved commercial plan and exact-target declarations with shared progress and page coverage", async () => {
      const f = await commercialExecutionFixture(),
        p = f.plan,
        storeId = p.storeId,
        input = { weekStart: p.weekStart, offset: 0, limit: 1 };
      const missing = await readCommercialPlan(db, storeId, input);
      expect(missing).toMatchObject({
        status: "NO_PLAN",
        plan: null,
        progress: null,
        tasks: [],
      });
      await db
        .collection("commercialWeekPlans")
        .insertOne({ _id: p.id, ...p } as never);
      await db.collection("commercialExecutionTasks").insertMany([
        { _id: f.task.id, ...f.task },
        {
          ...f.task,
          _id: randomUUID(),
          id: randomUUID(),
          storeId: randomUUID(),
        },
      ] as never);
      const first = await readCommercialPlan(db, storeId, input);
      expect(first).toMatchObject({
        status: "READY",
        plan: {
          id: p.id,
          revisionId: p.revisionId,
          version: p.version,
          tgCapacity: 1,
        },
        progress: { total: 2, DONE: 1, TODO: 1 },
        nextOffset: 1,
        unmatchedDeclarations: 0,
      });
      expect(first.tasks[0]).toMatchObject({
        record: { status: "DONE", completedAt: f.task.completedAt },
        offer: { rawProductLabel: p.offers[0]!.rawProductLabel },
      });
      expect(first.evidence[0]!.value).toContain("pas une preuve automatique");
      const next = await readCommercialPlan(db, storeId, {
        ...input,
        offset: 1,
      });
      expect(next.nextOffset).toBeNull();
      expect(next.tasks[0]!.record).toBeNull();
      expect(next.tasks[0]!.placementOffers[0]!.choiceId).toBe(
        p.offers[0]!.choiceId,
      );
      expect(next.tasks[0]!.placement!.label).toBe("TG entrée");
      expect((await readCommercialPlan(db, randomUUID(), input)).status).toBe(
        "NO_PLAN",
      );
      const before = first.evidence[0]!.id;
      await db
        .collection("commercialExecutionTasks")
        .updateOne({ _id: f.task.id } as never, {
          $set: { note: "Déclaration corrigée", version: 2 },
        });
      expect(
        (await readCommercialPlan(db, storeId, input)).evidence[0]!.id,
      ).not.toBe(before);
      await db
        .collection("commercialExecutionTasks")
        .updateOne({ _id: f.task.id } as never, {
          $set: { planChecksum: "b".repeat(64) },
        });
      const mismatch = await readCommercialPlan(db, storeId, input);
      expect(mismatch.progress).toMatchObject({ DONE: 0, TODO: 2 });
      expect(mismatch.unmatchedDeclarations).toBe(1);
      expect(mismatch.tasks[0]!.record).toBeNull();
      await db
        .collection("commercialExecutionTasks")
        .updateOne({ _id: f.task.id } as never, {
          $set: { planRevisionId: randomUUID() },
        });
      const old = await readCommercialPlan(db, storeId, input);
      expect(old.progress?.DONE).toBe(0);
      expect(old.unmatchedDeclarations).toBe(0);
      await expect(
        readCommercialPlan(db, storeId, { ...input, weekStart: "2026-10-06" }),
      ).rejects.toThrow();
      const many = Array.from({ length: 131 }, () => {
        const id = randomUUID();
        return { ...f.task, _id: id, id };
      });
      await db.collection("commercialExecutionTasks").insertMany(many as never);
      expect(await readCommercialPlan(db, storeId, input)).toMatchObject({
        status: "LIMIT_EXCEEDED",
        progress: null,
        tasks: [],
        unmatchedDeclarations: null,
      });
    });
    it("reads receipt sources and immutable publication pages without mistaking extraction or exclusions for official waste", async () => {
      const p = wastePublicationFixture(),
        storeId = p.receipt.storeId,
        sourceId = p.source.id;
      const source = {
        _id: sourceId,
        storeId,
        sourceType: "WASTE_RECEIPT",
        remoteUploadStatus: "CONFIRMED",
        originalFilename: "ticket.jpg",
        checksum: p.source.checksum,
        createdAt: new Date(p.source.createdAt),
        objectKey: "private-never-expose",
      };
      await db.collection("sourceDocuments").insertOne(source as never);
      await db.collection("sourceDocuments").insertOne({
        ...source,
        _id: randomUUID(),
        storeId: randomUUID(),
      } as never);
      const discovery = await readStoreSourceDocuments(
        db,
        storeId,
        { cursor: null, limit: 1 },
        "WASTE_RECEIPT",
      );
      expect(discovery.documents).toHaveLength(1);
      expect(discovery.documents[0]!.sourceDocumentId).toBe(sourceId);
      expect(JSON.stringify(discovery)).not.toContain("private-never-expose");
      const reader = {
        read: vi.fn(async () => {
          throw Error("WASTE_RECEIPT_DRAFT_NOT_READY");
        }),
      };
      const input = { sourceDocumentId: sourceId, offset: 0, limit: 1 };
      expect(await readWasteReceipt(db, storeId, input, reader)).toMatchObject({
        status: "NOT_READY",
        lineCount: null,
        nextOffset: null,
      });
      await expect(
        readWasteReceipt(db, randomUUID(), input, reader),
      ).rejects.toThrow("UNAVAILABLE");
      const draft = wasteReceiptDraftSchema.parse({
        detectedReceiptDate: "2026-10-11",
        detectedCashierNumber: "000009",
        extractionModelVersion: "fixture",
        arithmeticValidatorVersion: "receipt-arithmetic-v1",
        productMatcherVersion: "product-matcher-v1",
        lines: [
          {
            lineId: randomUUID(),
            sourceLineIndex: 0,
            rawLabel: "FIGUE VRAC",
            quantity: null,
            weight: "1.5",
            quantityUnit: "KG",
            unitPrice: "2",
            totalPrice: "4",
            extractionConfidence: { label: 0.4 },
            sourceRegion: null,
            arithmeticStatus: "MISMATCH",
            arithmeticExpectedTotal: "3",
            arithmeticDifference: "1",
            arithmeticWarningCode: "AMOUNT_TO_REVIEW",
            matchState: "AMBIGUOUS",
            matchedProductId: null,
            matchedProductLabel: null,
            matchConfidence: 0.4,
            productNature: "UNKNOWN",
            candidates: [],
            validationStatus: "TO_REVIEW",
          },
        ],
      });
      const draftResult = await readWasteReceipt(db, storeId, input, {
        read: async () => draft,
      });
      expect(draftResult).toMatchObject({
        status: "EXTRACTED",
        published: null,
        lineCount: 1,
        extracted: {
          header: { detectedCashierNumber: "000009" },
          lines: [
            {
              arithmeticStatus: "MISMATCH",
              validationStatus: "TO_REVIEW",
              matchState: "AMBIGUOUS",
            },
          ],
        },
      });
      expect(draftResult.evidence[0]!.factKind).toBe("QUALITY");
      expect(draftResult.evidence[0]!.value).toContain("non publié");
      await expect(
        readWasteReceipt(db, storeId, input, {
          read: async () => {
            throw Error("PRIVATE_FAILURE");
          },
        }),
      ).rejects.toThrow("PRIVATE_FAILURE");

      await db.collection("wasteReceiptPublications").insertOne({
        _id: p.receipt.id,
        id: p.receipt.id,
        storeId,
        remoteVersion: 1,
        version: 1,
        publication: p,
      } as never);
      reader.read.mockClear();
      const result = await readWasteReceipt(db, storeId, input, reader);
      expect(result).toMatchObject({
        status: "PUBLISHED",
        lineCount: 2,
        nextOffset: 1,
        published: {
          receipt: {
            confirmedWasteDate: "2026-10-12",
            detectedReceiptDate: "2026-10-11",
            confirmedCashierNumber: "000007",
            detectedCashierNumber: "000009",
          },
        },
      });
      expect(result.published!.observations[0]).toMatchObject({
        quantity: null,
        productNature: "UNKNOWN",
        purchaseValueKnown: null,
        salesValue: "3",
      });
      expect(reader.read).not.toHaveBeenCalled();
      const excluded = await readWasteReceipt(
        db,
        storeId,
        { ...input, offset: 1 },
        reader,
      );
      expect(excluded.published!.observations).toEqual([]);
      expect(excluded.evidence[0]!.value).toContain("explicitement exclue");
      const prior = result.evidence[0]!.id;
      await db
        .collection("wasteReceiptPublications")
        .updateOne({ _id: p.receipt.id } as never, {
          $set: { "publication.receipt.confirmedCashierNumber": "000010" },
        });
      expect(
        (await readWasteReceipt(db, storeId, input, reader)).evidence[0]!.id,
      ).not.toBe(prior);
      await db
        .collection("sourceDocuments")
        .updateOne({ _id: sourceId } as never, {
          $set: { checksum: "changed" },
        });
      await expect(
        readWasteReceipt(db, storeId, input, reader),
      ).rejects.toThrow("SCOPE");
    });
    it("reads scoped directed alternatives with canonical ranking, refusal, field exclusions and complete coverage", async () => {
      const f = await substitutionFixture(),
        at = "2026-10-13T10:00:00.000Z",
        storeId = f.product.storeId;
      const putProduct = async (p: typeof f.product) => {
        const { id, ...data } = p;
        await db.collection("products").insertOne({
          ...data,
          _id: id,
          schemaVersion: 1,
          createdAt: new Date(p.createdAt),
          updatedAt: new Date(p.updatedAt),
        } as never);
      };
      await putProduct(f.product);
      await putProduct(f.substitute);
      await db
        .collection("needUnits")
        .insertOne({ _id: f.need.id, ...f.need } as never);
      const relations = [f.substitution];
      for (let i = 0; i < 6; i++) {
        const target = {
          ...f.substitute,
          id: randomUUID(),
          label: `Alternative ${i}`,
        };
        await putProduct(target);
        relations.push({
          ...f.substitution,
          id: randomUUID(),
          substituteProductId: target.id,
          needCompatibility: 0.1 + i * 0.1,
          ...(i === 0
            ? { status: "REJECTED" as const }
            : i === 1
              ? { status: "PROPOSED" as const, humanConfirmed: false }
              : {}),
        });
        if (i === 2 || i === 3) {
          const event = storeProductEventSchema.parse({
            id: randomUUID(),
            storeId,
            productId: target.id,
            source: "USER",
            sourceDocumentId: null,
            type: i === 2 ? "OUT_OF_STOCK" : "LOW_STOCK",
            severity: null,
            comment: null,
            startedAt: "2026-10-12T10:00:00.000Z",
            endedAt: null,
            status: i === 3 ? "TO_REVIEW" : "ACTIVE",
            clientCapturedAt: "2026-10-12T10:00:00.000Z",
            version: 1,
            createdAt: at,
            updatedAt: at,
          });
          await db
            .collection("storeProductEvents")
            .insertOne({ _id: event.id, ...event } as never);
        }
      }
      const foreign = {
        ...f.substitution,
        id: randomUUID(),
        storeId: randomUUID(),
        substituteProductId: randomUUID(),
      };
      await db
        .collection("productSubstitutions")
        .insertMany(
          [...relations, foreign].map((r) => ({ _id: r.id, ...r })) as never,
        );
      const input = {
        productId: f.product.id,
        needUnitId: null,
        at,
        offset: 0,
        limit: 1,
      };
      const result = await readSubstitutes(db, storeId, input, at);
      expect(result.lookupStatus).toBe("READY");
      expect(result.candidateCount).toBe(3);
      expect(result.candidates[0]).toMatchObject({
        productId: f.substitute.id,
        availability: "UNKNOWN",
      });
      expect(result.candidates[0]!.relationships[0]).toMatchObject({
        basis: "DECLARED",
        syncState: "SYNCED",
      });
      expect(result.hasMore).toBe(true);
      expect(result.nextOffset).toBe(1);
      expect(result.excluded.map((e) => e.reason).sort()).toEqual([
        "EVENT_UNRESOLVED",
        "OUT_OF_STOCK",
        "REJECTED",
        "UNCONFIRMED",
      ]);
      expect(result.evidence[0]).toMatchObject({
        sourceType: "SUBSTITUTION",
        factKind: "DERIVED",
      });
      const next = await readSubstitutes(
        db,
        storeId,
        { ...input, offset: 1, limit: 5 },
        at,
      );
      expect(next.candidates).toHaveLength(2);
      expect(next.hasMore).toBe(false);
      expect(
        (
          await readSubstitutes(
            db,
            storeId,
            { ...input, productId: f.substitute.id },
            at,
          )
        ).candidateCount,
      ).toBe(0);
      expect(
        (await readSubstitutes(db, foreign.storeId, input, at)).lookupStatus,
      ).toBe("SOURCE_UNAVAILABLE");
      expect(
        (
          await readSubstitutes(
            db,
            storeId,
            { ...input, needUnitId: randomUUID() },
            at,
          )
        ).candidateCount,
      ).toBe(0);
      await expect(
        readSubstitutes(
          db,
          storeId,
          { ...input, at: "2026-10-14T10:00:00.000Z" },
          at,
        ),
      ).rejects.toThrow("FUTURE");
      const prior = result.evidence[0]!.id;
      await db
        .collection("productSubstitutions")
        .updateOne({ _id: f.substitution.id } as never, {
          $set: { version: 2, needCompatibility: 0.9 },
        });
      expect(
        (await readSubstitutes(db, storeId, input, at)).evidence[0]!.id,
      ).not.toBe(prior);
      const oversized = Array.from({ length: 251 }, () => ({
        ...f.substitution,
        _id: randomUUID(),
        id: randomUUID(),
      }));
      // Use canonical IDs even for oversized records: incomplete sets are refused, not ranked.
      for (const row of oversized) row.id = row._id;
      await db
        .collection("productSubstitutions")
        .insertMany(oversized as never);
      expect(await readSubstitutes(db, storeId, input, at)).toMatchObject({
        lookupStatus: "LIMIT_EXCEEDED",
        candidateCount: null,
        candidates: [],
        excludedCount: null,
      });
    });
    it("searches real Mongo product records with string codes, validated aliases and explicit name ambiguity", async () => {
      const f = await commercialChoiceFixture(),
        stamp = new Date(f.product.createdAt);
      const { id, ...data } = f.product;
      const product = {
        ...data,
        _id: id,
        label: "BANANE VRAC",
        schemaVersion: 1,
        createdAt: stamp,
        updatedAt: stamp,
        deletedAt: null,
      };
      const second = {
        ...product,
        _id: randomUUID(),
        label: "BANANE BIO VRAC",
      };
      await db
        .collection<
          Omit<typeof product, "deletedAt"> & { deletedAt: Date | null }
        >("products")
        .insertMany([
          product,
          second,
          { ...product, _id: randomUUID(), storeId: randomUUID() },
          {
            ...product,
            _id: randomUUID(),
            label: "BANANE RETIREE",
            deletedAt: stamp,
          },
        ]);
      const identifier = {
        _id: randomUUID(),
        storeId: f.storeId,
        productId: id,
        type: "PLU",
        value: "000123",
        source: "USER",
        status: "VALIDATED",
        version: 1,
        schemaVersion: 1,
        createdAt: stamp,
        updatedAt: stamp,
        deletedAt: null,
      };
      await db
        .collection<typeof identifier>("productIdentifiers")
        .insertOne(identifier);
      const alias = {
        _id: randomUUID(),
        storeId: f.storeId,
        productId: id,
        alias: "Fruit jaune",
        normalizedAlias: "FRUIT JAUNE",
        source: "USER",
        status: "VALIDATED",
        version: 1,
        schemaVersion: 1,
        createdAt: stamp,
        updatedAt: stamp,
        deletedAt: null,
      };
      await db.collection<typeof alias>("productAliases").insertMany([
        alias,
        {
          ...alias,
          _id: randomUUID(),
          alias: "Ne pas apprendre",
          normalizedAlias: "NE PAS APPRENDRE",
          status: "REJECTED",
        },
      ]);
      const code = await readProductSearch(db, f.storeId, {
        label: null,
        identifiers: [{ type: "PLU", value: "000123" }],
      });
      expect(code.state).toBe("AUTO_MATCH");
      expect(code.matchedProductId).toBe(id);
      expect(code.candidates[0]?.basis).toBe("EXACT_IDENTIFIER");
      const text = await readProductSearch(db, f.storeId, {
        label: "banane",
        identifiers: [],
      });
      expect(text.state).toBe("AMBIGUOUS");
      expect(text.matchedProductId).toBeNull();
      expect(text.candidateCount).toBe(2);
      expect(
        text.candidates.every((c) => c.product.storeId === f.storeId),
      ).toBe(true);
      expect(
        (
          await readProductSearch(db, f.storeId, {
            label: "fruit jaune",
            identifiers: [],
          })
        ).matchedProductId,
      ).toBe(id);
      const missing = await readProductSearch(db, f.storeId, {
        label: null,
        identifiers: [{ type: "PLU", value: "123" }],
      });
      expect(missing.state).toBe("NO_MATCH");
      expect(missing.missingIdentifiers[0]?.value).toBe("123");
      expect(
        (
          await readProductSearch(db, f.storeId, {
            label: "Ne pas apprendre",
            identifiers: [],
          })
        ).matchedProductId,
      ).toBeNull();
      await db
        .collection<
          Omit<typeof product, "deletedAt"> & { deletedAt: Date | null }
        >("products")
        .insertMany(
          Array.from({ length: 1000 }, (_, i) => ({
            ...product,
            _id: randomUUID(),
            label: `Autre article ${i}`,
          })),
        );
      const limited = await readProductSearch(db, f.storeId, {
        label: "banane",
        identifiers: [],
      });
      expect(limited.status).toBe("LIMIT_EXCEEDED");
      expect(limited.state).toBeNull();
      expect(limited.candidates).toEqual([]);
      expect(limited.evidence[0]?.value).toContain("échantillon");
    });
    it("discovers owned PDFs, scopes visual reading to the requested week and preserves citations without private URLs", async () => {
      const f = await commercialChoiceFixture();
      const stamp = new Date("2026-10-08T08:00:00Z");
      const source = {
        _id: f.sourceDocumentId,
        storeId: f.storeId,
        originalFilename: "pense-bete.pdf",
        checksum: f.reading.checksum,
        createdAt: stamp,
        sourceType: "WEEKLY_COMMERCIAL_PDF",
        remoteUploadStatus: "CONFIRMED",
        objectKey: "private-secret-key",
        blobUrl: "https://private.invalid",
      };
      await db.collection<typeof source>("sourceDocuments").insertOne(source);
      const second = {
        ...source,
        _id: randomUUID(),
        createdAt: new Date("2026-10-07T08:00:00Z"),
      };
      await db.collection<typeof source>("sourceDocuments").insertOne(second);
      await db
        .collection<typeof source>("sourceDocuments")
        .insertOne({ ...source, _id: randomUUID(), storeId: randomUUID() });
      await db.collection<typeof source>("sourceDocuments").insertOne({
        ...source,
        _id: randomUUID(),
        remoteUploadStatus: "PENDING",
      });
      await db
        .collection<{ _id: string; updatedAt: Date }>(
          "commercialVisualReadings",
        )
        .insertOne({ _id: f.reading.id, ...f.reading, updatedAt: stamp });
      const docs = await readCommercialDocuments(db, f.storeId, {
        cursor: null,
        limit: 1,
      });
      expect(docs.documents[0]?.sourceDocumentId).toBe(f.sourceDocumentId);
      expect(docs.nextCursor).not.toBeNull();
      const rest = await readCommercialDocuments(db, f.storeId, {
        cursor: docs.nextCursor,
        limit: 5,
      });
      expect(rest.documents.map((d) => d.sourceDocumentId)).toEqual([
        second._id,
      ]);
      expect(rest.nextCursor).toBeNull();
      expect(JSON.stringify(docs)).not.toMatch(
        /private-secret-key|private.invalid/,
      );
      const input = {
        sourceDocumentId: f.sourceDocumentId,
        businessDate: "2026-10-08",
        pageNumber: 1,
        offset: 0,
        limit: 16,
      };
      const result = await readCommercialPdf(db, f.storeId, input);
      expect(result.status).toBe("READY");
      expect(result.week.number).toBe(41);
      expect(
        result.entries.some(
          (e) => e.label.includes("sellingPrice") && e.value === "2,20€",
        ),
      ).toBe(true);
      expect(
        result.entries.some((e) =>
          e.citations.some((c) => c.quote === "2,20€"),
        ),
      ).toBe(true);
      expect(
        result.evidence.some((e) => e.factKind === "SOURCE_INSTRUCTION"),
      ).toBe(true);
      expect(result.evidence.at(-1)?.value).toContain("non validée");
      const segment = await readCommercialPdf(db, f.storeId, {
        ...input,
        limit: 1,
      });
      expect(segment.nextOffset).toBe(1);
      expect(
        (
          await readCommercialPdf(db, f.storeId, {
            ...input,
            offset: segment.nextOffset!,
            limit: 1,
          })
        ).entries[0]?.id,
      ).not.toBe(segment.entries[0]?.id);
      const outside = await readCommercialPdf(db, f.storeId, {
        ...input,
        businessDate: "2026-10-15",
      });
      expect(outside.entries).toEqual([]);
      expect(outside.excludedOperations).toBe(1);
      const pending = await readCommercialPdf(db, f.storeId, {
        ...input,
        pageNumber: 2,
      });
      expect(pending.status).toBe("NOT_READY");
      expect(pending.entries).toEqual([]);
      await expect(readCommercialPdf(db, randomUUID(), input)).rejects.toThrow(
        "COPILOT_DOCUMENT_UNAVAILABLE",
      );
      await db
        .collection<typeof source>("sourceDocuments")
        .updateOne(
          { _id: f.sourceDocumentId },
          { $set: { checksum: "changed" } },
        );
      expect((await readCommercialPdf(db, f.storeId, input)).status).toBe(
        "NOT_READY",
      );
    });
    it("reads only retained scoped offers, paginates without pretending completeness and rejects stale validation", async () => {
      const f = await commercialChoiceFixture();
      const c = f.choice;
      const save = async (choice: typeof c) =>
        db
          .collection<{ _id: string; duplicateKey: string }>(
            "commercialOfferChoices",
          )
          .insertOne({ _id: choice.id, duplicateKey: choice.id, ...choice });
      await save(c);
      const another = {
        ...c,
        id: randomUUID(),
        rawProductLabel: "Autre offre",
        productId: randomUUID(),
      };
      await save(another);
      await save({ ...c, id: randomUUID(), storeId: randomUUID() });
      await save({ ...c, id: randomUUID(), status: "WITHDRAWN" });
      await save({
        ...c,
        id: randomUUID(),
        saleStart: "2025-01-01",
        saleEnd: "2025-01-07",
      });
      const validation = {
        id: randomUUID(),
        storeId: f.storeId,
        choice: c,
        ...commercialOfferValidationSource(c, [f.reading]),
        status: "VALIDATED",
        sourceReviewed: true,
        version: 1,
        createdAt: c.createdAt,
      };
      await db
        .collection<{ _id: string }>("commercialValidatedOffers")
        .insertOne({ _id: validation.id, ...validation });
      const input = { start: c.saleStart, end: c.saleEnd, limit: 1 };
      const first = await readCommercialOffers(db, f.storeId, input);
      expect(first.hasMore).toBe(true);
      expect(first.offers).toHaveLength(1);
      expect(first.nextAfterId).toBe(first.offers[0]!.choice.id);
      const second = await readCommercialOffers(db, f.storeId, {
        ...input,
        afterId: first.nextAfterId,
      });
      expect(second.hasMore).toBe(false);
      expect(second.nextAfterId).toBeNull();
      const combined = [...first.offers, ...second.offers];
      expect(combined.map((o) => o.choice.id).sort()).toEqual(
        [c.id, another.id].sort(),
      );
      expect(combined.find((o) => o.choice.id === c.id)?.validationId).toBe(
        validation.id,
      );
      expect(
        combined.find((o) => o.choice.id === another.id)?.validationId,
      ).toBeNull();
      expect(first.evidence.at(-1)?.value).toContain("d’autres offres");
      expect(first.evidence[0]?.factKind).toBe("PLANNED");
      expect(first.evidence[0]?.sourceId).toBe(c.source.sourceDocumentId);
      const oldEvidence = [...first.evidence, ...second.evidence].find(
        (e) =>
          e.sourceId === c.source.sourceDocumentId &&
          e.label.includes("Offre retenue") &&
          e.label.includes(c.rawProductLabel),
      )!.id;
      await db
        .collection<{ _id: string }>("commercialOfferChoices")
        .updateOne(
          { _id: c.id },
          { $set: { note: "Révision de la portée", version: 2 } },
        );
      const changed = await readCommercialOffers(db, f.storeId, {
        ...input,
        limit: 10,
      });
      expect(
        changed.offers.find((o) => o.choice.id === c.id)?.validationId,
      ).toBeNull();
      expect(
        changed.evidence.find(
          (e) =>
            e.label.includes(c.rawProductLabel) &&
            e.label.includes("Offre retenue"),
        )!.id,
      ).not.toBe(oldEvidence);
      // Same revision number alone cannot attest a changed snapshot.
      await db
        .collection<{ _id: string }>("commercialValidatedOffers")
        .updateOne({ _id: validation.id }, { $set: { "choice.version": 2 } });
      expect(
        (
          await readCommercialOffers(db, f.storeId, { ...input, limit: 10 })
        ).offers.find((o) => o.choice.id === c.id)?.validationId,
      ).toBeNull();
      const empty = await readCommercialOffers(db, f.storeId, {
        start: "2024-01-01",
        end: "2024-01-07",
      });
      expect(empty.offers).toEqual([]);
      expect(empty.evidence[0]?.value).toContain(
        "instructions PDF non retenues",
      );
      await expect(
        readCommercialOffers(db, f.storeId, {
          start: "2026-02-30",
          end: "2026-03-01",
        }),
      ).rejects.toThrow();
    });
    it("calculates arbitrary calendar periods with gaps, annual coverage, product scope and no implicit reference", async () => {
      const storeId = randomUUID();
      const save = async (
        date: string,
        value: string,
        scopedStore = storeId,
      ) => {
        const p = buildDepartmentDailyPerformance({
          storeId: scopedStore,
          businessDate: date,
          computedAt: "2026-10-12T12:00:00Z",
          productPerformances: [],
        });
        const performance = {
          ...p,
          inputRevision: `${date}/${value}`,
          sales: { ...p.sales, salesValue: value },
          availability: {
            ...p.availability,
            salesValue: {
              status: "AVAILABLE",
              inputCount: 1,
              availableInputCount: 1,
              missingInputCount: 0,
            },
          },
        };
        await db
          .collection<{
            _id: string;
            storeId: string;
            date: string;
            performance: unknown;
          }>("departmentDailyPerformance")
          .insertOne({
            _id: randomUUID(),
            storeId: scopedStore,
            date,
            performance,
          });
        return performance;
      };
      const current = await save("2026-09-01", "100.00");
      await save("2026-09-02", "50.00");
      await save("2026-08-01", "25.00");
      await save("2026-08-02", "25.00");
      await save("2026-09-01", "99999", randomUUID());
      const input = {
        productId: null,
        currentPeriod: { start: "2026-09-01", end: "2026-09-03" },
        referencePeriod: { start: "2026-08-01", end: "2026-08-02" },
        aggregation: "SUM",
        metrics: ["sales"],
      };
      const result = await readPeriodAnalysis(db, storeId, input);
      expect(
        result.evidence.find((e) => e.label.startsWith("Total partiel"))?.value,
      ).toBe("150.00");
      expect(
        result.evidence.find((e) => e.label.startsWith("Écart partiel"))?.value,
      ).toBe("100.00");
      expect(result.coverage[0]?.current).toMatchObject({
        expectedDays: 3,
        availableDays: 2,
        missingDays: 1,
        missingDateExamples: ["2026-09-03"],
      });
      expect(result.evidence.some((e) => e.value === "99999")).toBe(false);
      expect(
        (
          await readPeriodAnalysis(db, storeId, {
            ...input,
            aggregation: "AVERAGE",
          })
        ).evidence.find((e) =>
          e.label.startsWith("Moyenne journalière partielle"),
        )?.value,
      ).toBe("75.00");
      const year = await readPeriodAnalysis(db, storeId, {
        ...input,
        currentPeriod: { start: "2024-01-01", end: "2024-12-31" },
        referencePeriod: null,
      });
      expect(year.coverage[0]?.current.expectedDays).toBe(366);
      expect(
        year.evidence.find((e) => e.sourceType === "KPI")?.value,
      ).toBeNull();
      expect(year.referencePeriod).toBeNull();
      expect(year.evidence.filter((e) => e.sourceType === "KPI")).toHaveLength(
        1,
      );
      expect(year.coverage[0]?.availablePeriods).toEqual([]);
      const productId = randomUUID();
      await db
        .collection<{
          _id: string;
          storeId: string;
          label: string;
        }>("products")
        .insertOne({
          _id: productId,
          storeId,
          label: "BANANE VRAC",
        });
      await db
        .collection<{
          _id: string;
          storeId: string;
          productId: string;
          date: string;
          performance: unknown;
        }>("productDailyPerformance")
        .insertOne({
          _id: randomUUID(),
          storeId,
          productId,
          date: "2026-09-01",
          performance: {
            ...current,
            productId,
            formulaVersion: "product-daily-v1",
            sales: { ...current.sales, salesValue: "7.00" },
          },
        });
      const product = await readPeriodAnalysis(db, storeId, {
        ...input,
        productId,
        referencePeriod: null,
        currentPeriod: { start: "2026-09-01", end: "2026-09-01" },
      });
      expect(product.target).toMatchObject({
        type: "PRODUCT",
        productId,
        label: "BANANE VRAC",
      });
      expect(product.evidence.find((e) => e.sourceType === "KPI")?.value).toBe(
        "7.00",
      );
      await expect(
        readPeriodAnalysis(db, randomUUID(), { ...input, productId }),
      ).rejects.toThrow("COPILOT_PERIOD_PRODUCT_UNAVAILABLE");
      await expect(
        readPeriodAnalysis(db, storeId, {
          ...input,
          currentPeriod: { start: "2026-02-30", end: "2026-03-01" },
        }),
      ).rejects.toThrow();
    });
    it("ranks only comparable scoped product changes, retains historical labels and refuses truncated rankings", async () => {
      const storeId = randomUUID(),
        banana = randomUUID(),
        pear = randomUUID(),
        partial = randomUUID();
      const save = async (
        productId: string,
        date: string,
        value: string,
        status = "AVAILABLE",
        scopedStore = storeId,
      ) => {
        const base = buildDepartmentDailyPerformance({
          storeId: scopedStore,
          businessDate: date,
          computedAt: "2026-10-12T12:00:00.000Z",
          productPerformances: [],
        });
        const performance = {
          ...base,
          productId,
          formulaVersion: "product-daily-v1",
          inputRevision: `${productId}/${date}/${value}`,
          sales: { ...base.sales, salesValue: value },
          availability: {
            ...base.availability,
            salesValue: {
              status,
              inputCount: 1,
              availableInputCount: 1,
              missingInputCount: 0,
            },
          },
        };
        const id = randomUUID();
        await db
          .collection<{
            _id: string;
            storeId: string;
            productId: string;
            date: string;
            performance: unknown;
          }>("productDailyPerformance")
          .insertOne({
            _id: id,
            storeId: scopedStore,
            productId,
            date,
            performance,
          });
        return id;
      };
      await save(banana, "2026-10-08", "80");
      await save(banana, "2026-10-01", "100");
      const changed = await save(pear, "2026-10-08", "60");
      await save(pear, "2026-10-01", "100");
      await save(partial, "2026-10-08", "1", "PARTIAL");
      await save(partial, "2026-10-01", "999");
      await save(
        randomUUID(),
        "2026-10-08",
        "99999",
        "AVAILABLE",
        randomUUID(),
      );
      await db
        .collection<{
          _id: string;
          storeId: string;
          label: string;
          deletedAt?: string;
        }>("products")
        .insertMany([
          { _id: banana, storeId, label: "BANANE VRAC" },
          {
            _id: pear,
            storeId,
            label: "POIRE VRAC",
            deletedAt: "2026-10-10T10:00:00Z",
          },
        ]);
      await mongoMigrations.find((m) => m.version === 33)!.up(db);
      const input = {
        businessDate: "2026-10-08",
        metric: "sales",
        direction: "DECREASE",
      };
      const result = await readProductAnalysis(db, storeId, input);
      expect(result.products.map((p) => p.productId)).toEqual([pear, banana]);
      expect(result.products[0]?.label).toContain("Produit retiré");
      expect(result.coverage).toEqual({
        status: "COMPARED_PRODUCTS",
        comparedProductCount: 2,
        excludedProductCount: 1,
      });
      expect(
        result.evidence.find((e) => e.label.startsWith("Écart (€) — POIRE"))
          ?.value,
      ).toBe("-40");
      const oldId = result.evidence[0]?.id;
      await db.collection<{ _id: string }>("productDailyPerformance").updateOne(
        { _id: changed },
        {
          $set: {
            "performance.inputRevision": "corrected",
            "performance.sales.salesValue": "50",
          },
        },
      );
      expect(
        (await readProductAnalysis(db, storeId, input)).evidence[0]?.id,
      ).not.toBe(oldId);
      expect(
        (await readProductAnalysis(db, storeId, { ...input, metric: "margin" }))
          .coverage.comparedProductCount,
      ).toBe(0);
      const largeStore = randomUUID();
      await db
        .collection<{
          _id: string;
          storeId: string;
          date: string;
          productId: string;
          performance: unknown;
        }>("productDailyPerformance")
        .insertMany(
          Array.from({ length: 1001 }, () => ({
            _id: randomUUID(),
            storeId: largeStore,
            date: "2026-10-08",
            productId: randomUUID(),
            performance: null,
          })),
        );
      const limited = await readProductAnalysis(db, largeStore, input);
      expect(limited.products).toEqual([]);
      expect(limited.coverage).toEqual({
        status: "LIMIT_EXCEEDED",
        comparedProductCount: null,
        excludedProductCount: null,
      });
    });
    it("reads only the explicit day and computes J-7 through the shared engine, preserving missing and zero reference", async () => {
      const storeId = randomUUID();
      const save = async (
        date: string,
        salesValue: string,
        id = randomUUID(),
        scopedStore = storeId,
      ) => {
        const performance = buildDepartmentDailyPerformance({
          storeId: scopedStore,
          businessDate: date,
          computedAt: "2026-10-12T12:00:00.000Z",
          productPerformances: [],
        });
        const snapshot = {
          ...performance,
          sales: { ...performance.sales, salesValue },
          availability: {
            ...performance.availability,
            salesValue: {
              status: "AVAILABLE",
              inputCount: 1,
              availableInputCount: 1,
              missingInputCount: 0,
            },
          },
        };
        await db
          .collection<{
            _id: string;
            storeId: string;
            date: string;
            performance: unknown;
          }>("departmentDailyPerformance")
          .insertOne({
            _id: id,
            storeId: scopedStore,
            date,
            performance: snapshot,
          });
        return id;
      };
      await save("2026-10-08", "125.50");
      const referenceId = await save("2026-10-01", "100.00");
      await save("2026-10-08", "99999", randomUUID(), randomUUID());
      await save("2026-10-12", "88888");
      const value = await readDailyAnalysis(db, storeId, {
        businessDate: "2026-10-08",
      });
      expect(value.referenceDate).toBe("2026-10-01");
      const difference = value.evidence.find((e) =>
        e.label.startsWith("Écart (€) — Chiffre"),
      );
      const percentage = value.evidence.find((e) =>
        e.label.startsWith("Évolution (%) — Chiffre"),
      );
      expect(difference?.value).toBe("25.50");
      expect(percentage?.value).toBe("25.50");
      expect(
        value.evidence.some((e) => e.value === "99999" || e.value === "88888"),
      ).toBe(false);
      expect(
        value.evidence.find((e) => e.label.startsWith("Marge (€) — 2026-10-08"))
          ?.value,
      ).toBeNull();
      await db
        .collection<{ _id: string }>("departmentDailyPerformance")
        .updateOne(
          { _id: referenceId },
          { $set: { "performance.sales.salesValue": "0" } },
        );
      const zero = await readDailyAnalysis(db, storeId, {
        businessDate: "2026-10-08",
      });
      expect(
        zero.evidence.find((e) => e.label.startsWith("Évolution (%) — Chiffre"))
          ?.value,
      ).toBeNull();
      expect(
        zero.evidence.some((e) => String(e.value).includes("ZERO_REFERENCE")),
      ).toBe(true);
      expect(
        zero.evidence.find((e) => e.label.startsWith("Écart (€) — Chiffre"))
          ?.id,
      ).toBe(difference?.id);
      // Revisions, rather than mutable values alone, identify canonical evidence.
      await db
        .collection<{ _id: string }>("departmentDailyPerformance")
        .updateOne(
          { _id: referenceId },
          { $set: { "performance.inputRevision": "corrected" } },
        );
      const corrected = await readDailyAnalysis(db, storeId, {
        businessDate: "2026-10-08",
      });
      expect(
        corrected.evidence.find((e) =>
          e.label.startsWith("Écart (€) — Chiffre"),
        )?.id,
      ).not.toBe(difference?.id);
      const absent = await readDailyAnalysis(db, storeId, {
        businessDate: "2026-09-01",
      });
      expect(
        absent.evidence.find(
          (e) => e.label === "Chiffres du rayon — 2026-09-01",
        )?.value,
      ).toBeNull();
      expect(
        absent.evidence.find((e) => e.label.startsWith("Écart (€) — Chiffre"))
          ?.value,
      ).toBeNull();
      await expect(
        readDailyAnalysis(db, storeId, { businessDate: "2026-02-30" }),
      ).rejects.toThrow();
    });
    it("prepares classification differences from owned canonical products without writing or revealing unavailable records", async () => {
      const f = await membershipFixture();
      const { id, ...data } = f.product;
      await db.collection("products").insertOne({
        ...data,
        _id: id,
        schemaVersion: 1,
        nature: "UNKNOWN",
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt),
        deletedAt: null,
      } as never);
      const original = await db
        .collection("products")
        .findOne({ _id: id } as never);
      const input = { productId: id, patch: { nature: "BULK" } };
      const preview = await readProductClassificationPreview(
        db,
        f.product.storeId,
        input,
      );
      expect(preview.preview?.changedFields).toEqual(["nature"]);
      expect(preview.preview?.reviewFields).toEqual([]);
      expect(preview.preview?.proposed.version).toBe(f.product.version);
      expect(preview.evidence[0]?.value).toContain(
        "aucune modification enregistrée",
      );
      expect(
        await db.collection("products").findOne({ _id: id } as never),
      ).toEqual(original);
      const foreign = await readProductClassificationPreview(
        db,
        randomUUID(),
        input,
      );
      expect(foreign.preview).toBeNull();
      expect(JSON.stringify(foreign)).not.toContain(f.product.label);
      await db.collection("products").updateOne({ _id: id } as never, {
        $set: { nature: "PACKAGED", version: f.product.version + 1 },
      });
      const revised = await readProductClassificationPreview(
        db,
        f.product.storeId,
        input,
      );
      expect(revised.preview?.reviewFields).toEqual(["nature"]);
      expect(revised.evidence[0]?.id).not.toBe(preview.evidence[0]?.id);
      await db
        .collection("products")
        .updateOne({ _id: id } as never, { $set: { deletedAt: new Date() } });
      expect(
        (await readProductClassificationPreview(db, f.product.storeId, input))
          .status,
      ).toBe("UNAVAILABLE");
    });
    it("prepares ordered batch cards without exposing foreign records or persisting unrelated packaging metadata", async () => {
      const f = await membershipFixture(),
        ids = [randomUUID(), randomUUID()];
      for (const id of ids) {
        const { id: unused, ...data } = f.product;
        void unused;
        await db.collection("products").insertOne({
          ...data,
          _id: id,
          nature: "UNKNOWN",
          packaging: {
            quantity: "1",
            unit: "KG",
            sourceLabel: "unrelated-packaging-".repeat(1000),
          },
          schemaVersion: 1,
          createdAt: new Date(data.createdAt),
          updatedAt: new Date(data.updatedAt),
          deletedAt: null,
        } as never);
      }
      const input = {
        changes: ids
          .slice()
          .reverse()
          .map((productId) => ({
            productId,
            patch: { nature: "BULK" as const },
          })),
      };
      const result = await readProductClassificationBatchPreview(
        db,
        f.product.storeId,
        input,
      );
      expect(result.status).toBe("COMPLETE");
      expect(result.items.map((item) => item.productId)).toEqual(
        ids.slice().reverse(),
      );
      const replyFixture = await fixture();
      const assistant = {
        ...replyFixture.response,
        storeId: f.product.storeId,
      };
      const cards = buildProductProposalMessages(
        assistant,
        result.items.map((item, index) => ({
          group: JSON.stringify(input),
          input: input.changes[index]!,
          result: item,
        })),
      );
      expect(cards).toHaveLength(1);
      const payload = JSON.parse(cards[0]!.text);
      expect(payload.kind).toBe("PRODUCT_CLASSIFICATION_BATCH_PROPOSAL");
      expect(payload.items).toHaveLength(2);
      expect(cards[0]!.text).not.toContain("unrelated-packaging");
      expect(
        await db
          .collection("products")
          .countDocuments({ _id: { $in: ids }, nature: "UNKNOWN" } as never),
      ).toBe(2);
      const missing = await readProductClassificationBatchPreview(
        db,
        f.product.storeId,
        {
          changes: [
            input.changes[0]!,
            { productId: randomUUID(), patch: { nature: "BULK" } },
          ],
        },
      );
      expect(missing.status).toBe("BLOCKED");
      expect(missing.items[1]?.preview).toBeNull();
      const foreign = await readProductClassificationBatchPreview(
        db,
        randomUUID(),
        input,
      );
      expect(foreign.status).toBe("BLOCKED");
      expect(JSON.stringify(foreign)).not.toContain(f.product.label);
    });
    it("retrieves older private context with stable tied-timestamp pages and revalidated files", async () => {
      const f = await fixture();
      const base = Date.parse(f.message.createdAt);
      const sourceId = randomUUID(),
        foreignSource = randomUUID();
      await db.collection<{ _id: string }>("sourceDocuments").insertMany([
        {
          _id: sourceId,
          storeId: f.message.storeId,
          sourceType: "WEEKLY_COMMERCIAL_PDF",
          originalFilename: "Original.pdf",
          mimeType: "application/pdf",
          createdAt: new Date(base - 10000),
          remoteUploadStatus: "CONFIRMED",
          deletedAt: null,
        },
        {
          _id: foreignSource,
          storeId: randomUUID(),
          sourceType: "WEEKLY_COMMERCIAL_PDF",
          originalFilename: "Secret.pdf",
          mimeType: "application/pdf",
          createdAt: new Date(base - 10000),
          remoteUploadStatus: "CONFIRMED",
          deletedAt: null,
        },
      ] as never);
      const earlier = Array.from({ length: 24 }, (_, i) => ({
        ...f.message,
        id: randomUUID(),
        text: `Ancienne discussion ${i}`,
        attachments:
          i === 0
            ? [
                {
                  sourceDocumentId: sourceId,
                  filename: "Captured.pdf",
                  mediaType: "application/pdf",
                },
                {
                  sourceDocumentId: foreignSource,
                  filename: "Unknown.pdf",
                  mediaType: "application/pdf",
                },
              ]
            : [],
        createdAt: new Date(base - 2000).toISOString(),
      }));
      const hidden = [
        {
          ...earlier[0]!,
          id: randomUUID(),
          ownerId: randomUUID(),
          text: "SECRET OWNER",
        },
        {
          ...earlier[0]!,
          id: randomUUID(),
          storeId: randomUUID(),
          text: "SECRET STORE",
        },
        {
          ...earlier[0]!,
          id: randomUUID(),
          conversationId: randomUUID(),
          text: "SECRET TOPIC",
        },
        {
          ...earlier[0]!,
          id: randomUUID(),
          role: "TOOL" as const,
          text: "SECRET TOOL",
        },
        {
          ...earlier[0]!,
          id: randomUUID(),
          createdAt: new Date(base + 1000).toISOString(),
          text: "SECRET FUTURE",
        },
      ];
      await db
        .collection<{ _id: string }>("copilotMessages")
        .insertMany([...earlier, ...hidden].map((m) => ({ _id: m.id, ...m })));
      const scope = {
        storeId: f.message.storeId,
        ownerId: f.message.ownerId,
        conversationId: f.message.conversationId,
        parentMessageId: f.message.id,
      };
      const exact = await readConversationContext(db, scope, {
        messageId: earlier[0]!.id,
        query: null,
        before: null,
        limit: 5,
      });
      expect(exact.messages.map((m) => m.id)).toEqual([earlier[0]!.id]);
      for (const messageId of [hidden[0]!.id, hidden[4]!.id, f.message.id]) {
        expect(
          (
            await readConversationContext(db, scope, {
              messageId,
              query: null,
              before: null,
              limit: 5,
            })
          ).messages,
        ).toEqual([]);
      }
      const seen = [],
        metadata = [];
      let before = null as { id: string; createdAt: string } | null;
      for (let i = 0; i < 6; i++) {
        const page = await readConversationContext(db, scope, {
          messageId: null,
          query: null,
          before,
          limit: 5,
        });
        seen.push(...page.messages);
        metadata.push(...page.sources);
        expect(page.evidence).toEqual([]);
        before = page.nextBefore;
        if (!page.hasMore) break;
      }
      expect(new Set(seen.map((m) => m.id))).toEqual(
        new Set(earlier.map((m) => m.id)),
      );
      expect(seen).toHaveLength(24);
      expect(before).toBeNull();
      expect(JSON.stringify(seen)).not.toContain("SECRET");
      expect(metadata).toContainEqual(
        expect.objectContaining({
          sourceDocumentId: sourceId,
          filename: "Original.pdf",
          status: "CONFIRMED",
        }),
      );
      expect(metadata).toContainEqual(
        expect.objectContaining({
          sourceDocumentId: foreignSource,
          filename: null,
          status: "UNAVAILABLE",
        }),
      );
      expect(JSON.stringify(metadata)).not.toContain("Secret.pdf");
      await expect(
        readConversationContext(
          db,
          { ...scope, ownerId: randomUUID() },
          { messageId: null, query: null, before: null, limit: 5 },
        ),
      ).rejects.toThrow();
      await expect(
        readConversationContext(
          db,
          { ...scope, parentMessageId: hidden[0]!.id },
          { messageId: null, query: null, before: null, limit: 5 },
        ),
      ).rejects.toThrow();
      await db
        .collection("copilotConversations")
        .updateOne({ _id: f.message.conversationId } as never, {
          $set: { status: "ARCHIVED" },
        });
      await expect(
        readConversationContext(db, scope, {
          messageId: null,
          query: null,
          before: null,
          limit: 5,
        }),
      ).rejects.toThrow();
    });
    it("searches literal historical passages, excludes corrected answers and keeps whole oversized messages pageable", async () => {
      const f = await fixture();
      const base = Date.parse(f.message.createdAt);
      const old = {
        ...f.message,
        attachments: [],
        id: randomUUID(),
        text: "ancienne contrainte [TG.*]",
        createdAt: new Date(base - 5000).toISOString(),
      };
      const answer = {
        ...old,
        id: randomUUID(),
        role: "ASSISTANT" as const,
        replyToMessageId: old.id,
      };
      const correction = {
        ...old,
        id: randomUUID(),
        supersedesMessageId: old.id,
        text: "nouvelle contrainte [TG.*]",
        createdAt: new Date(base - 4000).toISOString(),
      };
      const other = { ...old, id: randomUUID(), text: "autre TG NON LITERAL" };
      const big = Array.from({ length: 2 }, (_, i) => ({
        ...old,
        id: randomUUID(),
        text: String(i).repeat(16000),
        createdAt: new Date(base - 1000 - i * 1000).toISOString(),
      }));
      await db.collection<{ _id: string }>("copilotMessages").insertMany(
        [old, answer, correction, other, ...big].map((m) => ({
          _id: m.id,
          ...m,
        })),
      );
      const scope = {
        storeId: f.message.storeId,
        ownerId: f.message.ownerId,
        conversationId: f.message.conversationId,
        parentMessageId: f.message.id,
      };
      const found = await readConversationContext(db, scope, {
        messageId: null,
        query: "[tg.*]",
        before: null,
        limit: 5,
      });
      expect(found.messages.map((m) => m.id)).toEqual([correction.id]);
      expect(found.hasMore).toBe(false);
      const page = await readConversationContext(db, scope, {
        messageId: null,
        query: null,
        before: null,
        limit: 5,
      });
      expect(page.messages.map((m) => m.id)).toEqual([big[0]!.id]);
      expect(page.messages[0]!.text).toHaveLength(16000);
      expect(page.hasMore).toBe(true);
      const next = await readConversationContext(db, scope, {
        messageId: null,
        query: null,
        before: page.nextBefore,
        limit: 5,
      });
      expect(next.messages.some((m) => m.id === big[1]!.id)).toBe(true);
      expect(next.messages.some((m) => m.id === big[0]!.id)).toBe(false);
      expect(JSON.stringify(next)).not.toContain(old.text);
    });
    it("bounds private generation history and excludes other topics, actors and later messages", async () => {
      const f = await fixture();
      const base = Date.parse(f.message.createdAt);
      const previous = Array.from({ length: 22 }, (_, index) => ({
        ...f.message,
        id: randomUUID(),
        text: `Échange ${index}`,
        createdAt: new Date(base - (22 - index) * 1000).toISOString(),
      }));
      const hidden = [
        { ...previous[0]!, id: randomUUID(), ownerId: randomUUID() },
        { ...previous[0]!, id: randomUUID(), storeId: randomUUID() },
        { ...previous[0]!, id: randomUUID(), conversationId: randomUUID() },
        { ...previous[0]!, id: randomUUID(), role: "TOOL" as const },
        {
          ...previous[0]!,
          id: randomUUID(),
          createdAt: new Date(base + 1000).toISOString(),
        },
      ];
      await db.collection<{ _id: string }>("copilotMessages").insertMany(
        [...previous, ...hidden].map((message) => ({
          _id: message.id,
          ...message,
        })),
      );
      const history = await readConversationGenerationHistory(db, f.message);
      expect(history.messages.map((message) => message.id)).toEqual(
        previous.slice(2).map((message) => message.id),
      );
      expect(history.earlierMessagesOmitted).toBe(true);
      const recent = previous.at(-1)!;
      await db
        .collection("copilotMessages")
        .updateOne({ id: recent.id }, { $set: { text: "a".repeat(16000) } });
      await db
        .collection("copilotMessages")
        .updateOne(
          { id: previous.at(-2)!.id },
          { $set: { text: "b".repeat(16000) } },
        );
      const bounded = await readConversationGenerationHistory(db, f.message);
      expect(bounded.messages).toHaveLength(1);
      expect(bounded.messages[0]!.text).toHaveLength(16000);
      expect(bounded.earlierMessagesOmitted).toBe(true);
    });
    it("omits corrected private questions and their answers without applying foreign or future corrections", async () => {
      const f = await fixture();
      const base = Date.parse(f.message.createdAt);
      const old = {
        ...f.message,
        id: randomUUID(),
        text: "Ancienne pratique",
        createdAt: new Date(base - 4000).toISOString(),
      };
      const answer = {
        ...old,
        id: randomUUID(),
        role: "ASSISTANT" as const,
        replyToMessageId: old.id,
        text: "Réponse ancienne",
      };
      const retained = {
        ...old,
        id: randomUUID(),
        text: "Contrainte conservée",
      };
      const correction = {
        ...old,
        id: randomUUID(),
        supersedesMessageId: old.id,
        text: "Pratique corrigée",
        createdAt: new Date(base - 2000).toISOString(),
      };
      const hidden = [
        {
          ...correction,
          id: randomUUID(),
          ownerId: randomUUID(),
          supersedesMessageId: retained.id,
        },
        {
          ...correction,
          id: randomUUID(),
          storeId: randomUUID(),
          supersedesMessageId: retained.id,
        },
        {
          ...correction,
          id: randomUUID(),
          conversationId: randomUUID(),
          supersedesMessageId: retained.id,
        },
        {
          ...correction,
          id: randomUUID(),
          supersedesMessageId: retained.id,
          createdAt: new Date(base + 1000).toISOString(),
        },
      ];
      await db.collection<{ _id: string }>("copilotMessages").insertMany(
        [old, answer, retained, correction, ...hidden].map((m) => ({
          _id: m.id,
          ...m,
        })),
      );
      const history = await readConversationGenerationHistory(db, f.message);
      expect(new Set(history.messages.map((m) => m.id))).toEqual(
        new Set([retained.id, correction.id]),
      );
      expect(history.earlierMessagesOmitted).toBe(true);
      expect(JSON.stringify(history)).not.toContain(old.text);
      expect(JSON.stringify(history)).not.toContain(answer.text);
    });
    it("keeps only deduplicated recent source references from included private messages, with current files taking precedence", async () => {
      const f = await fixture();
      const base = Date.parse(f.message.createdAt);
      const refs = Array.from({ length: 12 }, () => ({
        sourceDocumentId: randomUUID(),
        filename: "Ancien.pdf",
        mediaType: "application/pdf",
      }));
      const earlier = Array.from({ length: 12 }, (_, index) => ({
        ...f.message,
        id: randomUUID(),
        text: "Discussion du document",
        attachments: [refs[index]!, ...f.message.attachments],
        createdAt: new Date(base - (12 - index) * 1000).toISOString(),
      }));
      const hidden = {
        ...earlier[0]!,
        id: randomUUID(),
        ownerId: randomUUID(),
        attachments: [{ ...refs[0]!, sourceDocumentId: randomUUID() }],
      };
      await db.collection<{ _id: string }>("copilotMessages").insertMany(
        [...earlier, hidden].map((message) => ({
          _id: message.id,
          ...message,
        })),
      );
      const history = await readConversationGenerationHistory(db, f.message);
      expect(
        history.recentAttachmentReferences.map((ref) => ref.sourceDocumentId),
      ).toEqual(
        refs
          .slice(2)
          .reverse()
          .map((ref) => ref.sourceDocumentId),
      );
      expect(history.recentSourcesOmitted).toBe(true);
      await db
        .collection("copilotMessages")
        .updateOne(
          { id: earlier.at(-1)!.id },
          { $set: { text: "a".repeat(16000) } },
        );
      await db
        .collection("copilotMessages")
        .updateOne(
          { id: earlier.at(-2)!.id },
          { $set: { text: "b".repeat(16000) } },
        );
      const bounded = await readConversationGenerationHistory(db, f.message);
      expect(bounded.recentAttachmentReferences).toEqual([refs.at(-1)!]);
      expect(bounded.earlierMessagesOmitted).toBe(true);
      expect(bounded.recentSourcesOmitted).toBe(false);
    });
    it("commits server proposal TOOL records atomically with a private reply and replays without duplicates", async () => {
      const f = await fixture(),
        data = await membershipFixture();
      const before = {
        ...data.product,
        storeId: f.authority.storeId,
        nature: "UNKNOWN" as const,
      };
      const input = {
        productId: before.id,
        patch: { nature: "BULK" as const },
      };
      const previews = [
        {
          input,
          result: {
            productId: before.id,
            status: "PREVIEW" as const,
            preview: compareProductClassification(before, input.patch),
            evidence: [
              {
                id: "proposal-evidence",
                sourceType: "DATA_QUALITY" as const,
                sourceId: before.id,
                sourceVersion: before.version,
                label: "Aperçu",
                value: "Non enregistré",
                factKind: "QUALITY" as const,
              },
            ],
          },
        },
      ];
      const [proposal] = buildProductProposalMessages(f.response, previews);
      expect(buildProductProposalMessages(f.response, previews)[0]?.id).toBe(
        proposal!.id,
      );
      const session = client.startSession(),
        changes = createMongoSyncChangeService();
      try {
        const write = async () => {
          await appendCopilotResponse(
            { database: db, session },
            f.authority,
            f.response,
            changes,
          );
          await appendCopilotToolRecord(
            { database: db, session },
            f.authority,
            proposal!,
            changes,
          );
        };
        await expect(
          session.withTransaction(async () => {
            await write();
            throw Error("rollback proposal");
          }),
        ).rejects.toThrow();
        expect(
          await db
            .collection("copilotMessages")
            .countDocuments({ id: { $in: [f.response.id, proposal!.id] } }),
        ).toBe(0);
        await session.withTransaction(write);
        await session.withTransaction(write);
        expect(
          await db
            .collection("copilotMessages")
            .countDocuments({ id: { $in: [f.response.id, proposal!.id] } }),
        ).toBe(2);
        await expect(
          session.withTransaction(() =>
            appendCopilotToolRecord(
              { database: db, session },
              { ...f.authority, ownerId: randomUUID() },
              proposal!,
              changes,
            ),
          ),
        ).rejects.toThrow("FORBIDDEN");
      } finally {
        await session.endSession();
      }
    });
    it("rolls back both reply and change, then persists exactly once across retry", async () => {
      const f = await fixture(),
        session = client.startSession(),
        changes = createMongoSyncChangeService();
      try {
        await expect(
          session.withTransaction(async () => {
            await appendCopilotResponse(
              { database: db, session },
              f.authority,
              f.response,
              changes,
            );
            throw new Error("injected rollback");
          }),
        ).rejects.toThrow("injected rollback");
        expect(
          await db
            .collection<{ _id: string }>("copilotMessages")
            .findOne({ _id: f.response.id }),
        ).toBeNull();
        expect(
          await db
            .collection("syncChanges")
            .countDocuments({ entityId: f.response.id }),
        ).toBe(0);
        const first = await session.withTransaction(() =>
          appendCopilotResponse(
            { database: db, session },
            f.authority,
            f.response,
            changes,
          ),
        );
        expect(first!.alreadyApplied).toBe(false);
        const retry = await session.withTransaction(() =>
          appendCopilotResponse(
            { database: db, session },
            f.authority,
            f.response,
            changes,
          ),
        );
        expect(retry!.alreadyApplied).toBe(true);
        expect(
          await db
            .collection("syncChanges")
            .countDocuments({ entityId: f.response.id }),
        ).toBe(1);
        await expect(
          session.withTransaction(() =>
            appendCopilotResponse(
              { database: db, session },
              { ...f.authority, canRespond: false },
              f.response,
              changes,
            ),
          ),
        ).rejects.toThrow("COPILOT_REPLY_ACCESS_INVALID");
      } finally {
        await session.endSession();
      }
    });
    it("concurrent retries commit one reply and one change", async () => {
      const f = await fixture(),
        changes = createMongoSyncChangeService();
      const sessions = [client.startSession(), client.startSession()];
      try {
        const results = await Promise.all(
          sessions.map((session) =>
            session.withTransaction(() =>
              appendCopilotResponse(
                { database: db, session },
                f.authority,
                f.response,
                changes,
              ),
            ),
          ),
        );
        expect(results.filter((r) => !r!.alreadyApplied)).toHaveLength(1);
        expect(
          await db
            .collection("syncChanges")
            .countDocuments({ entityId: f.response.id }),
        ).toBe(1);
      } finally {
        await Promise.all(sessions.map((session) => session.endSession()));
      }
    });
    it("rejects a mismatched persisted parent identity before loading sources or calling the provider", async () => {
      const f = await fixture(),
        generate = vi.fn(),
        loadContext = vi.fn();
      await db
        .collection("copilotMessages")
        .updateOne({ _id: f.message.id } as never, {
          $set: { id: randomUUID() },
        });
      await expect(
        runCopilotTurn(
          {
            db,
            provider: { model: null, generate } as CopilotAiProvider,
            authorize: async () => f.authority,
            loadContext,
          },
          {
            replyId: f.response.id,
            conversationId: f.conversation.id,
            userMessageId: f.message.id,
          },
        ),
      ).rejects.toMatchObject({ code: "PARENT_INVALID" });
      expect(generate).not.toHaveBeenCalled();
      expect(loadContext).not.toHaveBeenCalled();
    });
    it.each([false, true])(
      "persists generated proposal cards even after narrative grounding failure and restores cached retries (%s)",
      async (badNarrative) => {
        const f = await fixture(),
          data = await membershipFixture();
        const before = {
          ...data.product,
          storeId: f.storeId,
          nature: "UNKNOWN" as const,
        };
        const input = {
          productId: before.id,
          patch: { nature: "BULK" as const },
        };
        const evidence = {
          id: "generated-preview",
          sourceType: "DATA_QUALITY" as const,
          sourceId: before.id,
          sourceVersion: before.version,
          label: "Correction proposée",
          value: "Aucune modification enregistrée.",
          factKind: "QUALITY" as const,
        };
        const generate = vi.fn(async () => ({
          output: {
            language: "fr-FR",
            summary: badNarrative
              ? "999 euros"
              : "Voici une correction proposée, à confirmer.",
            facts: [{ evidenceId: evidence.id }],
            interpretation: [],
            recommendations: [],
            questions: [],
          },
          metadata: {
            requestedModel: "test",
            resolvedModel: "test",
            responseId: "test-proposal",
            inputTokens: null,
            outputTokens: null,
          },
          toolEvidence: [evidence],
          productPreviews: [
            {
              input,
              result: {
                productId: before.id,
                status: "PREVIEW",
                preview: compareProductClassification(before, input.patch),
                evidence: [evidence],
              },
            },
          ],
        }));
        const context = detectCopilotConflicts({
          batch: scoreCopilotPriorities({
            storeId: f.storeId,
            evaluatedAt: f.message.createdAt,
            candidates: [],
          }),
          intents: [],
        });
        const dependencies = {
          db,
          provider: { model: "test", generate } as CopilotAiProvider,
          authorize: async () => f.authority,
          loadContext: async () => context,
        };
        const turn = {
          replyId: f.response.id,
          userMessageId: f.message.id,
          conversationId: f.conversation.id,
        };
        const first = await runCopilotTurn(dependencies, turn);
        expect(first.alreadyApplied).toBe(false);
        expect(first.message.text).toContain(
          badNarrative ? "Rien n’a encore été modifié" : "à confirmer",
        );
        expect(first.message.text).not.toContain("999");
        const cards = await db
          .collection("copilotMessages")
          .find({ conversationId: f.conversation.id, role: "TOOL" })
          .toArray();
        expect(cards).toHaveLength(1);
        expect(cards[0]?.replyToMessageId).toBe(f.message.id);
        expect(JSON.parse(String(cards[0]?.text)).assistantMessageId).toBe(
          f.response.id,
        );
        expect(
          await db
            .collection("syncChanges")
            .countDocuments({ entityId: cards[0]?.id }),
        ).toBe(1);
        expect((await runCopilotTurn(dependencies, turn)).alreadyApplied).toBe(
          true,
        );
        expect(generate).toHaveBeenCalledTimes(1);
        expect(
          await db.collection("copilotMessages").countDocuments({
            conversationId: f.conversation.id,
            role: "TOOL",
          }),
        ).toBe(1);
      },
    );
    it("persists and restores versioned private context checkpoints across a long conversation without business writes", async () => {
      const f = await fixture();
      const base = Date.parse(f.message.createdAt);
      const old = {
        ...f.message,
        id: randomUUID(),
        attachments: [],
        text: "Je veux préparer quatre TG chaque semaine.\n\nLe passage doit rester libre.",
        createdAt: new Date(base - 60000).toISOString(),
      };
      const older = Array.from({ length: 24 }, (_, i) => ({
        ...old,
        id: randomUUID(),
        text: `Échange ${i}`,
        createdAt: new Date(base - 50000 + i * 1000).toISOString(),
      }));
      await db
        .collection<{ _id: string }>("copilotMessages")
        .insertMany([old, ...older].map((m) => ({ _id: m.id, ...m })));
      const context = detectCopilotConflicts({
        batch: scoreCopilotPriorities({
          storeId: f.storeId,
          evaluatedAt: f.message.createdAt,
          candidates: [],
        }),
        intents: [],
      });
      const draft = {
        notes: [
          {
            topic: "GOAL" as const,
            sourceMessageId: old.id,
            quote: "Je veux préparer quatre TG chaque semaine.",
          },
        ],
      };
      const generate = vi.fn(async (_request: CopilotGenerationRequest) => ({
        output: {
          language: "fr-FR",
          summary: "Je poursuis la préparation.",
          facts: [],
          interpretation: [],
          recommendations: [],
          questions: [],
        },
        metadata: {
          requestedModel: "test",
          resolvedModel: "test",
          responseId: _request.requestId,
          inputTokens: null,
          outputTokens: null,
        },
        contextCheckpoint: draft,
      }));
      const dependencies = {
        db,
        provider: { model: "test", generate } as CopilotAiProvider,
        authorize: async () => f.authority,
        loadContext: async () => context,
        now: () => new Date(base + 1000),
      };
      const turn = {
        replyId: f.response.id,
        userMessageId: f.message.id,
        conversationId: f.conversation.id,
      };
      await runCopilotTurn(dependencies, turn);
      await runCopilotTurn(dependencies, turn);
      expect(generate).toHaveBeenCalledTimes(1);
      let snapshots = await db
        .collection("copilotMessages")
        .find({ conversationId: f.conversation.id, role: "TOOL" })
        .toArray();
      expect(snapshots).toHaveLength(1);
      const firstId = String(snapshots[0]!.id);
      expect(JSON.parse(String(snapshots[0]!.text))).toMatchObject({
        kind: "CONTEXT_CHECKPOINT",
        schemaVersion: 1,
        previousCheckpointId: null,
        partial: true,
      });
      const later = {
        ...f.message,
        id: randomUUID(),
        text: "Continuons la préparation.",
        attachments: [
          {
            sourceDocumentId: randomUUID(),
            filename: "Nouvelle-source.pdf",
            mediaType: "application/pdf",
          },
        ],
        createdAt: new Date(base + 2000).toISOString(),
      };
      await db
        .collection<{ _id: string }>("copilotMessages")
        .insertOne({ _id: later.id, ...later });
      const restored = await readConversationCheckpoint(db, later);
      expect(restored.checkpoint).toMatchObject({
        status: "AVAILABLE",
        checkpointId: firstId,
        content: { notes: [expect.objectContaining(draft.notes[0]!)] },
      });
      expect(
        (
          await readConversationCheckpoint(db, {
            ...later,
            ownerId: randomUUID(),
          })
        ).checkpoint.status,
      ).toBe("ABSENT");
      expect(
        (
          await readConversationCheckpoint(db, {
            ...later,
            conversationId: randomUUID(),
          })
        ).checkpoint.status,
      ).toBe("ABSENT");
      draft.notes.push({
        topic: "GOAL",
        sourceMessageId: old.id,
        quote: "Le passage doit rester libre.",
      });
      await runCopilotTurn(
        { ...dependencies, now: () => new Date(base + 3000) },
        { ...turn, replyId: randomUUID(), userMessageId: later.id },
      );
      expect(generate.mock.calls[1]?.[0]).toMatchObject({
        conversationCheckpoint: { status: "AVAILABLE", checkpointId: firstId },
      });
      snapshots = await db
        .collection("copilotMessages")
        .find({ conversationId: f.conversation.id, role: "TOOL" })
        .sort({ createdAt: 1 })
        .toArray();
      expect(snapshots).toHaveLength(2);
      const latestContent = JSON.parse(String(snapshots[1]!.text));
      expect(latestContent.sourceDocumentIds).toContain(
        f.message.attachments[0]!.sourceDocumentId,
      );
      expect(latestContent.sourceDocumentIds).toContain(
        later.attachments[0]!.sourceDocumentId,
      );
      expect(JSON.parse(String(snapshots[1]!.text)).previousCheckpointId).toBe(
        firstId,
      );
      const unchangedParent = {
        ...later,
        id: randomUUID(),
        text: "Poursuivons.",
        createdAt: new Date(base + 3500).toISOString(),
      };
      await db
        .collection<{ _id: string }>("copilotMessages")
        .insertOne({ _id: unchangedParent.id, ...unchangedParent });
      await runCopilotTurn(
        { ...dependencies, now: () => new Date(base + 3600) },
        { ...turn, replyId: randomUUID(), userMessageId: unchangedParent.id },
      );
      expect(
        await db
          .collection("copilotMessages")
          .countDocuments({ conversationId: f.conversation.id, role: "TOOL" }),
      ).toBe(2);
      expect(
        await db
          .collection("syncChanges")
          .countDocuments({ entityId: firstId }),
      ).toBe(1);
      expect(
        await db
          .collection("copilotKnowledge")
          .countDocuments({ storeId: f.storeId }),
      ).toBe(0);
      expect(
        await db.collection("copilotMessages").countDocuments({
          _id: { $in: [old.id, ...older.map((m) => m.id)] },
        } as never),
      ).toBe(25);
      // An unrelated paragraph changed: the saved quote still matches but its full source fingerprint does not.
      await db
        .collection("copilotMessages")
        .updateOne({ _id: old.id } as never, {
          $set: { text: old.text + "\n\nUne nouvelle contrainte." },
        });
      const newestParent = {
        ...later,
        createdAt: new Date(base + 4000).toISOString(),
      };
      expect(
        (await readConversationCheckpoint(db, newestParent)).checkpoint.status,
      ).toBe("STALE");
      await db
        .collection("copilotMessages")
        .updateOne({ _id: old.id } as never, { $set: { text: old.text } });
      expect(
        (
          await readConversationCheckpoint(db, {
            ...newestParent,
            supersedesMessageId: old.id,
          })
        ).checkpoint.status,
      ).toBe("STALE");
      // A future correction does not retroactively change an earlier turn's context.
      const correction = {
        ...later,
        id: randomUUID(),
        supersedesMessageId: old.id,
        text: "Mon objectif a changé.",
        createdAt: new Date(base + 5000).toISOString(),
      };
      await db
        .collection<{ _id: string }>("copilotMessages")
        .insertOne({ _id: correction.id, ...correction });
      expect(
        (await readConversationCheckpoint(db, newestParent)).checkpoint.status,
      ).toBe("AVAILABLE");
      expect(
        (await readConversationCheckpoint(db, correction)).checkpoint.status,
      ).toBe("STALE");
    });
    it("rolls back context checkpoints with invented or foreign source paragraphs together with the reply", async () => {
      for (const foreign of [false, true]) {
        const f = await fixture();
        const other = { ...f.message, id: randomUUID(), ownerId: randomUUID() };
        await db
          .collection<{ _id: string }>("copilotMessages")
          .insertOne({ _id: other.id, ...other });
        const generate = vi.fn(async (_request: CopilotGenerationRequest) => ({
          output: {
            language: "fr-FR",
            summary: "Je poursuis la préparation.",
            facts: [],
            interpretation: [],
            recommendations: [],
            questions: [],
          },
          metadata: {
            requestedModel: "test",
            resolvedModel: "test",
            responseId: _request.requestId,
            inputTokens: null,
            outputTokens: null,
          },
          contextCheckpoint: {
            notes: [
              {
                topic: "GOAL",
                sourceMessageId: foreign ? other.id : f.message.id,
                quote: foreign ? other.text : "Une citation inventée",
              },
            ],
          },
        }));
        const context = detectCopilotConflicts({
          batch: scoreCopilotPriorities({
            storeId: f.storeId,
            evaluatedAt: f.message.createdAt,
            candidates: [],
          }),
          intents: [],
        });
        await expect(
          runCopilotTurn(
            {
              db,
              provider: { model: "test", generate } as CopilotAiProvider,
              authorize: async () => f.authority,
              loadContext: async () => context,
            },
            {
              replyId: f.response.id,
              userMessageId: f.message.id,
              conversationId: f.conversation.id,
            },
          ),
        ).rejects.toThrow("QUOTE");
        expect(
          await db.collection("copilotMessages").countDocuments({
            conversationId: f.conversation.id,
            role: { $in: ["ASSISTANT", "TOOL"] },
          }),
        ).toBe(0);
        expect(
          await db
            .collection("syncChanges")
            .countDocuments({ entityId: f.response.id }),
        ).toBe(0);
      }
    });
    it("persists an opted-in source-grounded memory proposal once without creating knowledge, and rolls back invented quotations", async () => {
      for (const invalid of [false, true]) {
        const f = await fixture();
        const suggestion = {
          statement: "La casse est comptabilisée à la date de saisie.",
          sources: [
            {
              messageId: f.message.id,
              quote: invalid ? "Citation inventée" : f.message.text,
            },
          ],
        };
        const context = detectCopilotConflicts({
          batch: scoreCopilotPriorities({
            storeId: f.storeId,
            evaluatedAt: f.message.createdAt,
            candidates: [],
          }),
          intents: [],
        });
        const generate = vi.fn(async () => ({
          output: {
            language: "fr-FR",
            summary: "Je peux proposer de retenir cette pratique.",
            facts: [],
            interpretation: [],
            recommendations: [],
            questions: [],
          },
          metadata: {
            requestedModel: "test",
            resolvedModel: "test",
            responseId: "memory-test",
            inputTokens: null,
            outputTokens: null,
          },
          knowledgeSuggestions: [suggestion],
        }));
        const dependencies = {
          db,
          provider: { model: "test", generate } as CopilotAiProvider,
          authorize: async () => f.authority,
          loadContext: async () => context,
          allowMemorySuggestions: true,
        };
        const turn = {
          replyId: f.response.id,
          userMessageId: f.message.id,
          conversationId: f.conversation.id,
        };
        if (invalid) {
          await expect(runCopilotTurn(dependencies, turn)).rejects.toThrow(
            "QUOTE",
          );
          expect(
            await db.collection("copilotMessages").countDocuments({
              conversationId: f.conversation.id,
              role: { $in: ["ASSISTANT", "TOOL"] },
            }),
          ).toBe(0);
        } else {
          await runCopilotTurn(dependencies, turn);
          await runCopilotTurn(dependencies, turn);
          expect(generate).toHaveBeenCalledTimes(1);
          const tools = await db
            .collection("copilotMessages")
            .find({ conversationId: f.conversation.id, role: "TOOL" })
            .toArray();
          expect(tools).toHaveLength(1);
          expect(JSON.parse(String(tools[0]!.text))).toMatchObject({
            kind: "KNOWLEDGE_SUGGESTION",
            knowledgeId: tools[0]!.id,
          });
        }
        expect(
          await db
            .collection("copilotKnowledge")
            .countDocuments({ storeId: f.storeId, ownerId: f.ownerId }),
        ).toBe(0);
      }
    });
    it("persists a generated private question and revalidates its original context for a later answer", async () => {
      const f = await fixture();
      const question = {
        title: "Préciser la période",
        reason: "Les dates manquent.",
        fields: [
          {
            key: "start_date",
            label: "Début",
            type: "DATE" as const,
            required: true,
          },
        ],
      };
      const context = detectCopilotConflicts({
        batch: scoreCopilotPriorities({
          storeId: f.storeId,
          evaluatedAt: f.message.createdAt,
          candidates: [],
        }),
        intents: [],
      });
      const generate = vi.fn(async () => ({
        output: {
          language: "fr-FR",
          summary: "Précisons la période à examiner.",
          facts: [],
          interpretation: [],
          recommendations: [],
          questions: ["Quelle période souhaites-tu examiner ?"],
        },
        metadata: {
          requestedModel: "test",
          resolvedModel: "test",
          responseId: "info-test",
          inputTokens: null,
          outputTokens: null,
        },
        informationRequests: [question],
      }));
      const dependencies = {
        db,
        provider: { model: "test", generate } as CopilotAiProvider,
        authorize: async () => f.authority,
        loadContext: async () => context,
      };
      const turn = {
        replyId: f.response.id,
        userMessageId: f.message.id,
        conversationId: f.conversation.id,
      };
      await runCopilotTurn(dependencies, turn);
      await runCopilotTurn(dependencies, turn);
      const tools = await db
        .collection("copilotMessages")
        .find({ conversationId: f.conversation.id, role: "TOOL" })
        .toArray();
      expect(tools).toHaveLength(1);
      expect(generate).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(String(tools[0]!.text));
      expect(payload.kind).toBe("MISSING_INFORMATION_REQUEST");
      expect(payload.definition.id).toBe(tools[0]!.id);
      expect(
        buildInformationRequestMessages(f.response, [question])[0]!.id,
      ).toBe(tools[0]!.id);
      const answer = {
        ...f.message,
        id: randomUUID(),
        replyToMessageId: String(tools[0]!.id),
        text: "Réponse — Début : 14/10/2026",
      };
      const original = await readAnsweredInformationContext(db, answer);
      expect(original?.originalQuestion).toBe(f.message.text);
      expect(original?.fields[0]?.type).toBe("DATE");
      expect(original?.superseded).toBe(false);
      expect(
        await readAnsweredInformationContext(db, {
          ...answer,
          ownerId: randomUUID(),
        }),
      ).toBeUndefined();
      const superseding = {
        ...f.message,
        id: randomUUID(),
        supersedesMessageId: f.message.id,
        text: "Une demande corrigée",
      };
      await db
        .collection("copilotMessages")
        .insertOne({ _id: superseding.id, ...superseding } as never);
      expect(
        (await readAnsweredInformationContext(db, answer))?.superseded,
      ).toBe(true);
      await db
        .collection("copilotMessages")
        .updateOne({ _id: f.message.id } as never, {
          $set: { text: "a".repeat(16000) },
        });
      const omitted = await readAnsweredInformationContext(db, answer);
      expect(omitted?.originalQuestion).toBeNull();
      expect(omitted?.originalQuestionOmitted).toBe(true);
    });
    it("runs generation outside transaction and restores persisted reply without a second provider call", async () => {
      const f = await fixture();
      const generate = vi
        .fn()
        .mockRejectedValue(
          new CopilotAiError("COPILOT_AI_NOT_CONFIGURED", false),
        );
      const context = detectCopilotConflicts({
        batch: scoreCopilotPriorities({
          storeId: f.storeId,
          evaluatedAt: f.message.createdAt,
          candidates: [],
        }),
        intents: [],
      });
      const authorize = vi.fn(async () => f.authority);
      const loadContext = vi.fn(async () => context);
      const dependencies = {
        db,
        provider: { model: null, generate } as CopilotAiProvider,
        authorize,
        loadContext,
      };
      const input = {
        replyId: f.response.id,
        conversationId: f.conversation.id,
        userMessageId: f.message.id,
      };
      const first = await runCopilotTurn(dependencies, input);
      expect(first.alreadyApplied).toBe(false);
      const retry = await runCopilotTurn(dependencies, input);
      expect(retry).toEqual({ message: first.message, alreadyApplied: true });
      expect(generate).toHaveBeenCalledTimes(1);
      expect(generate.mock.calls[0]?.[0]).toMatchObject({
        history: { messages: [], earlierMessagesOmitted: false },
        recentSources: [],
        recentSourcesOmitted: false,
        attachedSources: [
          {
            sourceDocumentId: f.message.attachments[0]!.sourceDocumentId,
            status: "UNAVAILABLE",
            filename: null,
            mediaType: null,
            sourceType: null,
            registeredAt: null,
          },
        ],
      });
      expect(loadContext).toHaveBeenCalledTimes(1);
      await expect(
        runCopilotTurn(
          {
            ...dependencies,
            authorize: async () => ({ ...f.authority, canRespond: false }),
          },
          input,
        ),
      ).rejects.toThrow("ACCESS_INVALID");
      const controller = new AbortController();
      controller.abort();
      await expect(
        runCopilotTurn(dependencies, input, controller.signal),
      ).rejects.toThrow("CANCELLED");
      expect(
        await db
          .collection("syncChanges")
          .countDocuments({ entityId: input.replyId }),
      ).toBe(1);
    });
    it("blocks concurrent turn generation and allows retry after completion", async () => {
      const f = await fixture();
      const generate = vi
        .fn()
        .mockRejectedValue(
          new CopilotAiError("COPILOT_AI_NOT_CONFIGURED", false),
        );
      const context = detectCopilotConflicts({
        batch: scoreCopilotPriorities({
          storeId: f.storeId,
          evaluatedAt: f.message.createdAt,
          candidates: [],
        }),
        intents: [],
      });
      let release!: () => void, entered!: () => void;
      const ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const dependencies = {
        db,
        provider: { model: null, generate } as CopilotAiProvider,
        authorize: async () => f.authority,
        loadContext: async () => {
          entered();
          await hold;
          return context;
        },
      };
      const input = {
        replyId: f.response.id,
        conversationId: f.conversation.id,
        userMessageId: f.message.id,
      };
      const first = runCopilotTurn(dependencies, input);
      await ready;
      try {
        await expect(runCopilotTurn(dependencies, input)).rejects.toThrow(
          "IN_PROGRESS",
        );
      } finally {
        release();
      }
      await first;
      expect(generate).toHaveBeenCalledTimes(1);
      expect((await runCopilotTurn(dependencies, input)).alreadyApplied).toBe(
        true,
      );
      expect(generate).toHaveBeenCalledTimes(1);
    });
    it("expired workers cannot commit after lease takeover", async () => {
      const f = await fixture();
      const identity = {
        replyId: f.response.id,
        conversationId: f.conversation.id,
        userMessageId: f.message.id,
        storeId: f.storeId,
        ownerId: f.ownerId,
      };
      const old = await acquireTurnLease(db, identity);
      await db
        .collection<{ _id: string }>("copilotTurnLeases")
        .updateOne(
          { _id: identity.replyId },
          { $set: { expiresAt: new Date(0) } },
        );
      const current = await acquireTurnLease(db, identity);
      const session = client.startSession();
      try {
        await expect(
          session.withTransaction(() => old.fence(session)),
        ).rejects.toThrow("LEASE_EXPIRED");
        await old.release();
        await session.withTransaction(() => current.fence(session));
        await expect(
          acquireTurnLease(db, { ...identity, ownerId: randomUUID() }),
        ).rejects.toThrow("IDENTITY_CONFLICT");
      } finally {
        await session.endSession();
        await current.release();
      }
    });
    it("serves the default read-only context through authenticated HTTP with real Mongo persistence and retry", async () => {
      const f = await fixture();
      const day = buildDepartmentDailyPerformance({
        storeId: f.storeId,
        businessDate: "2026-10-01",
        computedAt: "2026-10-02T12:00:00.000Z",
        productPerformances: [],
      });
      await db
        .collection<{
          _id: string;
          storeId: string;
          date: string;
          performance: unknown;
        }>("departmentDailyPerformance")
        .insertOne({
          _id: randomUUID(),
          storeId: f.storeId,
          date: day.date,
          performance: day,
        });
      const auth = {
        requestChallenge: vi.fn(),
        verifyChallenge: vi.fn(),
        refreshSession: vi.fn(),
        logout: vi.fn(),
        authorizeStore: vi.fn(async () => ({
          storeId: f.storeId,
          userId: f.ownerId,
          deviceId: f.deviceId,
          sessionId: randomUUID(),
          storeName: "Test",
          role: "MANAGER",
        })),
      } as AuthService;
      const app = buildApp(
        parseEnvironment({ NODE_ENV: "test", COPILOT_AI_MODEL: "test-model" }),
        {
          database: {
            getDb: async () => db,
            checkHealth: async () => "connected",
            close: async () => {},
          },
          auth,
        },
      );
      const options = {
        method: "POST" as const,
        url: "/api/v1/copilot/turn",
        headers: { authorization: "Bearer test", "x-store-id": f.storeId },
        payload: {
          replyId: f.response.id,
          conversationId: f.conversation.id,
          userMessageId: f.message.id,
        },
      };
      let failure = "";
      app.addHook("onError", async (_request, _reply, error) => {
        failure = `${error.name}: ${error.message}`;
      });
      try {
        const first = await app.inject(options);
        expect(first.statusCode, failure).toBe(200);
        expect(first.json().message.text).toContain(
          "Chiffre d’affaires net (€) — 2026-10-01 : indisponible",
        );
        expect(first.json().message.replyToMessageId).toBe(f.message.id);
        const history = await app.inject({
          url: `/api/v1/copilot/history?conversationId=${f.conversation.id}`,
          headers: options.headers,
        });
        expect(history.statusCode, failure).toBe(200);
        expect(
          history
            .json()
            .messages.some(
              (message: { id: string }) => message.id === f.response.id,
            ),
        ).toBe(true);
        const retry = await app.inject(options);
        expect(retry.statusCode).toBe(200);
        expect(retry.json()).toEqual({
          message: first.json().message,
          alreadyApplied: true,
        });
        expect(
          await db
            .collection("syncChanges")
            .countDocuments({ entityId: f.response.id }),
        ).toBe(1);
      } finally {
        await app.close();
      }
    });
    it("reads scoped dated canonical evidence without converting missing values to zero", async () => {
      const storeId = randomUUID(),
        foreign = randomUUID();
      const performance = buildDepartmentDailyPerformance({
        storeId,
        businessDate: "2026-10-01",
        computedAt: "2026-10-02T12:00:00.000Z",
        productPerformances: [],
      });
      await db
        .collection<{
          _id: string;
          storeId: string;
          date: string;
          performance: unknown;
        }>("departmentDailyPerformance")
        .insertOne({
          _id: randomUUID(),
          storeId,
          date: performance.date,
          performance,
        });
      await db
        .collection<{
          _id: string;
          storeId: string;
          date: string;
          performance: unknown;
        }>("departmentDailyPerformance")
        .insertOne({
          _id: randomUUID(),
          storeId: foreign,
          date: "2026-10-12",
          performance: { ...performance, storeId: foreign, date: "2026-10-12" },
        });
      const evidence = await readLatestDepartmentEvidence(db, storeId);
      expect(evidence).toHaveLength(6);
      expect(
        evidence
          .filter((e) => e.sourceType === "KPI")
          .every((e) => e.value === null),
      ).toBe(true);
      expect(evidence.every((e) => e.label.includes("2026-10-01"))).toBe(true);
      expect(await readLatestDepartmentEvidence(db, randomUUID())).toEqual([]);
    });
  },
);
