import { registerCommercialReviewPages } from "./review-sync.js";
import { createHash, randomUUID } from "node:crypto";
import type { ClientSession, Db } from "mongodb";
import {
  COMMERCIAL_AI_SCHEMA_VERSION,
  COMMERCIAL_VISUAL_SCHEMA_VERSION,
} from "@fl-copilot/domain";
import {
  commercialProcessingReviewSchema,
  commercialProcessingResumeSchema,
  type CommercialProcessingResume,
  type CommercialProcessingRequested,
  type CommercialProcessingStage,
} from "@fl-copilot/sync-contracts";
import { AuthError } from "../auth/service.js";
import type { DatabaseService } from "../database/types.js";
import {
  commercialProcessingPolicy,
  type ProcessingPage,
  type ProcessingSnapshot,
} from "./processing-recovery-policy.js";
type Options = { enabled: boolean; model: string };
type Actor = { userId: string; deviceId: string };
type RecoveryRequest = {
  _id: string;
  storeId: string;
  sourceDocumentId: string;
  userId: string;
  deviceId: string;
  checksum: string;
  requestJson: string;
  analysisRevision?: number;
  previousJob?: unknown;
  previousVisualJob?: unknown;
  stages: CommercialProcessingStage[];
  status: "PENDING" | "DISPATCHED" | "DELIVERY_FAILED";
  requestedAt: Date;
  updatedAt: Date;
  dispatchAttempts: number;
  nextDispatchAt?: Date | null;
  dispatchLeaseExpiresAt?: Date | null;
  dispatchToken?: string | null;
};
export type CommercialRecoveryDispatch = (input: {
  storeId: string;
  sourceDocumentId: string;
  operationId: string;
}) => Promise<void>;
export async function inspectCommercialProcessing(
  db: Db,
  storeId: string,
  id: string,
  options: Options,
  now: Date,
  session?: ClientSession,
) {
  const source = await db
    .collection<ProcessingSnapshot["source"]>("sourceDocuments")
    .findOne(
      {
        _id: id,
        storeId,
        sourceType: "WEEKLY_COMMERCIAL_PDF",
        remoteUploadStatus: "CONFIRMED",
        deletedAt: null,
      },
      {
        session,
        projection: { _id: 1, storeId: 1, checksum: 1, objectKey: 1 },
      },
    );
  if (!source || !/^sha256:[a-f0-9]{64}$/.test(source.checksum))
    throw new AuthError(
      404,
      "COMMERCIAL_SOURCE_NOT_FOUND",
      "Ce document n’est pas disponible pour ce magasin.",
    );
  const job = await db
    .collection<NonNullable<ProcessingSnapshot["job"]>>(
      "commercialDocumentJobs",
    )
    .findOne(
      { _id: id, storeId },
      {
        session,
        projection: {
          _id: 1,
          storeId: 1,
          sourceDocumentId: 1,
          checksum: 1,
          objectKey: 1,
          pipelineVersion: 1,
          analysisRevision: 1,
          status: 1,
          stage: 1,
          attemptCount: 1,
          pageCount: 1,
          parserVersion: 1,
          aiModel: 1,
          aiSchemaVersion: 1,
          leaseExpiresAt: 1,
          nextAttemptAt: 1,
          nextAiAttemptAt: 1,
          lastManualResumeAt: 1,
        },
      },
    );
  const textPages = job?.parserVersion
    ? await db
        .collection<{ _id: string; pageNumber: number; checksum: string }>(
          "commercialDocumentPages",
        )
        .find(
          { storeId, sourceDocumentId: id, parserVersion: job.parserVersion },
          { session, projection: { _id: 0, pageNumber: 1, checksum: 1 } },
        )
        .sort({ pageNumber: 1 })
        .limit(101)
        .toArray()
    : [];
  const aiPages = job?.parserVersion
    ? await db
        .collection("commercialDocumentAiPages")
        .aggregate<ProcessingPage>(
          [
            {
              $match: {
                storeId,
                sourceDocumentId: id,
                parserVersion: job.parserVersion,
                model: job.aiModel ?? options.model,
                schemaVersion:
                  job.aiSchemaVersion ?? COMMERCIAL_AI_SCHEMA_VERSION,
                analysisRevision: job.analysisRevision ?? null,
              },
            },
            {
              $project: {
                _id: 1,
                pageNumber: 1,
                status: 1,
                checksum: 1,
                attemptCount: 1,
                budgetAttemptCount: 1,
                runtimeBudgetVersion: 1,
                leaseExpiresAt: 1,
                nextAttemptAt: 1,
                hasResult: {
                  $and: [
                    { $ne: [{ $type: "$draft" }, "missing"] },
                    { $ne: ["$draft", null] },
                  ],
                },
              },
            },
            { $sort: { pageNumber: 1, _id: 1 } },
            { $limit: 101 },
          ],
          { session },
        )
        .toArray()
    : [];
  const visual = await db
    .collection<NonNullable<ProcessingSnapshot["visual"]>>(
      "commercialVisualJobs",
    )
    .findOne(
      { _id: id, storeId },
      {
        session,
        projection: {
          _id: 1,
          storeId: 1,
          sourceDocumentId: 1,
          checksum: 1,
          parserVersion: 1,
          analysisRevision: 1,
          model: 1,
          schemaVersion: 1,
          pageCount: 1,
          status: 1,
        },
      },
    );
  const visualPages = await db
    .collection("commercialVisualReadings")
    .aggregate<ProcessingPage>(
      [
        {
          $match: {
            storeId,
            sourceDocumentId: id,
            analysisRevision: visual?.analysisRevision ?? null,
            model: visual?.model ?? options.model,
            schemaVersion:
              visual?.schemaVersion ?? COMMERCIAL_VISUAL_SCHEMA_VERSION,
          },
        },
        {
          $project: {
            _id: 1,
            pageNumber: 1,
            status: 1,
            checksum: 1,
            attemptCount: 1,
            leaseExpiresAt: 1,
            nextAttemptAt: 1,
            hasResult: {
              $and: [
                { $ne: [{ $type: "$reading" }, "missing"] },
                { $ne: ["$reading", null] },
              ],
            },
          },
        },
        { $sort: { pageNumber: 1, _id: 1 } },
        { $limit: 101 },
      ],
      { session },
    )
    .toArray();
  const snapshot: ProcessingSnapshot = {
    source,
    job,
    textPages,
    aiPages,
    visual,
    visualPages,
    model: options.model,
    aiSchema: COMMERCIAL_AI_SCHEMA_VERSION,
    visualSchema: COMMERCIAL_VISUAL_SCHEMA_VERSION,
    enabled: options.enabled,
  };
  const policy = commercialProcessingPolicy(snapshot, now);
  const basisHash = createHash("sha256")
    .update(JSON.stringify(snapshot))
    .digest("hex");
  const { eligible, ...presentation } = policy;
  return {
    review: commercialProcessingReviewSchema.parse({
      sourceDocumentId: id,
      checksum: source.checksum,
      basisHash,
      observedAt: now.toISOString(),
      ...presentation,
    }),
    eligible,
    snapshot,
  };
}
export function createCommercialProcessingRecovery(
  database: DatabaseService,
  options: Options,
  dispatch?: CommercialRecoveryDispatch,
  now = () => new Date(),
) {
  async function dispatchOne(storeId: string, operationId: string) {
    const db = await database.getDb(),
      timestamp = now(),
      requests = db.collection<RecoveryRequest>(
        "commercialDocumentRecoveryRequests",
      );
    await requests.updateOne(
      {
        _id: operationId,
        storeId,
        status: "PENDING",
        dispatchAttempts: { $gte: 5 },
        $or: [
          { dispatchLeaseExpiresAt: null },
          { dispatchLeaseExpiresAt: { $lte: timestamp } },
        ],
      },
      {
        $set: {
          status: "DELIVERY_FAILED",
          dispatchLeaseExpiresAt: null,
          dispatchToken: null,
          updatedAt: timestamp,
        },
      },
    );
    const prior = await requests.findOne({ _id: operationId, storeId });
    if (prior?.status === "DISPATCHED") return;
    if (!prior || prior.status === "DELIVERY_FAILED")
      throw new AuthError(
        409,
        "COMMERCIAL_ANALYSIS_DELIVERY_FAILED",
        "Le service n’a pas pu recevoir cette demande. Actualisez l’état avant une nouvelle décision.",
      );
    const token = randomUUID();
    const claimed = await requests.findOneAndUpdate(
      {
        _id: operationId,
        storeId,
        status: "PENDING",
        dispatchAttempts: { $lt: 5 },
        $and: [
          {
            $or: [
              { nextDispatchAt: null },
              { nextDispatchAt: { $lte: timestamp } },
            ],
          },
          {
            $or: [
              { dispatchLeaseExpiresAt: null },
              { dispatchLeaseExpiresAt: { $lte: timestamp } },
            ],
          },
        ],
      },
      {
        $set: {
          dispatchToken: token,
          dispatchLeaseExpiresAt: new Date(timestamp.getTime() + 60_000),
          updatedAt: timestamp,
        },
        $inc: { dispatchAttempts: 1 },
      },
      { returnDocument: "after" },
    );
    if (!claimed)
      throw new AuthError(
        503,
        "COMMERCIAL_ANALYSIS_DISPATCH_PENDING",
        "La demande est conservée et attend le service de traitement.",
        true,
      );
    try {
      if (!dispatch) throw Error("dispatcher unavailable");
      await dispatch({
        storeId,
        sourceDocumentId: claimed.sourceDocumentId,
        operationId,
      });
      await requests.updateOne(
        { _id: operationId, storeId, dispatchToken: token },
        {
          $set: {
            status: "DISPATCHED",
            dispatchLeaseExpiresAt: null,
            dispatchToken: null,
            updatedAt: now(),
          },
        },
      );
    } catch {
      const exhausted = claimed.dispatchAttempts >= 5;
      await requests.updateOne(
        { _id: operationId, storeId, dispatchToken: token },
        {
          $set: {
            status: exhausted ? "DELIVERY_FAILED" : "PENDING",
            nextDispatchAt: new Date(now().getTime() + 60_000),
            dispatchLeaseExpiresAt: null,
            dispatchToken: null,
            updatedAt: now(),
          },
        },
      );
      throw new AuthError(
        exhausted ? 409 : 503,
        exhausted
          ? "COMMERCIAL_ANALYSIS_DELIVERY_FAILED"
          : "COMMERCIAL_ANALYSIS_DISPATCH_PENDING",
        exhausted
          ? "Le service n’a pas pu recevoir cette demande. Actualisez l’état avant une nouvelle décision."
          : "La demande est conservée et attend le service de traitement.",
        !exhausted,
      );
    }
  }
  return {
    async review(storeId: string, id: string) {
      return (
        await inspectCommercialProcessing(
          await database.getDb(),
          storeId,
          id,
          options,
          now(),
        )
      ).review;
    },
    async request(
      storeId: string,
      id: string,
      raw: CommercialProcessingResume,
      actor: Actor,
      authorize: () => Promise<void>,
    ): Promise<CommercialProcessingRequested> {
      await authorize();
      const input = commercialProcessingResumeSchema.parse(raw),
        requestJson = JSON.stringify({ storeId, id, input, actor });
      // Preserve a fully received historical text cohort before switching to a fresh visual generation.
      if (input.mode === "RESTART")
        await registerCommercialReviewPages(database, storeId, id);
      const db = await database.getDb(),
        session = db.client.startSession();
      try {
        await session.withTransaction(async () => {
          await authorize();
          const requests = db.collection<RecoveryRequest>(
              "commercialDocumentRecoveryRequests",
            ),
            existing = await requests.findOne(
              { _id: input.operationId },
              { session },
            );
          if (existing) {
            if (existing.requestJson !== requestJson)
              throw new AuthError(
                409,
                "COMMERCIAL_ANALYSIS_REQUEST_CHANGED",
                "Cette demande ne correspond plus à sa première version.",
              );
            return;
          }
          const current = await inspectCommercialProcessing(
            db,
            storeId,
            id,
            options,
            now(),
            session,
          );
          if (current.review.basisHash !== input.basisHash)
            throw new AuthError(
              409,
              "COMMERCIAL_ANALYSIS_STATE_CHANGED",
              "L’état a changé. Actualisez-le avant de reprendre l’analyse.",
            );
          if (
            !(input.mode === "RESTART"
              ? current.review.canRestart
              : current.review.canResume)
          )
            throw new AuthError(
              409,
              "COMMERCIAL_ANALYSIS_RESUME_BLOCKED",
              current.review.messageFr,
            );
          await authorize();
          const timestamp = now();
          const restart = input.mode === "RESTART";
          const revision = restart
            ? (current.snapshot.job?.analysisRevision ?? 0) + 1
            : current.snapshot.job?.analysisRevision;
          const previousJob = restart
            ? await db
                .collection<{ _id: string }>("commercialDocumentJobs")
                .findOne({ _id: id, storeId }, { session })
            : undefined;
          const previousVisualJob = restart
            ? await db
                .collection<{ _id: string }>("commercialVisualJobs")
                .findOne({ _id: id, storeId }, { session })
            : undefined;
          if (restart) {
            await db
              .collection<{ _id: string }>("commercialDocumentJobs")
              .updateOne(
                { _id: id, storeId },
                {
                  $set: {
                    analysisRevision: revision,
                    status: "TEXT_READY",
                    stage: "VISUAL_READING",
                    updatedAt: timestamp,
                  },
                },
                { session },
              );
            await db
              .collection<{ _id: string }>("commercialVisualJobs")
              .updateOne(
                { _id: id, storeId },
                {
                  $set: {
                    _id: id,
                    storeId,
                    sourceDocumentId: id,
                    checksum: current.review.checksum,
                    parserVersion: current.snapshot.job!.parserVersion,
                    pageCount: current.snapshot.job!.pageCount,
                    model: options.model,
                    schemaVersion: COMMERCIAL_VISUAL_SCHEMA_VERSION,
                    analysisRevision: revision,
                    status: "PENDING",
                    createdAt: timestamp,
                  },
                },
                { upsert: true, session },
              );
          }
          await db
            .collection<{ _id: string; storeId: string }>(
              "commercialDocumentJobs",
            )
            .updateOne(
              { _id: id, storeId },
              { $set: { lastManualResumeAt: timestamp } },
              { session },
            );
          await requests.insertOne(
            {
              _id: input.operationId,
              storeId,
              sourceDocumentId: id,
              ...actor,
              checksum: current.review.checksum,
              requestJson,
              stages: restart ? ["VISUAL"] : current.eligible,
              ...(revision ? { analysisRevision: revision } : {}),
              ...(restart ? { previousJob, previousVisualJob } : {}),
              status: "PENDING",
              dispatchAttempts: 0,
              requestedAt: timestamp,
              updatedAt: timestamp,
            },
            { session },
          );
          await authorize();
        });
      } catch (error) {
        if (!(
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === 11000
        ))
          throw error;
        const existing = await db
          .collection<RecoveryRequest>("commercialDocumentRecoveryRequests")
          .findOne({ _id: input.operationId });
        if (existing?.requestJson !== requestJson)
          throw new AuthError(
            409,
            "COMMERCIAL_ANALYSIS_REQUEST_CHANGED",
            "Cette demande ne correspond plus à sa première version.",
          );
      } finally {
        await session.endSession();
      }
      await authorize();
      await dispatchOne(storeId, input.operationId);
      return {
        operationId: input.operationId,
        sourceDocumentId: id,
        status: "REQUESTED",
      };
    },
    async pendingDispatches() {
      const db = await database.getDb(),
        timestamp = now();
      const expired = await db
        .collection<RecoveryRequest>("commercialDocumentRecoveryRequests")
        .find({
          status: "PENDING",
          dispatchAttempts: { $gte: 5 },
          $or: [
            { dispatchLeaseExpiresAt: null },
            { dispatchLeaseExpiresAt: { $lte: timestamp } },
          ],
        })
        .sort({ requestedAt: 1 })
        .limit(5)
        .toArray();
      for (const row of expired)
        await db
          .collection<RecoveryRequest>("commercialDocumentRecoveryRequests")
          .updateOne(
            {
              _id: row._id,
              status: "PENDING",
              dispatchAttempts: { $gte: 5 },
              $or: [
                { dispatchLeaseExpiresAt: null },
                { dispatchLeaseExpiresAt: { $lte: timestamp } },
              ],
            },
            {
              $set: {
                status: "DELIVERY_FAILED",
                dispatchLeaseExpiresAt: null,
                dispatchToken: null,
                updatedAt: timestamp,
              },
            },
          );
      const rows = await db
        .collection<RecoveryRequest>("commercialDocumentRecoveryRequests")
        .find({
          status: "PENDING",
          dispatchAttempts: { $lt: 5 },
          $and: [
            {
              $or: [
                { nextDispatchAt: null },
                { nextDispatchAt: { $lte: timestamp } },
              ],
            },
            {
              $or: [
                { dispatchLeaseExpiresAt: null },
                { dispatchLeaseExpiresAt: { $lte: timestamp } },
              ],
            },
          ],
        })
        .sort({ requestedAt: 1 })
        .limit(5)
        .toArray();
      let dispatched = 0;
      for (const row of rows)
        try {
          await dispatchOne(row.storeId, row._id);
          dispatched++;
        } catch {
          /* Durable request retains its bounded dispatch retry; no provider details. */
        }
      return dispatched;
    },
    async work(storeId: string, id: string, operationId: string) {
      const db = await database.getDb(),
        request = await db
          .collection<RecoveryRequest>("commercialDocumentRecoveryRequests")
          .findOne({ _id: operationId, storeId, sourceDocumentId: id });
      if (!request) return [] as CommercialProcessingStage[];
      const current = await inspectCommercialProcessing(
        db,
        storeId,
        id,
        options,
        now(),
      );
      if (
        request.checksum !== current.review.checksum ||
        (request.analysisRevision ?? 0) !==
          (current.snapshot.job?.analysisRevision ?? 0)
      )
        return [] as CommercialProcessingStage[];
      return current.eligible.filter((stage) => request.stages.includes(stage));
    },
  };
}
export type CommercialProcessingRecoveryService = ReturnType<
  typeof createCommercialProcessingRecovery
>;
