import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  commercialOfferChoiceSchema,
  commercialWeekPreparationSchema,
} from "@fl-copilot/domain";
import {
  commercialChoiceId,
  commercialWeekPreparationId,
  buildCommercialWeekPlan,
} from "@fl-copilot/commercial-core";
import type { SyncPushRequest } from "@fl-copilot/sync-contracts";
import type { Document } from "mongodb";
import { createMongoDatabase } from "../../../api/src/database/mongo";
import { parseEnvironment } from "../../../api/src/config";
import type { DatabaseService } from "../../../api/src/database/types";
import {
  createMongoSourceUploadService,
  type SourceBlobMetadata,
} from "../../../api/src/uploads/source-upload-service";
import { createSourceOriginalService } from "../../../api/src/uploads/source-original-service";
import { createMongoSyncPushService } from "../../../api/src/sync/push-service";
import { createMongoSyncPullService } from "../../../api/src/sync/pull-service";
import { createMongoSyncBootstrapService } from "../../../api/src/sync/bootstrap-service";
import {
  mongoMigrations,
  runMongoMigrations,
} from "../../../api/src/database/migrations";
import { ApiClientError } from "../../../../packages/api-client/src/index";
import { previewChoiceCreate } from "../../../api/src/copilot/choice-create-tool";
import { buildChoiceCreateProposalMessages } from "../../../api/src/copilot/choice-create-messages";
import { CopilotChoiceCreateController } from "../copilot/choice-create-controller";
import { applyCopilotRecord } from "../copilot/conversation-repository";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import { copilotMessageSchema } from "@fl-copilot/domain";
import { commercialPdfFixture } from "../../../api/test/fixtures/commercial-pdf";
import {
  commercialChoiceFixture,
  testChoiceDigest,
} from "../../../../scripts/test-commercial-choice-fixtures";
import { VisualTestDatabase } from "../../../../scripts/test-visual-sqlite";
import { runLocalMigrations } from "../db/migrations";
import { captureCommercialPdf } from "../documents/commercial-pdf-capture";
import { SourceDocumentRepository } from "../documents/source-document-repository";
import { SourceUploadQueue } from "../documents/source-upload-queue";
import {
  SourceOriginalTransfer,
  type SourceOriginalFiles,
} from "../documents/source-original-transfer";
import { ProductMasterRepository } from "../products/product-master-repository";
import { CommercialChoiceRepository } from "../commercial/offer-choice-repository";
import {
  readCommercialChoiceSource,
  readCommercialOfferEditorSource,
} from "../commercial/choice-source";
import {
  ValidatedOfferRepository,
  readValidatedOffers,
} from "../commercial/validated-offer-repository";
import { CommercialPreparationRepository } from "../commercial/week-preparation-repository";
import { CommercialPlanRepository } from "../commercial/week-plan-repository";
import { readWeekPlanContext } from "../commercial/week-plan-context";
import { MobileSyncService, type SyncTransport } from "../sync/sync-service";
import { OutboxRepository } from "../sync/outbox-repository";

const hash = (bytes: Uint8Array | string) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "original PDF choices through real Mongo and SQLite, without extraction",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `flc_raw_choice_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
        }),
      );
      await database.getDb();
    }, 60000);
    afterAll(async () => {
      if (database)
        try {
          await (await database.getDb()).dropDatabase();
        } finally {
          await database.close();
        }
    }, 60000);

    it("captures and uploads once, retains two original offers, restores on a second SQLite and plans next week without extraction", async () => {
      const dir = await mkdtemp(join(tmpdir(), "fl-raw-choice-"));
      let a = new VisualTestDatabase(new DatabaseSync(join(dir, "a.sqlite")));
      const b = new VisualTestDatabase(new DatabaseSync(join(dir, "b.sqlite")));
      try {
        await runLocalMigrations(a);
        await runLocalMigrations(b);
        const f = await commercialChoiceFixture(),
          storeId = f.storeId,
          ownerId = randomUUID(),
          deviceId = randomUUID();
        const now = () => new Date("2026-10-24T13:00:00Z"),
          at = now().toISOString();
        const excerpt =
          "Prospectus S44 Raisin blanc vrac du 26/10/2026 au 01/11/2026 moins de 2,20 EUR le kg";
        const otherExcerpt =
          "Prospectus S44 Pomme vrac du 26/10/2026 au 01/11/2026 moins de 1,80 EUR le kg";
        const bytes = commercialPdfFixture([
          "Offres semaine 44 2026",
          `${excerpt} ; ${otherExcerpt}`,
        ]);
        const selected = join(dir, "selected.pdf");
        await writeFile(selected, bytes);
        const appDir = join(
          dir,
          "source-originals",
          storeId,
          ownerId,
          f.sourceDocumentId,
        );
        await mkdir(appDir, { recursive: true });
        const originalPath = join(appDir, "original.pdf");
        await captureCommercialPdf(
          {
            uri: pathToFileURL(selected).href,
            originalFilename: "semaine44.pdf",
            mimeType: "application/pdf",
            storeId,
            documentId: f.sourceDocumentId,
            fileId: randomUUID(),
            capturedAt: at,
          },
          new SourceDocumentRepository(a),
          {
            persist: async ({ uri }) => {
              const actual = await readFile(fileURLToPath(uri));
              await writeFile(originalPath, actual);
              return {
                localUri: pathToFileURL(originalPath).href,
                sizeBytes: actual.length,
                checksum: hash(actual),
              };
            },
            remove: async (uri) => {
              await rm(fileURLToPath(uri));
            },
          },
        );
        let blob: SourceBlobMetadata | null = null,
          key = "";
        const dispatch = vi.fn(async () => {});
        const upload = createMongoSourceUploadService(
          database,
          {
            head: async () => blob,
            createUploadUrl: async ({ pathname }) => {
              key = pathname;
              return "https://upload.test.invalid/pdf";
            },
          },
          now,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          dispatch,
        );
        const uploader = vi.fn(async ({ localUri }: { localUri: string }) => {
          expect(
            new Uint8Array(await readFile(fileURLToPath(localUri))),
          ).toEqual(bytes);
          blob = {
            pathname: key,
            size: bytes.length,
            contentType: "application/pdf",
            url: "https://test.private.blob.vercel-storage.com/original.pdf",
            etag: "pdf-fixture-1",
          };
        });
        const queue = new SourceUploadQueue(
          a,
          {
            init: (s, input) => upload.init(s, ownerId, input),
            complete: (s, id, input) => upload.complete(s, id, input, ownerId),
            verify: async () => {
              throw Error("NO_MERCALYS_VERIFICATION");
            },
          },
          { upload: uploader },
          now,
        );
        expect(await queue.process(storeId, ownerId)).toEqual({
          attempted: 1,
          confirmed: 1,
        });
        expect(await queue.process(storeId, ownerId)).toEqual({
          attempted: 0,
          confirmed: 0,
        });
        expect(uploader).toHaveBeenCalledTimes(1);
        expect(
          (
            await new SourceDocumentRepository(a).getDocument(
              f.sourceDocumentId,
            )
          )?.remoteUploadStatus,
        ).toBe("CONFIRMED");
        const mongo = await database.getDb();
        const sourceBefore = await mongo
          .collection("sourceDocuments")
          .findOne({ _id: f.sourceDocumentId as never });
        const jobsBefore = await mongo
          .collection("commercialDocumentJobs")
          .find({ storeId })
          .toArray();
        expect(jobsBefore).toHaveLength(1);
        expect(jobsBefore[0]?.status).toBe("PENDING");
        const product = {
          ...f.product,
          salesUnit: "KG" as const,
          category: "FRUIT" as const,
          nature: "BULK" as const,
        };
        const otherProduct = {
          ...product,
          id: randomUUID(),
          label: "POMME VRAC",
        };
        const products = new ProductMasterRepository(a);
        for (const p of [product, otherProduct])
          await products.upsertProduct(p, {
            commandId: randomUUID(),
            deviceId,
          });
        const read = vi.fn(async (path: string) =>
          path === key ? bytes : null,
        );
        const push = createMongoSyncPushService(
          database,
          now,
          undefined,
          undefined,
          { read },
        );
        const pull = createMongoSyncPullService(database, now),
          bootstrap = createMongoSyncBootstrapService(database, now);
        const query = {
          commercialChoices: "true" as const,
          commercialPreparation: "true" as const,
          commercialOriginalSources: "true" as const,
        };
        const requests: SyncPushRequest[] = [];
        const transport: SyncTransport = {
          bootstrap: (s) =>
            bootstrap.bootstrap(
              {
                storeId: s,
                storeName: "Fixture",
                role: "MANAGER",
                userId: ownerId,
                sessionId: randomUUID(),
                deviceId,
              },
              { rawObservationDays: 90, ...query },
            ),
          push: async (req) => {
            requests.push(req);
            return push.push(req, randomUUID(), ownerId);
          },
          pull: (s, cursor) =>
            pull.pull(s, { cursor, limit: 500, ...query }, ownerId),
        };
        const options = {
          deviceId,
          appVersion: "fixture",
          commercialChoices: true,
          commercialPreparation: true,
          commercialOriginalSources: true,
          maxRetries: 0,
          now: () => at,
        };
        const sync = new MobileSyncService(a, transport, options);
        expect(await sync.sync(storeId)).toMatchObject({
          failed: 0,
          conflicts: 0,
        });
        const source = {
          kind: "PDF_ORIGINAL" as const,
          sourceDocumentId: f.sourceDocumentId,
          checksum: hash(bytes),
          pageNumber: 2,
          excerpt,
        };
        let choice = commercialOfferChoiceSchema.parse({
          ...f.choice,
          id: await commercialChoiceId(storeId, source, testChoiceDigest),
          source,
          operationKind: "PROSPECTUS",
          operationLabel: "Prospectus S44",
          saleStart: "2026-10-26",
          saleEnd: "2026-11-01",
          createdAt: at,
          updatedAt: at,
        });
        const source2 = { ...source, excerpt: otherExcerpt };
        const otherChoice = commercialOfferChoiceSchema.parse({
          ...choice,
          id: await commercialChoiceId(storeId, source2, testChoiceDigest),
          source: source2,
          rawProductLabel: "Pomme vrac",
          productId: otherProduct.id,
          mechanism: { ...choice.mechanism, amount: 1.8 },
        });
        // This test explicitly simulates the manager's confirmation; it is not real pilot approval.
        const choices = new CommercialChoiceRepository(a, testChoiceDigest);
        const chat = chatFixture(randomUUID),
          conversation = { ...chat.conversation, storeId, ownerId },
          scope = { storeId, ownerId };
        const user = {
          ...chat.message,
          storeId,
          ownerId,
          conversationId: conversation.id,
          attachments: [],
          text: "Retiens le raisin pour la semaine prochaine",
        };
        const assistant = copilotMessageSchema.parse({
          ...user,
          id: randomUUID(),
          role: "ASSISTANT",
          replyToMessageId: user.id,
          text: "Voici le choix à confirmer.",
        });
        const preview = await previewChoiceCreate(mongo, storeId, {
          source: choice.source,
          productId: choice.productId,
          saleStart: choice.saleStart,
          saleEnd: choice.saleEnd,
          mechanism: choice.mechanism,
          note: choice.note,
          originalDescription: {
            operationKind: choice.operationKind,
            operationLabel: choice.operationLabel,
            rawProductLabel: choice.rawProductLabel,
          },
        });
        expect(preview.status).toBe("READY");
        const card = buildChoiceCreateProposalMessages(assistant, [
          preview,
        ])[0]!;
        await a.withExclusiveTransactionAsync(async (tx) => {
          await applyCopilotRecord(
            tx,
            scope,
            "copilot_conversation",
            conversation,
          );
          for (const message of [user, assistant, card])
            await applyCopilotRecord(tx, scope, "copilot_message", message);
        });
        const controller = new CopilotChoiceCreateController(
            a,
            { ...scope, deviceId, canManageCommercialChoices: true },
            testChoiceDigest,
            randomUUID,
          ),
          review = {
            criticalFieldsConfirmed: true,
            applicabilityConfirmed: true,
          };
        expect((await controller.open(card)).status).toBe("READY");
        await expect(
          controller.confirm(card, {
            ...review,
            criticalFieldsConfirmed: false,
          }),
        ).rejects.toThrow("REVIEW_REQUIRED");
        await expect(
          controller.confirm(
            {
              ...card,
              text: card.text.replace("Prospectus S44", "Forged source"),
            },
            review,
          ),
        ).rejects.toThrow();
        expect((await controller.confirm(card, review)).status).toBe(
          "COMPLETED",
        );
        expect((await controller.confirm(card, review)).status).toBe(
          "COMPLETED",
        );
        choice = (await choices.get(storeId, choice.id))!.entity;
        await choices.save(otherChoice, { commandId: randomUUID(), deviceId });
        read.mockClear();
        requests.length = 0;
        expect(await sync.sync(storeId)).toMatchObject({
          failed: 0,
          conflicts: 0,
          pushed: 2,
        });
        expect(read).toHaveBeenCalledTimes(1);
        for (const req of requests)
          expect(
            (await push.push(req, "replay", ownerId)).results.every(
              (r) => r.status === "ALREADY_APPLIED",
            ),
          ).toBe(true);
        expect(
          await mongo
            .collection("commercialOfferChoices")
            .countDocuments({ storeId }),
        ).toBe(2);
        expect(
          await mongo
            .collection("commercialChoiceHistory")
            .countDocuments({ storeId }),
        ).toBe(2);
        a.raw.close();
        a = new VisualTestDatabase(new DatabaseSync(join(dir, "a.sqlite")));
        await runLocalMigrations(a);
        expect(
          (
            await new CommercialChoiceRepository(a, testChoiceDigest).get(
              storeId,
              choice.id,
            )
          )?.entity,
        ).toEqual(choice);
        expect(await new OutboxRepository(a).listPending(storeId)).toEqual([]);
        expect(hash(await readFile(originalPath))).toBe(source.checksum);
        const syncB = new MobileSyncService(b, transport, {
          ...options,
          deviceId: randomUUID(),
        });
        await syncB.bootstrap(storeId);
        const choicesB = new CommercialChoiceRepository(b, testChoiceDigest);
        expect((await choicesB.get(storeId, choice.id))?.entity).toEqual(
          choice,
        );
        expect(
          await b.getFirstAsync(
            "SELECT reading_id,operation_index,item_index FROM commercial_offer_choices WHERE id=?",
            choice.id,
          ),
        ).toEqual({
          reading_id: null,
          operation_index: null,
          item_index: null,
        });
        const editor = await readCommercialOfferEditorSource(
          b,
          storeId,
          {
            id: choice.id,
            choiceId: choice.id,
            operationIndex: NaN,
            itemIndex: NaN,
          },
          (id) => choicesB.get(storeId, id),
          testChoiceDigest,
        );
        expect(editor.sourceAvailable).toBe(false);
        expect(editor.offer.source).toEqual(source);
        const originals = createSourceOriginalService(
          database,
          { head: async () => blob },
          async () => blob!.url,
          now,
        );
        const received = join(dir, "b-original.pdf");
        const files: SourceOriginalFiles = {
          hash: async (text) => hash(text),
          existing: async (manifest, uri) => {
            try {
              const actual = await readFile(fileURLToPath(uri));
              return hash(actual) === manifest.checksum &&
                actual.length === manifest.sizeBytes
                ? { localUri: uri, views: null }
                : null;
            } catch {
              return null;
            }
          },
          receive: async (download, actor, check) => {
            check();
            expect(actor).toBe(ownerId);
            expect(download).toBeDefined();
            await writeFile(received, bytes);
            check();
            return { localUri: pathToFileURL(received).href, views: null };
          },
        };
        const transfer = new SourceOriginalTransfer(
          b,
          {
            manifest: (s, actor, id) => originals.manifest(s, actor, id),
            download: (s, actor, id) => originals.download(s, actor, id),
          },
          files,
          () => ({ storeId, userId: ownerId }),
          randomUUID,
          now,
        );
        await transfer.recover(f.sourceDocumentId);
        expect(hash(await readFile(received))).toBe(source.checksum);
        expect(
          (await readCommercialChoiceSource(b, choice)).offer?.source,
        ).toEqual(source);
        const validation = new ValidatedOfferRepository(b, testChoiceDigest);
        await validation.validate(
          storeId,
          [choice, otherChoice].map((c) => ({
            choiceId: c.id,
            choiceVersion: 1,
          })),
          { deviceId, commandIds: [randomUUID(), randomUUID()], createdAt: at },
        );
        expect(
          (await readValidatedOffers(b, storeId)).map(
            (v) => v.entity.sourceFields,
          ),
        ).toEqual([[], []]);
        expect(await syncB.sync(storeId)).toMatchObject({
          failed: 0,
          conflicts: 0,
        });
        const preparation = commercialWeekPreparationSchema.parse({
          id: await commercialWeekPreparationId(
            storeId,
            "2026-10-26",
            testChoiceDigest,
          ),
          storeId,
          weekStart: "2026-10-26",
          weekEnd: "2026-11-01",
          status: "DRAFT",
          tgCapacity: 1,
          offerRefs: [choice, otherChoice].map((c) => ({
            choiceId: c.id,
            choiceVersion: 1,
          })),
          placements: [
            {
              id: randomUUID(),
              label: "TG fixture",
              theme: "Fruits",
              offerIds: [choice.id, otherChoice.id],
              sourceIdea: null,
            },
          ],
          note: "",
          version: 1,
          createdAt: at,
          updatedAt: at,
        });
        await new CommercialPreparationRepository(b, testChoiceDigest).save(
          preparation,
          { commandId: randomUUID(), deviceId },
        );
        expect(await syncB.sync(storeId)).toMatchObject({
          failed: 0,
          conflicts: 0,
        });
        const context = await readWeekPlanContext(b, preparation);
        expect(context.pages).toEqual([]);
        const plan = await buildCommercialWeekPlan(
          { preparation, version: 1, createdAt: at, validatedAt: at },
          context,
          testChoiceDigest,
        );
        await new CommercialPlanRepository(b, testChoiceDigest).save(plan, {
          commandId: randomUUID(),
          deviceId,
        });
        expect(await syncB.sync(storeId)).toMatchObject({
          failed: 0,
          conflicts: 0,
        });
        const remotePlan = await mongo
          .collection("commercialWeekPlans")
          .findOne({ _id: plan.id as never });
        expect(remotePlan).toMatchObject({
          weekStart: "2026-10-26",
          weekEnd: "2026-11-01",
        });
        expect(plan.offers).toHaveLength(2);
        expect(plan.offers.map((o) => o.sourceReference)).toEqual(
          expect.arrayContaining([source, source2]),
        );
        for (const operation of plan.operations)
          expect(operation).toMatchObject({
            plannedStart: "2026-10-26",
            plannedEnd: "2026-11-01",
            announcedStart: null,
            announcedEnd: null,
            actualStart: null,
            actualEnd: null,
          });
        expect(
          await mongo
            .collection("sourceDocuments")
            .findOne({ _id: f.sourceDocumentId as never }),
        ).toEqual(sourceBefore);
        expect(
          await mongo
            .collection("commercialDocumentJobs")
            .find({ storeId })
            .toArray(),
        ).toEqual(jobsBefore);
        for (const collection of [
          "commercialVisualReadings",
          "commercialPdfTextPages",
          "commercialPdfVisualPages",
          "salesObservations",
          "wasteObservations",
          "actionExecutions",
        ])
          expect(
            await mongo.collection(collection).countDocuments({ storeId }),
          ).toBe(0);
      } finally {
        a.raw.close();
        b.raw.close();
        await rm(dir, { recursive: true, force: true });
      }
    }, 60000);
    it("rejects invalid original identities, keeps transient file failures retryable, and preserves pending commands during a legacy-client upgrade", async () => {
      const db = await database.getDb(),
        f = await commercialChoiceFixture(),
        now = () => new Date("2026-10-24T13:00:00Z");
      const bytes = commercialPdfFixture([
          "S44",
          "Raisin blanc vrac moins de 2,20 EUR/kg",
        ]),
        checksum = hash(bytes),
        objectKey = `fixture/${f.sourceDocumentId}.pdf`;
      await db
        .collection<Document & { _id: string }>("sourceDocuments")
        .insertOne({
          _id: f.sourceDocumentId,
          ...{
            storeId: f.storeId,
            sourceType: "WEEKLY_COMMERCIAL_PDF",
            originalFilename: "future.pdf",
            checksum,
            sizeBytes: bytes.length,
            mimeType: "application/pdf",
            objectKey,
            remoteUploadStatus: "CONFIRMED",
            deletedAt: null,
            createdAt: now(),
          },
        });
      await db.collection<Document & { _id: string }>("products").insertOne({
        ...f.product,
        _id: f.productId,
        createdAt: new Date(f.product.createdAt),
        updatedAt: new Date(f.product.updatedAt),
      });
      const source = {
        kind: "PDF_ORIGINAL" as const,
        sourceDocumentId: f.sourceDocumentId,
        checksum,
        pageNumber: 2,
        excerpt: "Raisin blanc vrac moins de 2,20 EUR/kg",
      };
      const choice = commercialOfferChoiceSchema.parse({
        ...f.choice,
        source,
        id: await commercialChoiceId(f.storeId, source, testChoiceDigest),
      });
      const request = (
        value = choice,
        expected: number | null = null,
      ): SyncPushRequest => ({
        syncProtocolVersion: 1,
        appVersion: "fixture",
        deviceId: randomUUID(),
        storeId: f.storeId,
        commercialOriginalSources: true,
        commands: [
          {
            commandId: randomUUID(),
            localSequence: 1,
            type: "COMMERCIAL_OFFER_CHOICE_UPSERT",
            entityType: "commercial_offer_choice",
            entityId: value.id,
            expectedRemoteVersion: expected,
            createdAt: value.updatedAt,
            payload: value,
          },
        ],
      });
      const read = vi.fn(async () => bytes),
        push = createMongoSyncPushService(database, now, undefined, undefined, {
          read,
        });
      for (const patch of [
        { pageNumber: 3 },
        { checksum: `sha256:${"b".repeat(64)}` },
        { sourceDocumentId: randomUUID() },
      ]) {
        const invalidSource = { ...source, ...patch },
          invalid = {
            ...choice,
            source: invalidSource,
            id: await commercialChoiceId(
              f.storeId,
              invalidSource,
              testChoiceDigest,
            ),
          };
        expect(
          (await push.push(request(invalid), "invalid")).results[0]?.status,
        ).toBe("REJECTED");
      }
      const retry = request();
      const unavailable = createMongoSyncPushService(
        database,
        now,
        undefined,
        undefined,
        {
          read: async () => {
            throw Error("private network detail");
          },
        },
      );
      expect(
        (await unavailable.push(retry, "network")).results[0],
      ).toMatchObject({
        status: "RETRYABLE_ERROR",
        error: { retryable: true },
      });
      expect(
        await db
          .collection("commercialOfferChoices")
          .countDocuments({ storeId: f.storeId }),
      ).toBe(0);
      expect((await push.push(retry, "restored")).results[0]?.status).toBe(
        "APPLIED",
      );
      const bootstrap = createMongoSyncBootstrapService(database, now),
        pull = createMongoSyncPullService(database, now);
      const store = {
        storeId: f.storeId,
        storeName: "Fixture",
        role: "MANAGER",
        userId: randomUUID(),
        sessionId: randomUUID(),
        deviceId: randomUUID(),
      };
      await expect(
        bootstrap.bootstrap(store, {
          rawObservationDays: 90,
          commercialChoices: "true",
        }),
      ).rejects.toMatchObject({
        statusCode: 426,
        publicCode: "COMMERCIAL_SOURCE_UPGRADE_REQUIRED",
      });
      await expect(
        pull.pull(f.storeId, { limit: 500, commercialChoices: "true" }),
      ).rejects.toMatchObject({ statusCode: 426 });
      const oldRequest = { ...request(), commercialOriginalSources: false };
      await expect(push.push(oldRequest, "old")).rejects.toMatchObject({
        statusCode: 426,
      });
      const local = new VisualTestDatabase(new DatabaseSync(":memory:"));
      try {
        await runLocalMigrations(local);
        const products = new ProductMasterRepository(local),
          commandId = randomUUID();
        await products.upsertProduct(
          { ...f.product, label: "Locally corrected" },
          { commandId, deviceId: store.deviceId },
        );
        await local.runAsync(
          "INSERT INTO sync_inbox_state(store_id,cursor,protocol_version) VALUES(?,'unchanged',1)",
          f.storeId,
        );
        const transport: SyncTransport = {
          bootstrap: async () => {
            throw Error("UNEXPECTED_BOOTSTRAP");
          },
          pull: async () => {
            throw Error("UNEXPECTED_PULL");
          },
          push: async () => {
            throw new ApiClientError(426, {
              code: "COMMERCIAL_SOURCE_UPGRADE_REQUIRED",
              messageFr: "Update required",
              retryable: false,
              requestId: "fixture",
            });
          },
        };
        const service = new MobileSyncService(local, transport, {
          deviceId: store.deviceId,
          appVersion: "legacy",
          maxRetries: 0,
        });
        await expect(service.sync(f.storeId)).rejects.toThrow();
        expect(
          await new OutboxRepository(local).listPending(f.storeId),
        ).toHaveLength(1);
        expect(
          (await new OutboxRepository(local).listPending(f.storeId))[0]
            ?.commandId,
        ).toBe(commandId);
        expect(
          await local.getFirstAsync(
            "SELECT cursor FROM sync_inbox_state WHERE store_id=?",
            f.storeId,
          ),
        ).toEqual({ cursor: "unchanged" });
      } finally {
        local.raw.close();
      }
      await db
        .collection<Document & { _id: string }>("sourceDocuments")
        .updateOne({ _id: f.sourceDocumentId }, { $set: { deletedAt: now() } });
      read.mockClear();
      const withdrawal = {
        ...choice,
        status: "WITHDRAWN" as const,
        version: 2,
        note: "Withdrawn after review",
        updatedAt: now().toISOString(),
      };
      expect(
        (
          await push.push(
            request({ ...withdrawal, saleEnd: "2026-10-09" }, 1),
            "tampered",
          )
        ).results[0]?.status,
      ).toBe("REJECTED");
      expect(
        (await push.push(request(withdrawal, 1), "withdrawn")).results[0]
          ?.status,
      ).toBe("APPLIED");
      expect(read).not.toHaveBeenCalled();
      expect(
        await db
          .collection("commercialChoiceHistory")
          .countDocuments({ storeId: f.storeId }),
      ).toBe(2);
    }, 20000);

    it("preserves the legacy unique index until a partial replacement exists, including concurrent Mongo migrators", async () => {
      const shared = await database.getDb(),
        db = shared.client.db(
          `flc_raw_index_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
        );
      try {
        await runMongoMigrations(
          db,
          mongoMigrations.filter((m) => m.version < 53),
        );
        const f = await commercialChoiceFixture();
        await db
          .collection<Document & { _id: string }>("commercialOfferChoices")
          .insertOne({ ...f.choice, _id: f.choice.id, duplicateKey: "legacy" });
        const before = await db
          .collection("commercialOfferChoices")
          .find()
          .toArray();
        await Promise.all([runMongoMigrations(db), runMongoMigrations(db)]);
        expect(
          await db.collection("commercialOfferChoices").find().toArray(),
        ).toEqual(before);
        const indexes = await db
          .collection("commercialOfferChoices")
          .listIndexes()
          .toArray();
        expect(
          indexes.find((i) => i.name === "commercial_choice_extracted_source"),
        ).toMatchObject({
          unique: true,
          partialFilterExpression: { "source.readingId": { $type: "string" } },
        });
        expect(indexes.some((i) => i.name === "commercial_choice_source")).toBe(
          false,
        );
        await expect(
          db
            .collection<Document & { _id: string }>("commercialOfferChoices")
            .insertOne({
              ...f.choice,
              _id: randomUUID(),
              duplicateKey: "other",
            }),
        ).rejects.toMatchObject({ code: 11000 });
        for (let i = 0; i < 2; i++)
          await db
            .collection<Document & { _id: string }>("commercialOfferChoices")
            .insertOne({
              ...f.choice,
              _id: randomUUID(),
              source: {
                kind: "PDF_ORIGINAL",
                sourceDocumentId: f.sourceDocumentId,
                checksum: `sha256:${"a".repeat(64)}`,
                pageNumber: 2,
                excerpt: `Offer ${i}`,
              },
              duplicateKey: `raw-${i}`,
            });
        expect(
          await db.collection("commercialOfferChoices").countDocuments(),
        ).toBe(3);
        expect(
          await db
            .collection("schemaMigrations")
            .countDocuments({ _id: 53 as never }),
        ).toBe(1);
      } finally {
        await db.dropDatabase();
      }
    }, 20000);
  },
);
