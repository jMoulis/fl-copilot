import { createCommercialAiDraftProcessor } from "../src/commercial/ai-draft-processing.js";
import { COMMERCIAL_AI_SCHEMA_VERSION } from "@fl-copilot/domain";
import type { CommercialAiProvider } from "../src/commercial/ai-provider.js";
import { createHash } from "node:crypto";
import { createCommercialPdfPageProcessor } from "../src/commercial/pdf-page-processing.js";
import { commercialPdfFixture } from "./fixtures/commercial-pdf.js";
import {
  createMongoSourceUploadService,
  type SourceBlobMetadata,
} from "../src/uploads/source-upload-service.js";
import { randomUUID } from "node:crypto";
import { Long } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseEnvironment } from "../src/config.js";
import { createMongoDatabase } from "../src/database/mongo.js";
import type { DatabaseService } from "../src/database/types.js";
import { createMongoAuthService } from "../src/auth/service.js";
import {
  createMongoProcessedCommandService,
  type MongoCommandMutationContext,
} from "../src/sync/processed-command-service.js";
import { createMongoSyncChangeService } from "../src/sync/sync-change-service.js";
import { createMongoSyncPushService } from "../src/sync/push-service.js";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service.js";
import {
  createMongoSyncPullService,
  SyncPullCursorError,
} from "../src/sync/pull-service.js";

const testMongoUri = process.env.TEST_MONGODB_URI;
const describeWithMongo = testMongoUri ? describe : describe.skip;
const itWithMongoTransactions =
  process.env.TEST_MONGODB_TRANSACTIONS === "true" ? it : it.skip;

describeWithMongo("MongoDB infrastructure", () => {
  let database: DatabaseService;
  const databaseName = `flc_test_${randomUUID().replaceAll("-", "").slice(0, 20)}`;

  beforeAll(async () => {
    database = createMongoDatabase(
      parseEnvironment({
        NODE_ENV: "test",
        MONGODB_URI: testMongoUri,
        MONGODB_DATABASE: databaseName,
      }),
    );
    await database.getDb();
  });

  afterAll(async () => {
    const mongoDatabase = await database.getDb();
    await mongoDatabase.dropDatabase();
    await database.close();
  });

  it("creates and reads an isolated test entity", async () => {
    const mongoDatabase = await database.getDb();
    const collection = mongoDatabase.collection<{
      _id: string;
      label: string;
    }>("infrastructureTestEntities");
    const entity = { _id: randomUUID(), label: "MongoDB fonctionne" };

    await collection.insertOne(entity);

    await expect(collection.findOne({ _id: entity._id })).resolves.toEqual(
      entity,
    );
  });

  it("keeps one durable PDF workflow under concurrent completion retries", async () => {
    let blob: SourceBlobMetadata | null = null;
    const service = createMongoSourceUploadService(database, {
      createUploadUrl: async () => "https://blob.example/upload",
      head: async () => blob,
    });
    const storeId = randomUUID();
    const sourceDocumentId = randomUUID();
    const input = {
      sourceDocumentId,
      sourceType: "WEEKLY_COMMERCIAL_PDF" as const,
      filename: "week.pdf",
      mimeType: "application/pdf" as const,
      sizeBytes: 4096,
      checksum: `sha256:${"b".repeat(64)}`,
    };
    const init = await service.init(storeId, randomUUID(), input);
    blob = {
      pathname: init.objectKey,
      size: input.sizeBytes,
      contentType: input.mimeType,
      url: "https://blob.example/private.pdf",
      etag: "etag",
    };
    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        service.complete(storeId, init.uploadId, {
          checksum: input.checksum,
          sizeBytes: input.sizeBytes,
        }),
      ),
    );
    expect(results.map((result) => result.jobId)).toEqual([
      sourceDocumentId,
      sourceDocumentId,
      sourceDocumentId,
    ]);
    const db = await database.getDb();
    expect(
      await db
        .collection("commercialDocumentJobs")
        .countDocuments({ storeId, sourceDocumentId }),
    ).toBe(1);
    expect(
      await db
        .collection("sourceUploads")
        .countDocuments({ storeId, sourceDocumentId }),
    ).toBe(1);
    expect(
      await db
        .collection<{ _id: number }>("schemaMigrations")
        .countDocuments({ _id: 12 }),
    ).toBe(1);
    expect(
      await db
        .collection("commercialDocumentJobs")
        .findOne({ storeId, sourceDocumentId }),
    ).toMatchObject({
      status: "PENDING",
      stage: "TEXT_EXTRACTION",
      checksum: input.checksum,
    });
  }, 15_000);

  async function pdfSource() {
    const db = await database.getDb();
    const storeId = randomUUID();
    const sourceDocumentId = randomUUID();
    const bytes = commercialPdfFixture(["Semaine 42: Tomate < 2.99 EUR", ""]);
    const checksum = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const identity = {
      _id: sourceDocumentId,
      storeId,
      sourceDocumentId,
      checksum,
      objectKey: `private/${sourceDocumentId}.pdf`,
    };
    await db
      .collection<{ _id: string; [key: string]: unknown }>("sourceDocuments")
      .insertOne({
        ...identity,
        sourceType: "WEEKLY_COMMERCIAL_PDF",
        remoteUploadStatus: "CONFIRMED",
      });
    await db
      .collection<{ _id: string; [key: string]: unknown }>(
        "commercialDocumentJobs",
      )
      .insertOne({
        ...identity,
        pipelineVersion: "commercial-pdf.v1",
        status: "PENDING",
        stage: "TEXT_EXTRACTION",
        attemptCount: 0,
        createdAt: new Date(),
      });
    return { db, storeId, sourceDocumentId, bytes };
  }
  it("claims one source concurrently, preserves page references, and recovers an expired lease without duplicating pages", async () => {
    const { db, storeId, sourceDocumentId, bytes } = await pdfSource();
    let reads = 0;
    const processor = createCommercialPdfPageProcessor(database, undefined, {
      read: async () => {
        reads++;
        return bytes;
      },
    });
    expect(
      await processor.process(randomUUID(), sourceDocumentId),
    ).toMatchObject({ status: "SKIPPED" });
    const results = await Promise.all([
      processor.process(storeId, sourceDocumentId),
      processor.process(storeId, sourceDocumentId),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([
      "SKIPPED",
      "TEXT_READY",
    ]);
    expect(reads).toBe(1);
    const pages = await db
      .collection("commercialDocumentPages")
      .find({ storeId, sourceDocumentId })
      .sort({ pageNumber: 1 })
      .toArray();
    expect(pages).toHaveLength(2);
    expect(pages[0]).toMatchObject({
      pageNumber: 1,
      text: "Semaine 42: Tomate < 2.99 EUR",
    });
    expect(pages[1]).toMatchObject({
      pageNumber: 2,
      text: "",
      warnings: ["NO_EXTRACTABLE_TEXT"],
    });
    expect(
      await db
        .collection("commercialDocumentJobs")
        .findOne({ storeId, sourceDocumentId }),
    ).toMatchObject({
      status: "TEXT_READY",
      stage: "AI_EXTRACTION",
      pageCount: 2,
      textPageCount: 1,
    });
    await db.collection("commercialDocumentJobs").updateOne(
      { storeId, sourceDocumentId },
      {
        $set: {
          status: "PROCESSING",
          stage: "TEXT_EXTRACTION",
          leaseToken: "interrupted",
          leaseExpiresAt: new Date(0),
        },
      },
    );
    expect(await processor.process(storeId, sourceDocumentId)).toMatchObject({
      status: "TEXT_READY",
    });
    expect(
      await db
        .collection("commercialDocumentPages")
        .find({ storeId, sourceDocumentId })
        .sort({ pageNumber: 1 })
        .toArray(),
    ).toEqual(pages);
  }, 20_000);
  it("rejects changed binary bytes before storing page text", async () => {
    const { db, storeId, sourceDocumentId } = await pdfSource();
    const processor = createCommercialPdfPageProcessor(database, undefined, {
      read: async () => new TextEncoder().encode("changed"),
    });
    expect(await processor.process(storeId, sourceDocumentId)).toMatchObject({
      status: "FAILED",
      errorCode: "PDF_SOURCE_CHECKSUM_MISMATCH",
    });
    expect(
      await db
        .collection("commercialDocumentPages")
        .countDocuments({ storeId, sourceDocumentId }),
    ).toBe(0);
    expect(
      await db
        .collection("commercialDocumentJobs")
        .findOne({ storeId, sourceDocumentId }),
    ).toMatchObject({
      status: "FAILED",
      errorCode: "PDF_SOURCE_CHECKSUM_MISMATCH",
    });
  });
  it("backs off a temporary storage failure and recovers using the same source", async () => {
    const { db, storeId, sourceDocumentId, bytes } = await pdfSource();
    let current = new Date();
    let fail = true;
    const processor = createCommercialPdfPageProcessor(
      database,
      undefined,
      {
        read: async () => {
          if (fail) {
            fail = false;
            throw new Error("temporary storage failure");
          }
          return bytes;
        },
      },
      () => current,
    );
    await expect(processor.process(storeId, sourceDocumentId)).rejects.toThrow(
      "PDF_PROCESSING_TEMPORARILY_UNAVAILABLE",
    );
    expect(
      await db
        .collection("commercialDocumentJobs")
        .findOne({ storeId, sourceDocumentId }),
    ).toMatchObject({
      status: "PENDING",
      errorCode: "PDF_PROCESSING_TEMPORARILY_UNAVAILABLE",
    });
    current = new Date(current.getTime() + 6 * 60_000);
    expect(
      (await processor.pending()).some(
        (item) => item.sourceDocumentId === sourceDocumentId,
      ),
    ).toBe(true);
    expect(await processor.process(storeId, sourceDocumentId)).toMatchObject({
      status: "TEXT_READY",
    });
  }, 20_000);

  async function commercialAiSource() {
    const fixture = await pdfSource();
    await createCommercialPdfPageProcessor(database, undefined, {
      read: async () => fixture.bytes,
    }).process(fixture.storeId, fixture.sourceDocumentId);
    return fixture;
  }
  function aiProvider(
    result?: unknown,
  ): CommercialAiProvider & { calls: number } {
    return {
      model: "openai/gpt-6.1-sol",
      calls: 0,
      async extract(target, pages) {
        this.calls++;
        const span = pages.find((page) => page.pageNumber === target)!
          .spans[0]!;
        const evidence = {
          pageNumber: target,
          spanIndices: [span.index],
          quote: span.text,
        };
        return {
          output: result ?? {
            blocks: [
              {
                kind: "OFFER",
                label: "Tomate",
                evidence: [evidence],
                fields: [
                  {
                    name: "sellingPrice",
                    rawValue: "9",
                    confidence: 1,
                    evidence: [evidence],
                  },
                ],
              },
            ],
            warnings: [],
          },
          responseId: "test-response",
          resolvedModel: this.model,
          usage: { inputTokens: 100, outputTokens: 50 },
        };
      },
    };
  }
  it("caches one AI call per page, rejects unsupported values and never publishes commercial business data", async () => {
    const { db, storeId, sourceDocumentId } = await commercialAiSource();
    const provider = aiProvider();
    const processor = createCommercialAiDraftProcessor(database, provider);
    expect(await processor.manifest(storeId, sourceDocumentId)).toMatchObject({
      status: "READY",
      pages: [1, 2],
    });
    const outcomes = await Promise.all([
      processor.extractPage(storeId, sourceDocumentId, 1),
      processor.extractPage(storeId, sourceDocumentId, 1),
    ]);
    expect(outcomes.some((result) => result.status === "DRAFT_READY")).toBe(
      true,
    );
    expect(provider.calls).toBe(1);
    await processor.extractPage(storeId, sourceDocumentId, 1);
    await processor.extractPage(storeId, sourceDocumentId, 2);
    expect(provider.calls).toBe(1); // Blank page is retained without a model request.
    expect(await processor.finalize(storeId, sourceDocumentId)).toMatchObject({
      status: "TO_VALIDATE",
      blockCount: 1,
    });
    const draft = await db
      .collection("commercialDocumentAiPages")
      .findOne({ storeId, sourceDocumentId, pageNumber: 1 });
    expect(draft).toMatchObject({
      status: "DRAFT_READY",
      schemaVersion: COMMERCIAL_AI_SCHEMA_VERSION,
      rawOutput: { blocks: [{ fields: [{ rawValue: "9" }] }] },
      draft: {
        blocks: [
          { fields: [{ rawValue: null, validationStatus: "TO_VALIDATE" }] },
        ],
      },
      responseId: "test-response",
    });
    expect(
      await db.collection("commercialOperations").countDocuments({ storeId }),
    ).toBe(0);
    expect(await db.collection("offers").countDocuments({ storeId })).toBe(0);
    expect(await processor.manifest(storeId, sourceDocumentId)).toMatchObject({
      status: "SKIPPED",
    });
    expect(
      await db
        .collection("commercialDocumentPages")
        .countDocuments({ storeId, sourceDocumentId }),
    ).toBe(2);
  }, 20_000);
  it("keeps schema-invalid AI output out of drafts and stops repeating a permanent failure", async () => {
    const { db, storeId, sourceDocumentId } = await commercialAiSource();
    const provider = aiProvider({ blocks: "not an array", warnings: [] });
    const processor = createCommercialAiDraftProcessor(database, provider);
    await processor.manifest(storeId, sourceDocumentId);
    expect(
      await processor.extractPage(storeId, sourceDocumentId, 1),
    ).toMatchObject({
      status: "FAILED",
      errorCode: "COMMERCIAL_AI_OUTPUT_INVALID",
    });
    await processor.extractPage(storeId, sourceDocumentId, 1);
    expect(provider.calls).toBe(1);
    expect(await processor.finalize(storeId, sourceDocumentId)).toMatchObject({
      status: "AI_FAILED",
    });
    expect(
      (
        await db
          .collection("commercialDocumentAiPages")
          .findOne({ storeId, sourceDocumentId })
      )?.draft,
    ).toBeUndefined();
  }, 20_000);
  it("retries temporary AI failure with the same cache identity and remains scoped to its store", async () => {
    const { db, storeId, sourceDocumentId } = await commercialAiSource();
    const provider = aiProvider();
    const extract = provider.extract.bind(provider);
    let fail = true;
    provider.extract = async (...args) => {
      if (fail) {
        fail = false;
        throw new Error("provider unavailable");
      }
      return extract(...args);
    };
    const processor = createCommercialAiDraftProcessor(database, provider);
    expect(
      await processor.manifest(randomUUID(), sourceDocumentId),
    ).toMatchObject({ status: "SKIPPED" });
    await processor.manifest(storeId, sourceDocumentId);
    await expect(
      processor.extractPage(storeId, sourceDocumentId, 1),
    ).rejects.toThrow("COMMERCIAL_AI_TEMPORARILY_UNAVAILABLE");
    const first = await db
      .collection("commercialDocumentAiPages")
      .findOne({ storeId, sourceDocumentId });
    expect(
      await processor.extractPage(storeId, sourceDocumentId, 1),
    ).toMatchObject({ status: "DRAFT_READY" });
    expect(
      await db
        .collection("commercialDocumentAiPages")
        .countDocuments({ storeId, sourceDocumentId }),
    ).toBe(1);
    const ready = await db
      .collection("commercialDocumentAiPages")
      .findOne({ storeId, sourceDocumentId });
    expect(ready?._id).toEqual(first?._id);
    expect(ready?.attemptCount).toBe(2);
  }, 20_000);

  it("recovers legacy unfinished budget failures once while retaining completed AI drafts and historical attempts", async () => {
    const { db, storeId, sourceDocumentId } = await commercialAiSource();
    const provider = aiProvider();
    const processor = createCommercialAiDraftProcessor(database, provider);
    await processor.manifest(storeId, sourceDocumentId);
    await processor.extractPage(storeId, sourceDocumentId, 1);
    const completed = await db
      .collection("commercialDocumentAiPages")
      .findOne({ storeId, sourceDocumentId, pageNumber: 1 });
    const job = (await db
      .collection("commercialDocumentJobs")
      .findOne({ storeId, sourceDocumentId }))!;
    await db
      .collection<{ _id: string; [key: string]: unknown }>(
        "commercialDocumentAiPages",
      )
      .insertOne({
        _id: randomUUID(),
        storeId,
        sourceDocumentId,
        pageNumber: 2,
        parserVersion: job.parserVersion,
        schemaVersion: COMMERCIAL_AI_SCHEMA_VERSION,
        model: provider.model,
        checksum: job.checksum,
        status: "FAILED",
        errorCode: "COMMERCIAL_AI_ATTEMPT_LIMIT",
        attemptCount: 5,
      });
    await db
      .collection("commercialDocumentJobs")
      .updateOne(
        { storeId, sourceDocumentId },
        { $set: { status: "AI_FAILED" } },
      );
    expect(
      (await processor.pendingDocuments()).some(
        (source) => source.sourceDocumentId === sourceDocumentId,
      ),
    ).toBe(true);
    const recovered = await db
      .collection("commercialDocumentAiPages")
      .findOne({ storeId, sourceDocumentId, pageNumber: 2 });
    expect(recovered).toMatchObject({
      status: "RETRY",
      runtimeBudgetVersion: 2,
      attemptCount: 5,
      budgetAttemptCount: 0,
    });
    await processor.extractPage(storeId, sourceDocumentId, 2);
    expect(
      await db
        .collection("commercialDocumentAiPages")
        .findOne({ storeId, sourceDocumentId, pageNumber: 1 }),
    ).toEqual(completed);
    expect(provider.calls).toBe(1); // Retained page is cached; blank page needs no API call.
    expect(await processor.finalize(storeId, sourceDocumentId)).toMatchObject({
      status: "TO_VALIDATE",
    });
    expect(
      (
        await db
          .collection("commercialDocumentAiPages")
          .findOne({ storeId, sourceDocumentId, pageNumber: 2 })
      )?.attemptCount,
    ).toBe(6);
  }, 20_000);
  it("does not revive schema-invalid or current-budget permanent AI failures", async () => {
    const { db, storeId, sourceDocumentId } = await commercialAiSource();
    const provider = aiProvider({ blocks: "invalid", warnings: [] });
    const processor = createCommercialAiDraftProcessor(database, provider);
    await processor.manifest(storeId, sourceDocumentId);
    await processor.extractPage(storeId, sourceDocumentId, 1);
    await processor.finalize(storeId, sourceDocumentId);
    const failed = await db
      .collection("commercialDocumentAiPages")
      .findOne({ storeId, sourceDocumentId, pageNumber: 1 });
    await db
      .collection("commercialDocumentAiPages")
      .updateOne(
        { storeId, sourceDocumentId, pageNumber: 1 },
        { $unset: { runtimeBudgetVersion: "" } },
      );
    expect(
      (await processor.pendingDocuments()).some(
        (source) => source.sourceDocumentId === sourceDocumentId,
      ),
    ).toBe(false);
    expect(
      (
        await db
          .collection("commercialDocumentAiPages")
          .findOne({ storeId, sourceDocumentId, pageNumber: 1 })
      )?.errorCode,
    ).toBe(failed?.errorCode);
    await db.collection("commercialDocumentAiPages").updateOne(
      { storeId, sourceDocumentId, pageNumber: 1 },
      {
        $set: {
          runtimeBudgetVersion: 2,
          errorCode: "COMMERCIAL_AI_ATTEMPT_LIMIT",
        },
      },
    );
    expect(
      (await processor.pendingDocuments()).some(
        (source) => source.sourceDocumentId === sourceDocumentId,
      ),
    ).toBe(false);
  }, 20_000);

  it("records the infrastructure migration exactly once", async () => {
    const mongoDatabase = await database.getDb();
    const migrations = mongoDatabase.collection<{
      _id: number;
      name: string;
      appliedAt: Date;
    }>("schemaMigrations");

    await expect(migrations.countDocuments({ _id: 1 })).resolves.toBe(1);
    await expect(migrations.findOne({ _id: 1 })).resolves.toMatchObject({
      _id: 1,
      name: "initialize-schema-migrations",
    });

    await expect(database.checkHealth()).resolves.toBe("connected");
    await expect(migrations.countDocuments({ _id: 1 })).resolves.toBe(1);
    await expect(migrations.findOne({ _id: 2 })).resolves.toMatchObject({
      _id: 2,
      name: "initialize-authentication-indexes",
    });
    await expect(migrations.findOne({ _id: 3 })).resolves.toMatchObject({
      _id: 3,
      name: "initialize-processed-command-indexes",
    });
    await expect(migrations.findOne({ _id: 4 })).resolves.toMatchObject({
      _id: 4,
      name: "initialize-sync-change-indexes",
    });
    await expect(migrations.findOne({ _id: 5 })).resolves.toMatchObject({
      _id: 5,
      name: "initialize-product-master-indexes",
    });
    await expect(migrations.findOne({ _id: 6 })).resolves.toMatchObject({
      _id: 6,
      name: "initialize-source-upload-indexes",
    });
    await expect(migrations.findOne({ _id: 7 })).resolves.toMatchObject({
      _id: 7,
      name: "initialize-analytics-read-model-indexes",
    });
    await expect(migrations.findOne({ _id: 8 })).resolves.toMatchObject({
      _id: 8,
      name: "initialize-waste-receipt-extraction-indexes",
    });
    await expect(migrations.findOne({ _id: 9 })).resolves.toMatchObject({
      _id: 9,
      name: "initialize-waste-receipt-arithmetic-validation-indexes",
    });
    await expect(migrations.findOne({ _id: 10 })).resolves.toMatchObject({
      _id: 10,
      name: "initialize-waste-receipt-product-matching-indexes",
    });
  });

  itWithMongoTransactions(
    "applies concurrent duplicate commands exactly once",
    async () => {
      const service = createMongoProcessedCommandService(database);
      const commandId = randomUUID();
      const entityId = randomUUID();
      const input = {
        commandId,
        storeId: randomUUID(),
        deviceId: randomUUID(),
        commandType: "SYNC_TEST_ENTITY_UPSERT",
        entityType: "sync_test_entity",
        entityId,
      };
      const mutate = async ({
        database: mongoDatabase,
        session,
      }: MongoCommandMutationContext) => {
        await mongoDatabase
          .collection<{ _id: string; mutationCount: number }>(
            "syncTestEntities",
          )
          .updateOne(
            { _id: entityId },
            { $inc: { mutationCount: 1 } },
            { upsert: true, session },
          );
        return {
          resultStatus: "APPLIED" as const,
          resultingVersion: 1,
          responseJson: { entityId },
        };
      };

      const outcomes = await Promise.all([
        service.execute(input, mutate),
        service.execute(input, mutate),
      ]);

      const mongoDatabase = await database.getDb();
      await expect(
        mongoDatabase
          .collection<{ _id: string; mutationCount: number }>(
            "syncTestEntities",
          )
          .findOne({ _id: entityId }),
      ).resolves.toMatchObject({ mutationCount: 1 });
      await expect(
        mongoDatabase
          .collection<{ _id: string }>("processedCommands")
          .countDocuments({ _id: commandId }),
      ).resolves.toBe(1);
      expect(
        outcomes.map(({ alreadyApplied }) => alreadyApplied).sort(),
      ).toEqual([false, true]);
    },
  );

  itWithMongoTransactions(
    "allocates unique ordered change sequences for concurrent mutations",
    async () => {
      const commands = createMongoProcessedCommandService(database);
      const changes = createMongoSyncChangeService();
      const storeId = randomUUID();
      const entityIds = Array.from({ length: 10 }, () => randomUUID());

      await Promise.all(
        entityIds.map((entityId) =>
          commands.execute(
            {
              commandId: randomUUID(),
              storeId,
              deviceId: randomUUID(),
              commandType: "SYNC_TEST_ENTITY_UPSERT",
              entityType: "sync_test_entity",
              entityId,
            },
            async (context) => {
              await context.database
                .collection<{ _id: string; version: number }>(
                  "syncTestEntities",
                )
                .insertOne(
                  { _id: entityId, version: 1 },
                  { session: context.session },
                );
              const change = await changes.append(context, {
                storeId,
                entityType: "sync_test_entity",
                entityId,
                operation: "UPSERT",
                entityVersion: 1,
              });
              return {
                resultStatus: "APPLIED",
                resultingVersion: 1,
                responseJson: { sequence: change.sequence.toString() },
              };
            },
          ),
        ),
      );

      const mongoDatabase = await database.getDb();
      const persisted = await mongoDatabase
        .collection<{ _id: string; storeId: string; sequence: Long }>(
          "syncChanges",
        )
        .find({ storeId })
        .sort({ sequence: 1 })
        .toArray();
      expect(persisted.map(({ sequence }) => sequence.toString())).toEqual(
        Array.from({ length: 10 }, (_, index) => String(index + 1)),
      );
      const counter = await mongoDatabase
        .collection<{ _id: string; nextSequence: Long }>("syncStoreCounters")
        .findOne({ _id: storeId });
      expect(counter?.nextSequence.toString()).toBe("10");
    },
    20_000, // Real Atlas transaction retries can exceed the default 5-second unit-test budget.
  );

  itWithMongoTransactions(
    "returns independent results for a mixed push batch",
    async () => {
      const service = createMongoSyncPushService(database);
      const storeId = randomUUID();
      const deviceId = randomUUID();
      const entityIds = [randomUUID(), randomUUID()];
      const commandIds = [
        randomUUID(),
        randomUUID(),
        randomUUID(),
        randomUUID(),
      ];
      const timestamp = "2026-09-26T08:00:00.000Z";
      const createCommand = (
        commandId: string,
        entityId: string,
        localSequence: number,
      ) => ({
        commandId,
        localSequence,
        type: "SYNC_TEST_ENTITY_UPSERT",
        entityType: "sync_test_entity",
        entityId,
        expectedRemoteVersion: null,
        createdAt: timestamp,
        payload: {
          id: entityId,
          storeId,
          label: `Entité ${localSequence}`,
          remoteVersion: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      });
      const firstCommand = createCommand(commandIds[0]!, entityIds[0]!, 1);
      const response = await service.push(
        {
          syncProtocolVersion: 1,
          appVersion: "0.1.0",
          deviceId,
          storeId,
          commands: [
            firstCommand,
            {
              ...createCommand(commandIds[1]!, randomUUID(), 2),
              type: "UNSUPPORTED_COMMAND",
            },
            createCommand(commandIds[2]!, entityIds[1]!, 3),
            {
              ...createCommand(commandIds[3]!, entityIds[0]!, 4),
              expectedRemoteVersion: 0,
            },
          ],
        },
        "integration-request",
      );

      expect(response.results.map(({ status }) => status)).toEqual([
        "APPLIED",
        "REJECTED",
        "APPLIED",
        "CONFLICT",
      ]);
      const mongoDatabase = await database.getDb();
      await expect(
        mongoDatabase
          .collection("syncTestEntities")
          .countDocuments({ storeId }),
      ).resolves.toBe(2);
      await expect(
        mongoDatabase.collection("syncChanges").countDocuments({ storeId }),
      ).resolves.toBe(2);
      await expect(
        mongoDatabase
          .collection<{ _id: string }>("processedCommands")
          .countDocuments({ _id: { $in: commandIds } }),
      ).resolves.toBe(4);

      const replay = await service.push(
        {
          syncProtocolVersion: 1,
          appVersion: "0.1.0",
          deviceId,
          storeId,
          commands: [firstCommand],
        },
        "replay-request",
      );
      expect(replay.results[0]).toMatchObject({
        commandId: commandIds[0],
        status: "ALREADY_APPLIED",
        remoteVersion: 1,
      });
      await expect(
        mongoDatabase.collection("syncChanges").countDocuments({ storeId }),
      ).resolves.toBe(2);
    },
  );

  itWithMongoTransactions(
    "returns store-scoped change pages in sequence order",
    async () => {
      const push = createMongoSyncPushService(database);
      const pull = createMongoSyncPullService(database);
      const storeId = randomUUID();
      const deviceId = randomUUID();
      const timestamp = "2026-09-26T08:00:00.000Z";
      const commands = Array.from({ length: 3 }, (_, index) => {
        const entityId = randomUUID();
        return {
          commandId: randomUUID(),
          localSequence: index + 1,
          type: "SYNC_TEST_ENTITY_UPSERT",
          entityType: "sync_test_entity",
          entityId,
          expectedRemoteVersion: null,
          createdAt: timestamp,
          payload: {
            id: entityId,
            storeId,
            label: `Entité ${index + 1}`,
            remoteVersion: 0,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        };
      });
      await push.push(
        {
          syncProtocolVersion: 1,
          appVersion: "0.1.0",
          deviceId,
          storeId,
          commands,
        },
        "pull-fixture-request",
      );

      const firstPage = await pull.pull(storeId, { limit: 2 });
      expect(firstPage.changes.map(({ sequence }) => sequence)).toEqual([
        "1",
        "2",
      ]);
      expect(firstPage.changes.map(({ entity }) => entity)).toEqual([
        expect.objectContaining({ label: "Entité 1", remoteVersion: 1 }),
        expect.objectContaining({ label: "Entité 2", remoteVersion: 1 }),
      ]);
      expect(firstPage.hasMore).toBe(true);
      await expect(
        pull.pull(randomUUID(), { cursor: firstPage.nextCursor, limit: 2 }),
      ).rejects.toBeInstanceOf(SyncPullCursorError);

      const secondPage = await pull.pull(storeId, {
        cursor: firstPage.nextCursor,
        limit: 2,
      });
      expect(secondPage.changes.map(({ sequence }) => sequence)).toEqual(["3"]);
      expect(secondPage.hasMore).toBe(false);
      expect(secondPage.nextCursor).not.toBe(firstPage.nextCursor);

      const emptyPage = await pull.pull(storeId, {
        cursor: secondPage.nextCursor,
        limit: 2,
      });
      expect(emptyPage.changes).toEqual([]);
      expect(emptyPage.nextCursor).toBe(secondPage.nextCursor);
      expect(emptyPage.hasMore).toBe(false);
    },
  );

  itWithMongoTransactions(
    "bootstraps a snapshot whose cursor precedes only later changes",
    async () => {
      const push = createMongoSyncPushService(database);
      const pull = createMongoSyncPullService(database);
      const bootstrap = createMongoSyncBootstrapService(
        database,
        () => new Date("2026-09-26T08:10:00.000Z"),
        () => "bootstrap-revision-1",
      );
      const storeId = randomUUID();
      const deviceId = randomUUID();
      const timestamp = "2026-09-26T08:00:00.000Z";
      const command = (localSequence: number) => {
        const entityId = randomUUID();
        return {
          commandId: randomUUID(),
          localSequence,
          type: "SYNC_TEST_ENTITY_UPSERT",
          entityType: "sync_test_entity",
          entityId,
          expectedRemoteVersion: null,
          createdAt: timestamp,
          payload: {
            id: entityId,
            storeId,
            label: `Bootstrap ${localSequence}`,
            remoteVersion: 0,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        };
      };
      await push.push(
        {
          syncProtocolVersion: 1,
          appVersion: "0.1.0",
          deviceId,
          storeId,
          commands: [command(1), command(2)],
        },
        "before-bootstrap",
      );

      const snapshot = await bootstrap.bootstrap(
        {
          userId: randomUUID(),
          sessionId: randomUUID(),
          deviceId,
          storeId,
          storeName: "Magasin bootstrap",
          role: "MANAGER",
        },
        { rawObservationDays: 90 },
      );
      expect(snapshot).toMatchObject({
        snapshotRevision: "bootstrap-revision-1",
        store: { id: storeId, name: "Magasin bootstrap", role: "MANAGER" },
        historyPolicy: { rawObservationDays: 90 },
      });
      expect(snapshot.entities.syncTestEntities).toHaveLength(2);

      await push.push(
        {
          syncProtocolVersion: 1,
          appVersion: "0.1.0",
          deviceId,
          storeId,
          commands: [command(3)],
        },
        "after-bootstrap",
      );
      const later = await pull.pull(storeId, {
        cursor: snapshot.cursor,
        limit: 10,
      });
      expect(later.changes).toHaveLength(1);
      expect(later.changes[0]).toMatchObject({
        sequence: "3",
        entity: expect.objectContaining({ label: "Bootstrap 3" }),
      });
    },
  );

  it("verifies a one-time code, rotates refresh tokens and revokes reuse", async () => {
    const config = parseEnvironment({
      NODE_ENV: "test",
      MONGODB_URI: testMongoUri,
      MONGODB_DATABASE: databaseName,
      AUTH_DEVELOPMENT_CODE: "123456",
    });
    const delivered: string[] = [];
    const auth = createMongoAuthService(database, config, async ({ code }) => {
      delivered.push(code);
    });
    const deviceId = randomUUID();
    const challenge = await auth.requestChallenge({
      email: "manager@example.test",
      deviceId,
      platform: "IOS",
      appVersion: "0.1.0",
    });
    expect(delivered).toEqual(["123456"]);

    const first = await auth.verifyChallenge(challenge.challengeId, "123456");
    expect(first.user.email).toBe("manager@example.test");
    expect(first.refreshToken).toHaveLength(43);
    const storeId = randomUUID();
    const mongoDatabase = await database.getDb();
    await mongoDatabase.collection("storeMemberships").insertOne({
      userId: first.user.id,
      storeId,
      storeName: "Magasin test",
      role: "MANAGER",
      active: true,
    });
    await expect(
      auth.authorizeStore(first.accessToken, storeId, deviceId),
    ).resolves.toMatchObject({
      userId: first.user.id,
      storeId,
      deviceId,
      role: "MANAGER",
    });
    await expect(
      auth.authorizeStore(first.accessToken, randomUUID(), deviceId),
    ).rejects.toMatchObject({ publicCode: "STORE_ACCESS_DENIED" });
    await expect(
      auth.verifyChallenge(challenge.challengeId, "123456"),
    ).rejects.toMatchObject({ publicCode: "AUTH_CODE_INVALID" });

    const rotated = await auth.refreshSession(deviceId, first.refreshToken);
    expect(rotated.refreshToken).not.toBe(first.refreshToken);
    await expect(
      auth.refreshSession(deviceId, first.refreshToken),
    ).rejects.toMatchObject({ publicCode: "AUTH_SESSION_EXPIRED" });
    await expect(
      auth.refreshSession(deviceId, rotated.refreshToken),
    ).rejects.toMatchObject({ publicCode: "AUTH_SESSION_EXPIRED" });
  }, 20_000);
});
