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
      expect(year.evidence[0]?.value).toBeNull();
      expect(year.referencePeriod).toBeNull();
      expect(year.evidence).toHaveLength(2);
      const productId = randomUUID();
      await db
        .collection<{
          _id: string;
          id: string;
          storeId: string;
          label: string;
        }>("products")
        .insertOne({
          _id: productId,
          id: productId,
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
      expect(product.evidence[0]?.value).toBe("7.00");
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
          id: string;
          storeId: string;
          label: string;
          deletedAt?: string;
        }>("products")
        .insertMany([
          { _id: banana, id: banana, storeId, label: "BANANE VRAC" },
          {
            _id: pear,
            id: pear,
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
