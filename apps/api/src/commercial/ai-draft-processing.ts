import {
  COMMERCIAL_AI_PAGE_LEASE_MS,
  COMMERCIAL_AI_RUNTIME_BUDGET_VERSION,
} from "./ai-runtime-limits.js";
import type { Db } from "mongodb";
import { randomUUID } from "node:crypto";
import {
  commercialPdfPageSchema,
  COMMERCIAL_AI_SCHEMA_VERSION,
  type CommercialPdfPage,
} from "@fl-copilot/domain";
import {
  anchorCommercialAiDraft,
  selectCommercialAiContext,
  type AnchoredCommercialDraft,
} from "@fl-copilot/commercial-core";
import type { DatabaseService } from "../database/types.js";
import {
  CommercialAiPermanentError,
  type CommercialAiProvider,
} from "./ai-provider.js";

type Job = {
  _id: string;
  storeId: string;
  sourceDocumentId: string;
  checksum: string;
  status: string;
  stage: string;
  parserVersion?: string;
  pageCount?: number;
  aiModel?: string;
  aiSchemaVersion?: string;
  nextAiAttemptAt?: Date | null;
};
type Page = CommercialPdfPage & {
  _id: string;
  storeId: string;
  sourceDocumentId: string;
  checksum: string;
  parserVersion: string;
};
type DraftPage = {
  _id: string;
  storeId: string;
  sourceDocumentId: string;
  pageNumber: number;
  parserVersion: string;
  schemaVersion: string;
  model: string;
  checksum: string;
  status: string;
  attemptCount?: number;
  budgetAttemptCount?: number;
  runtimeBudgetVersion?: number;
  leaseToken?: string | null;
  leaseExpiresAt?: Date | null;
  draft?: AnchoredCommercialDraft;
  errorCode?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
};
function duplicateKey(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}
export function createCommercialAiDraftProcessor(
  database: DatabaseService,
  provider: CommercialAiProvider,
  now: () => Date = () => new Date(),
) {
  return {
    async pendingDocuments() {
      const db = await database.getDb();
      await recoverLegacyBudgetFailures(db, provider.model, now());
      return db
        .collection<Job>("commercialDocumentJobs")
        .find({
          stage: "AI_EXTRACTION",
          status: { $in: ["TEXT_READY", "PROCESSING"] },
          $or: [
            { nextAiAttemptAt: { $exists: false } },
            { nextAiAttemptAt: null },
            { nextAiAttemptAt: { $lte: now() } },
          ],
        })
        .sort({ updatedAt: 1 })
        .limit(5)
        .project<{ storeId: string; sourceDocumentId: string }>({
          _id: 0,
          storeId: 1,
          sourceDocumentId: 1,
        })
        .toArray();
    },
    async manifest(storeId: string, sourceDocumentId: string) {
      const db = await database.getDb();
      const jobs = db.collection<Job>("commercialDocumentJobs");
      await recoverLegacyBudgetFailures(db, provider.model, now(), {
        storeId,
        sourceDocumentId,
      });
      await jobs.updateOne(
        {
          _id: sourceDocumentId,
          storeId,
          stage: "AI_EXTRACTION",
          status: { $in: ["TEXT_READY", "PROCESSING"] },
          aiModel: { $exists: false },
        },
        {
          $set: {
            aiModel: provider.model,
            aiSchemaVersion: COMMERCIAL_AI_SCHEMA_VERSION,
          },
        },
      );
      const job = await jobs.findOne({
        _id: sourceDocumentId,
        storeId,
        stage: "AI_EXTRACTION",
        status: { $in: ["TEXT_READY", "PROCESSING"] },
      });
      if (!job) return { status: "SKIPPED", pages: [] as number[] };
      if (
        job.aiModel !== provider.model ||
        job.aiSchemaVersion !== COMMERCIAL_AI_SCHEMA_VERSION ||
        !job.parserVersion ||
        !job.pageCount
      ) {
        await jobs.updateOne(
          { _id: sourceDocumentId, storeId, stage: "AI_EXTRACTION" },
          {
            $set: {
              status: "AI_FAILED",
              errorCode: "COMMERCIAL_AI_SOURCE_NOT_READY",
              updatedAt: now(),
            },
          },
        );
        return { status: "FAILED", pages: [] as number[] };
      }
      const pages = await db
        .collection<Page>("commercialDocumentPages")
        .find({
          storeId,
          sourceDocumentId,
          parserVersion: job.parserVersion,
          checksum: job.checksum,
        })
        .sort({ pageNumber: 1 })
        .toArray();
      if (
        pages.length !== job.pageCount ||
        pages.some((p, index) => p.pageNumber !== index + 1)
      ) {
        await jobs.updateOne(
          { _id: sourceDocumentId, storeId, stage: "AI_EXTRACTION" },
          {
            $set: {
              status: "AI_FAILED",
              errorCode: "COMMERCIAL_AI_SOURCE_NOT_READY",
              updatedAt: now(),
            },
          },
        );
        return { status: "FAILED", pages: [] as number[] };
      }
      await jobs.updateOne(
        {
          _id: sourceDocumentId,
          storeId,
          stage: "AI_EXTRACTION",
          status: { $in: ["TEXT_READY", "PROCESSING"] },
        },
        {
          $set: {
            status: "PROCESSING",
            nextAiAttemptAt: new Date(now().getTime() + 5 * 60_000),
            updatedAt: now(),
          },
        },
      );
      return { status: "READY", pages: pages.map((page) => page.pageNumber) };
    },
    async extractPage(
      storeId: string,
      sourceDocumentId: string,
      pageNumber: number,
    ) {
      const db = await database.getDb();
      const job = await db.collection<Job>("commercialDocumentJobs").findOne({
        _id: sourceDocumentId,
        storeId,
        stage: "AI_EXTRACTION",
        status: { $in: ["TEXT_READY", "PROCESSING"] },
      });
      if (
        !job ||
        !job.parserVersion ||
        job.aiModel !== provider.model ||
        job.aiSchemaVersion !== COMMERCIAL_AI_SCHEMA_VERSION
      )
        return { status: "SKIPPED", pageNumber };
      const identity = {
        storeId,
        sourceDocumentId,
        pageNumber,
        parserVersion: job.parserVersion,
        schemaVersion: COMMERCIAL_AI_SCHEMA_VERSION,
        model: provider.model,
      };
      const drafts = db.collection<DraftPage>("commercialDocumentAiPages");
      const existing = await drafts.findOne(identity);
      if (existing?.status === "DRAFT_READY")
        return {
          status: "DRAFT_READY",
          pageNumber,
          blockCount: existing.draft?.blocks.length ?? 0,
        };
      if (existing?.status === "FAILED")
        return { status: "FAILED", pageNumber };
      const token = randomUUID();
      const timestamp = now();
      try {
        await drafts.updateOne(
          identity,
          {
            $setOnInsert: {
              ...identity,
              _id: randomUUID(),
              checksum: job.checksum,
              status: "RETRY",
              runtimeBudgetVersion: COMMERCIAL_AI_RUNTIME_BUDGET_VERSION,
              budgetAttemptCount: 0,
              attemptCount: 0,
              createdAt: timestamp,
            },
          },
          { upsert: true },
        );
      } catch (error) {
        if (!duplicateKey(error)) throw error;
      }
      await drafts.updateOne(
        {
          ...identity,
          status: "PENDING",
          runtimeBudgetVersion: { $exists: false },
        },
        {
          $set: {
            status: "RETRY",
            runtimeBudgetVersion: COMMERCIAL_AI_RUNTIME_BUDGET_VERSION,
            budgetAttemptCount: 0,
          },
        },
      );
      const claimed = await drafts.findOneAndUpdate(
        {
          ...identity,
          $or: [
            { status: { $in: ["PENDING", "RETRY"] } },
            { status: "PROCESSING", leaseExpiresAt: { $lte: timestamp } },
          ],
        },
        {
          $set: {
            status: "PROCESSING",
            runtimeBudgetVersion: COMMERCIAL_AI_RUNTIME_BUDGET_VERSION,
            leaseToken: token,
            leaseExpiresAt: new Date(
              timestamp.getTime() + COMMERCIAL_AI_PAGE_LEASE_MS,
            ),
            updatedAt: timestamp,
          },
          $inc: { attemptCount: 1, budgetAttemptCount: 1 },
        },
        { returnDocument: "after" },
      );
      if (!claimed) return { status: "IN_PROGRESS", pageNumber };
      try {
        if ((claimed.budgetAttemptCount ?? claimed.attemptCount ?? 1) > 4)
          throw new CommercialAiPermanentError("COMMERCIAL_AI_ATTEMPT_LIMIT");
        const records = await db
          .collection<Page>("commercialDocumentPages")
          .find({
            storeId,
            sourceDocumentId,
            parserVersion: job.parserVersion,
            checksum: job.checksum,
          })
          .sort({ pageNumber: 1 })
          .toArray();
        const pages = records.map((record) =>
          commercialPdfPageSchema.parse(record),
        );
        const target = pages.find((page) => page.pageNumber === pageNumber);
        if (!target)
          throw new CommercialAiPermanentError(
            "COMMERCIAL_AI_SOURCE_NOT_READY",
          );
        let rawOutput: unknown = {
          blocks: [],
          warnings: ["NO_EXTRACTABLE_TEXT"],
        };
        let responseId: string | null = null;
        let resolvedModel: string | null = null;
        let usage: { inputTokens: number | null; outputTokens: number | null } =
          { inputTokens: null, outputTokens: null };
        let context = [target];
        if (target.text) {
          try {
            context = selectCommercialAiContext(target, pages);
          } catch {
            throw new CommercialAiPermanentError(
              "COMMERCIAL_AI_PAGE_SIZE_LIMIT",
            );
          }
          const result = await provider.extract(pageNumber, context);
          rawOutput = result.output;
          responseId = result.responseId;
          resolvedModel = result.resolvedModel;
          usage = result.usage;
        }
        let draft: AnchoredCommercialDraft;
        try {
          draft = anchorCommercialAiDraft(rawOutput, pageNumber, context);
        } catch {
          throw new CommercialAiPermanentError("COMMERCIAL_AI_OUTPUT_INVALID");
        }
        const updated = await drafts.updateOne(
          { ...identity, leaseToken: token },
          {
            $set: {
              status: "DRAFT_READY",
              rawOutput,
              draft,
              responseId,
              resolvedModel,
              usage,
              contextPages: context.map((page) => page.pageNumber),
              leaseToken: null,
              leaseExpiresAt: null,
              errorCode: null,
              updatedAt: now(),
            },
          },
        );
        await db.collection<Job>("commercialDocumentJobs").updateOne(
          {
            _id: sourceDocumentId,
            storeId,
            stage: "AI_EXTRACTION",
            status: { $in: ["TEXT_READY", "PROCESSING"] },
          },
          {
            $set: {
              nextAiAttemptAt: new Date(now().getTime() + 5 * 60_000),
              updatedAt: now(),
            },
          },
        );
        return {
          status: updated.modifiedCount ? "DRAFT_READY" : "LEASE_LOST",
          pageNumber,
          blockCount: draft.blocks.length,
          issueCount: draft.issues.length,
        };
      } catch (error) {
        const permanent = error instanceof CommercialAiPermanentError;
        const failureElapsedMs = Math.max(
          0,
          now().getTime() - timestamp.getTime(),
        );
        const failureType = permanent
          ? "PERMANENT"
          : error instanceof Error &&
              ["AbortError", "TimeoutError"].includes(error.name)
            ? "TIMEOUT"
            : "TEMPORARY";
        await drafts.updateOne(
          { ...identity, leaseToken: token },
          {
            $set: {
              status: permanent ? "FAILED" : "RETRY",
              lastFailureElapsedMs: failureElapsedMs,
              lastFailureType: failureType,
              leaseToken: null,
              leaseExpiresAt: null,
              errorCode: permanent
                ? error.code
                : "COMMERCIAL_AI_TEMPORARILY_UNAVAILABLE",
              updatedAt: now(),
            },
          },
        );
        if (!permanent)
          throw new Error("COMMERCIAL_AI_TEMPORARILY_UNAVAILABLE");
        return { status: "FAILED", pageNumber, errorCode: error.code };
      }
    },
    // Explicit maintenance action after a confirmed output-budget failure.
    async retryTruncatedPage(
      storeId: string,
      sourceDocumentId: string,
      pageNumber: number,
    ) {
      const db = await database.getDb();
      const session = db.client.startSession();
      try {
        await session.withTransaction(async () => {
          const jobs = db.collection<Job>("commercialDocumentJobs");
          const job = await jobs.findOne(
            {
              _id: sourceDocumentId,
              storeId,
              aiModel: provider.model,
              aiSchemaVersion: COMMERCIAL_AI_SCHEMA_VERSION,
              stage: "AI_EXTRACTION",
              status: { $in: ["AI_FAILED", "TEXT_READY"] },
            },
            { session },
          );
          if (!job) throw new Error("COMMERCIAL_AI_RETRY_UNSAFE");
          const pages = db.collection<DraftPage>("commercialDocumentAiPages");
          const page = await pages.findOne(
            {
              storeId,
              sourceDocumentId,
              pageNumber,
              parserVersion: job.parserVersion,
              schemaVersion: COMMERCIAL_AI_SCHEMA_VERSION,
              model: provider.model,
              checksum: job.checksum,
              status: "FAILED",
              draft: { $exists: false },
              runtimeBudgetVersion: {
                $lt: COMMERCIAL_AI_RUNTIME_BUDGET_VERSION,
              },
              errorCode: {
                $in: [
                  "COMMERCIAL_AI_OUTPUT_INVALID",
                  "COMMERCIAL_AI_OUTPUT_TOKEN_LIMIT",
                ],
              },
            },
            { session },
          );
          if (!page) throw new Error("COMMERCIAL_AI_RETRY_UNSAFE");
          const result = await pages.updateOne(
            { _id: page._id, status: "FAILED", draft: { $exists: false } },
            {
              $set: {
                status: "RETRY",
                runtimeBudgetVersion: COMMERCIAL_AI_RUNTIME_BUDGET_VERSION,
                budgetAttemptCount: 0,
                errorCode: null,
                previousErrorCode: page.errorCode,
                retryReason: "CONFIRMED_OUTPUT_TRUNCATION",
                leaseToken: null,
                leaseExpiresAt: null,
                updatedAt: now(),
              },
            },
            { session },
          );
          if (result.modifiedCount !== 1)
            throw new Error("COMMERCIAL_AI_RETRY_UNSAFE");
          await jobs.updateOne(
            { _id: sourceDocumentId, storeId, stage: "AI_EXTRACTION" },
            {
              $set: {
                status: "TEXT_READY",
                nextAiAttemptAt: null,
                updatedAt: now(),
              },
            },
            { session },
          );
        });
      } finally {
        await session.endSession();
      }
    },
    async finalize(storeId: string, sourceDocumentId: string) {
      const db = await database.getDb();
      const jobs = db.collection<Job>("commercialDocumentJobs");
      const job = await jobs.findOne({
        _id: sourceDocumentId,
        storeId,
        stage: "AI_EXTRACTION",
      });
      if (!job) return { status: "SKIPPED" };
      const pages = await db
        .collection<DraftPage>("commercialDocumentAiPages")
        .find({
          storeId,
          sourceDocumentId,
          parserVersion: job.parserVersion,
          schemaVersion: COMMERCIAL_AI_SCHEMA_VERSION,
          model: job.aiModel,
        })
        .toArray();
      const failed = pages.some((page) => page.status === "FAILED");
      const ready =
        pages.length === job.pageCount &&
        pages.every((page) => page.status === "DRAFT_READY");
      const status = failed
        ? "AI_FAILED"
        : ready
          ? "TO_VALIDATE"
          : "TEXT_READY";
      const blockCount = pages.reduce(
        (sum, page) => sum + (page.draft?.blocks.length ?? 0),
        0,
      );
      const issueCount = pages.reduce(
        (sum, page) =>
          sum +
          (page.draft?.issues.length ?? 0) +
          (page.draft?.warnings.length ?? 0),
        0,
      );
      await jobs.updateOne(
        {
          _id: sourceDocumentId,
          storeId,
          stage: "AI_EXTRACTION",
          status: { $in: ["TEXT_READY", "PROCESSING"] },
        },
        {
          $set: {
            status,
            stage: ready ? "DRAFT_REVIEW" : "AI_EXTRACTION",
            draftBlockCount: blockCount,
            draftIssueCount: issueCount,
            nextAiAttemptAt:
              ready || failed ? null : new Date(now().getTime() + 5 * 60_000),
            updatedAt: now(),
          },
        },
      );
      return { status, blockCount, issueCount };
    },
  };
}

async function recoverLegacyBudgetFailures(
  db: Db,
  model: string,
  timestamp: Date,
  scope?: { storeId: string; sourceDocumentId: string },
) {
  const pages = db.collection<DraftPage>("commercialDocumentAiPages");
  const legacy = await pages
    .find({
      ...scope,
      model,
      schemaVersion: COMMERCIAL_AI_SCHEMA_VERSION,
      runtimeBudgetVersion: { $exists: false },
      status: { $in: ["PENDING", "FAILED"] },
      draft: { $exists: false },
      errorCode: {
        $in: [
          "COMMERCIAL_AI_TEMPORARILY_UNAVAILABLE",
          "COMMERCIAL_AI_ATTEMPT_LIMIT",
        ],
      },
    })
    .sort({ createdAt: 1 })
    .limit(100)
    .toArray();
  const sources = new Map<string, DraftPage>();
  for (const page of legacy) {
    await pages.updateOne(
      {
        _id: page._id,
        runtimeBudgetVersion: { $exists: false },
        status: { $in: ["PENDING", "FAILED"] },
        draft: { $exists: false },
      },
      {
        $set: {
          status: "RETRY",
          runtimeBudgetVersion: COMMERCIAL_AI_RUNTIME_BUDGET_VERSION,
          budgetAttemptCount: 0,
          leaseToken: null,
          leaseExpiresAt: null,
          errorCode: null,
          updatedAt: timestamp,
        },
      },
    );
    sources.set(`${page.storeId}:${page.sourceDocumentId}`, page);
  }
  for (const page of sources.values()) {
    const remainingFailures = await pages.countDocuments({
      storeId: page.storeId,
      sourceDocumentId: page.sourceDocumentId,
      model,
      parserVersion: page.parserVersion,
      schemaVersion: COMMERCIAL_AI_SCHEMA_VERSION,
      status: "FAILED",
    });
    if (remainingFailures) continue;
    await db.collection<Job>("commercialDocumentJobs").updateOne(
      {
        _id: page.sourceDocumentId,
        storeId: page.storeId,
        aiModel: model,
        aiSchemaVersion: COMMERCIAL_AI_SCHEMA_VERSION,
        stage: "AI_EXTRACTION",
        status: "AI_FAILED",
      },
      {
        $set: {
          status: "TEXT_READY",
          nextAiAttemptAt: null,
          updatedAt: timestamp,
        },
      },
    );
  }
}
