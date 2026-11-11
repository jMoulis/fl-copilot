import { createHash } from "node:crypto";
import type { Db, Document } from "mongodb";
import {
  documentReadyNotificationSchema,
  expoPushTokenSchema,
} from "@fl-copilot/sync-contracts";
import { sendDevicePush, type PushSession } from "./chat-completion.js";

/** Best-effort, once per conserved processing result. No admission or publication. */
export async function notifyDocumentReady(
  db: Db,
  storeId: string,
  sourceDocumentId: string,
  options: { fetch?: typeof fetch; accessToken?: string } = {},
) {
  const sources = db.collection<Document & { _id: string }>("sourceDocuments");
  const sourceFilter = {
    _id: sourceDocumentId,
    storeId,
    remoteUploadStatus: "CONFIRMED",
    deletedAt: null,
  };
  const source = await sources.findOne(sourceFilter);
  if (
    !source ||
    !["WEEKLY_COMMERCIAL_PDF", "WASTE_RECEIPT"].includes(source.sourceType)
  )
    return;
  const upload = await db.collection("sourceUploads").findOne({
    sourceDocumentId,
    storeId,
    checksum: source.checksum,
    objectKey: source.objectKey,
    status: "CONFIRMED",
  });
  if (!upload?.userId) return;
  let resultIdentity: string;
  let currentResult: () => Promise<unknown>;
  if (source.sourceType === "WEEKLY_COMMERCIAL_PDF") {
    const job = await db
      .collection<Document & { _id: string }>("commercialDocumentJobs")
      .findOne({
        _id: sourceDocumentId,
        storeId,
        checksum: source.checksum,
        objectKey: source.objectKey,
        status: {
          $in: ["TEXT_READY", "PROCESSING", "TO_VALIDATE", "AI_FAILED"],
        },
        parserVersion: { $type: "string" },
        pageCount: { $gte: 1 },
      });
    if (!job) return;
    resultIdentity = `${job.parserVersion}:${job.analysisRevision ?? 0}`;
    currentResult = () =>
      db
        .collection<Document & { _id: string }>("commercialDocumentJobs")
        .findOne({
          _id: sourceDocumentId,
          storeId,
          checksum: source.checksum,
          objectKey: source.objectKey,
          parserVersion: job.parserVersion,
          analysisRevision: job.analysisRevision ?? null,
          pageCount: job.pageCount,
          status: {
            $in: ["TEXT_READY", "PROCESSING", "TO_VALIDATE", "AI_FAILED"],
          },
        });
  } else {
    if (
      source.productMatchingStatus !== "READY" ||
      !source.extractionId ||
      !source.productMatchingId
    )
      return;
    resultIdentity = `${source.extractionId}:${source.productMatchingId}`;
    currentResult = () =>
      sources.findOne({
        ...sourceFilter,
        checksum: source.checksum,
        extractionId: source.extractionId,
        productMatchingId: source.productMatchingId,
        productMatchingStatus: "READY",
      });
  }
  const notificationKey = createHash("sha256")
    .update(`${sourceDocumentId}:${source.checksum}:${resultIdentity}`)
    .digest("hex");
  const data = documentReadyNotificationSchema.parse({
    kind: "SOURCE_DOCUMENT_READY",
    resultKey: notificationKey,
    ownerId: upload.userId,
    storeId,
    sourceDocumentId,
    sourceType: source.sourceType,
  });
  const membership = () =>
    db.collection("storeMemberships").findOne({
      storeId,
      userId: data.ownerId,
      role: "MANAGER",
      active: true,
    });
  if (!(await membership())) return;
  const sessions = db.collection<PushSession>("deviceSessions");
  const sessionFilter = {
    userId: data.ownerId,
    revokedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
    "push.storeId": storeId,
    "push.channels.documents": true,
  };
  if (!(await sessions.findOne(sessionFilter))) return;
  if (!(await currentResult())) return;
  const claimFilter = {
    ...sourceFilter,
    checksum: source.checksum,
    sourceType: source.sourceType,
    objectKey: source.objectKey,
    ...(source.sourceType === "WASTE_RECEIPT"
      ? {
          productMatchingId: source.productMatchingId,
          extractionId: source.extractionId,
        }
      : {}),
    processingNotificationKey: { $ne: notificationKey },
  };
  const claim = await sources.updateOne(claimFilter, {
    $set: { processingNotificationKey: notificationKey },
  });
  if (!claim.modifiedCount) return;
  let failed = false;
  for await (const candidate of sessions.find(sessionFilter)) {
    const liveSource = await sources.findOne({
      ...claimFilter,
      processingNotificationKey: notificationKey,
    });
    if (!liveSource || !(await currentResult()) || !(await membership()))
      return;
    const live = await sessions.findOne({
      ...sessionFilter,
      _id: candidate._id,
      expiresAt: { $gt: new Date() },
    });
    if (!live?.push || !expoPushTokenSchema.safeParse(live.push.token).success)
      continue;
    try {
      await sendDevicePush(
        db,
        live._id,
        live.push.token,
        {
          title: "Ton document est prêt à consulter",
          body:
            source.sourceType === "WASTE_RECEIPT"
              ? "La lecture du ticket est terminée. Retrouve les lignes à vérifier dans Casse."
              : "Les pages de ton pense-bête sont prêtes à consulter dans Documents commerciaux.",
          data,
          collapseId: notificationKey,
        },
        options,
      );
    } catch {
      failed = true;
    }
  }
  if (failed) throw Error("DOCUMENT_PUSH_DELIVERY_FAILED");
}
