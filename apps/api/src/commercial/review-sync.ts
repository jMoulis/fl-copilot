import {
  commercialReviewPageSchema,
  commercialReviewDecisionSchema,
  synchronizedCommercialReviewDecisionSchema,
  type CommercialReviewPage,
  type SynchronizedCommercialReviewDecision,
  type SyncCommand,
} from "@fl-copilot/sync-contracts";
import type { DatabaseService } from "../database/types.js";
import type {
  MongoCommandMutationContext,
  CommandMutationResult,
} from "../sync/processed-command-service.js";
import { createMongoSyncChangeService } from "../sync/sync-change-service.js";
import type { ClientSession } from "mongodb";
export type ReviewPageDocument = CommercialReviewPage & { _id: string };
export type ReviewDecisionDocument = SynchronizedCommercialReviewDecision & {
  pageId: string;
  sourceBlockIndex: number;
  _id: string;
};

/** Immutable snapshots, registered with the sync sequence in the same transaction. */
export async function registerCommercialReviewPages(
  database: DatabaseService,
  storeId: string,
  sourceDocumentId?: string,
) {
  const db = await database.getDb();
  const jobs = await db
    .collection<{
      _id: string;
      storeId: string;
      checksum: string;
      pageCount: number;
      parserVersion: string;
      aiModel: string;
      aiSchemaVersion: string;
    }>("commercialDocumentJobs")
    .find({
      storeId,
      status: "TO_VALIDATE",
      stage: "DRAFT_REVIEW",
      ...(sourceDocumentId ? { _id: sourceDocumentId } : {}),
    })
    .toArray();
  for (const job of jobs) {
    const pages = await db
      .collection<{
        _id: string;
        pageNumber: number;
        draft: CommercialReviewPage;
      }>("commercialDocumentAiPages")
      .find({
        storeId,
        sourceDocumentId: job._id,
        checksum: job.checksum,
        parserVersion: job.parserVersion,
        model: job.aiModel,
        schemaVersion: job.aiSchemaVersion,
        status: "DRAFT_READY",
      })
      .toArray();
    const source = await db
      .collection<{ _id: string; originalFilename?: string }>("sourceDocuments")
      .findOne({ _id: job._id, storeId });
    for (const page of pages) {
      const snapshot = commercialReviewPageSchema.parse({
        id: page._id,
        storeId,
        sourceDocumentId: job._id,
        checksum: job.checksum,
        pageNumber: page.pageNumber,
        pageCount: job.pageCount,
        originalFilename: source?.originalFilename ?? null,
        remoteVersion: 1,
        blocks: page.draft.blocks,
        warnings: page.draft.warnings,
        issues: page.draft.issues,
      });
      const prior = await db
        .collection<ReviewPageDocument>("commercialReviewPages")
        .findOne({ _id: snapshot.id });
      const assertSame = (existing: ReviewPageDocument) => {
        if (
          JSON.stringify(serializeCommercialReviewPage(existing)) !==
          JSON.stringify(snapshot)
        )
          throw Error("COMMERCIAL_REVIEW_IMMUTABLE_PAGE");
      };
      if (prior) {
        assertSame(prior);
        continue;
      }
      const session = db.client.startSession();
      try {
        await session.withTransaction(async () => {
          const collection = db.collection<ReviewPageDocument>(
            "commercialReviewPages",
          );
          const existing = await collection.findOne(
            { _id: snapshot.id },
            { session },
          );
          if (existing) {
            assertSame(existing);
            return;
          }
          await collection.insertOne(
            { ...snapshot, _id: snapshot.id },
            { session },
          );
          await createMongoSyncChangeService().append(
            { database: db, session },
            {
              storeId,
              entityType: "commercial_review_page",
              entityId: snapshot.id,
              entityVersion: 1,
              operation: "UPSERT",
            },
          );
        });
      } catch (error) {
        if (
          typeof error !== "object" ||
          !error ||
          !("code" in error) ||
          error.code !== 11000
        )
          throw error;
        const recovered = await db
          .collection<ReviewPageDocument>("commercialReviewPages")
          .findOne({ _id: snapshot.id });
        if (!recovered) throw error;
        assertSame(recovered);
      } finally {
        await session.endSession();
      }
    }
  }
}
export function serializeCommercialReviewPage(page: ReviewPageDocument) {
  return commercialReviewPageSchema.parse(page);
}
export function serializeCommercialReviewDecision(
  decision: ReviewDecisionDocument,
) {
  return synchronizedCommercialReviewDecisionSchema.parse(decision);
}
export async function loadCommercialReviewEntity(
  db: Awaited<ReturnType<DatabaseService["getDb"]>>,
  storeId: string,
  id: string,
  type: string,
  session?: ClientSession,
) {
  if (type === "commercial_review_page") {
    const p = await db
      .collection<ReviewPageDocument>("commercialReviewPages")
      .findOne({ _id: id, storeId }, { session });
    return p ? serializeCommercialReviewPage(p) : null;
  }
  const d = await db
    .collection<ReviewDecisionDocument>("commercialReviewDecisions")
    .findOne({ _id: id, storeId }, { session });
  return d ? serializeCommercialReviewDecision(d) : null;
}
export async function applyCommercialReviewCommand(
  context: MongoCommandMutationContext,
  storeId: string,
  command: SyncCommand,
  requestId: string,
  changes: ReturnType<typeof createMongoSyncChangeService>,
): Promise<CommandMutationResult> {
  const reject = (code: string): CommandMutationResult => ({
    resultStatus: "REJECTED",
    resultingVersion: null,
    responseJson: {
      error: {
        code,
        messageFr:
          "La transcription ne peut pas être confirmée. Rechargez son extrait source.",
        retryable: false,
        requestId,
      },
    },
  });
  const parsed = commercialReviewDecisionSchema.safeParse(command.payload);
  if (
    !parsed.success ||
    parsed.data.storeId !== storeId ||
    parsed.data.id !== command.entityId ||
    command.entityType !== "commercial_review_decision" ||
    command.expectedRemoteVersion != null
  )
    return reject("COMMERCIAL_REVIEW_INVALID");
  const decision = parsed.data;
  const page = await context.database
    .collection<ReviewPageDocument>("commercialReviewPages")
    .findOne(
      {
        _id: decision.pageId,
        storeId,
        sourceDocumentId: decision.sourceDocumentId,
        checksum: decision.checksum,
      },
      { session: context.session },
    );
  const block = page?.blocks.find(
    (b) => b.sourceBlockIndex === decision.sourceBlockIndex,
  );
  if (
    !block ||
    decision.corrections.some(
      (c) => block.fields.filter((f) => f.name === c.name).length !== 1,
    )
  )
    return reject("COMMERCIAL_REVIEW_SOURCE_INVALID");
  const collection = context.database.collection<ReviewDecisionDocument>(
    "commercialReviewDecisions",
  );
  const existing = await collection.findOne(
    {
      storeId,
      pageId: decision.pageId,
      sourceBlockIndex: decision.sourceBlockIndex,
    },
    { session: context.session },
  );
  if (existing) {
    if (
      existing.id === decision.id &&
      JSON.stringify(existing.decision) === JSON.stringify(decision)
    )
      return {
        resultStatus: "APPLIED",
        resultingVersion: 1,
        responseJson: {
          remoteEntity: serializeCommercialReviewDecision(existing),
        },
      };
    return {
      resultStatus: "CONFLICT",
      resultingVersion: 1,
      responseJson: {
        remoteEntity: serializeCommercialReviewDecision(existing),
        error: {
          code: "COMMERCIAL_REVIEW_ALREADY_RECORDED",
          messageFr:
            "Cet extrait a déjà été examiné sur un autre appareil. Votre choix local reste conservé.",
          retryable: false,
          requestId,
        },
      },
    };
  }
  const duplicateId = await collection.findOne(
    { _id: decision.id },
    { session: context.session },
  );
  if (duplicateId) return reject("COMMERCIAL_REVIEW_IDENTITY_INVALID");
  const document: ReviewDecisionDocument = {
    _id: decision.id,
    pageId: decision.pageId,
    sourceBlockIndex: decision.sourceBlockIndex,
    id: decision.id,
    storeId,
    remoteVersion: 1,
    decision,
  };
  await collection.insertOne(document, { session: context.session });
  await changes.append(context, {
    storeId,
    entityType: "commercial_review_decision",
    entityId: decision.id,
    entityVersion: 1,
    operation: "UPSERT",
  });
  return {
    resultStatus: "APPLIED",
    resultingVersion: 1,
    responseJson: { remoteEntity: serializeCommercialReviewDecision(document) },
  };
}
