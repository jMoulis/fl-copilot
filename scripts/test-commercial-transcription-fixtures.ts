import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  CommercialReviewPage,
  CommercialReviewDecision,
} from "../packages/sync-contracts/src/index";
import { runLocalMigrations } from "../apps/mobile/src/db/migrations";
import {
  ReceiptTestDatabase,
  receiptReviewDigest,
} from "./test-receipt-publication-sqlite";
import {
  CommercialReviewRepository,
  applyCommercialReviewEntity,
} from "../apps/mobile/src/commercial/review-repository";
import { OutboxRepository } from "../apps/mobile/src/sync/outbox-repository";
import { ConflictRepository } from "../apps/mobile/src/sync/conflict-repository";

export async function nativeCommercialTranscriptionFixture(
  path = ":memory:",
  confidence = 0.8,
) {
  const db = new DatabaseSync(path),
    a = new ReceiptTestDatabase(db),
    storeId = randomUUID(),
    ownerId = randomUUID(),
    deviceId = randomUUID();
  await runLocalMigrations(a);
  const page: CommercialReviewPage = {
    id: randomUUID(),
    storeId,
    sourceDocumentId: randomUUID(),
    checksum: "sha256:transcription-fixture",
    pageNumber: 1,
    pageCount: 1,
    originalFilename: "week.pdf",
    remoteVersion: 1,
    warnings: [],
    issues: [],
    blocks: [
      {
        kind: "OFFER",
        label: "POIRE",
        sourceBlockIndex: 0,
        validationStatus: "TO_VALIDATE",
        evidence: [
          { pageNumber: 1, spanIndices: [0], quote: "POIRE 2,99 €/kg" },
        ],
        fields: [
          {
            name: "sellingPrice",
            rawValue: "2,99 €/kg",
            confidence,
            validationStatus: "TO_VALIDATE",
            evidence: [{ pageNumber: 1, spanIndices: [0], quote: "2,99 €/kg" }],
          },
        ],
      },
    ],
  };
  const local: CommercialReviewDecision = {
      id: randomUUID(),
      storeId,
      sourceDocumentId: page.sourceDocumentId,
      pageId: page.id,
      checksum: page.checksum,
      sourceBlockIndex: 0,
      decision: "CONFIRMED_TRANSCRIPTION",
      corrections: [{ name: "sellingPrice", value: "3,49 €/kg" }],
      reviewedAt: "2026-10-24T08:00:00.000Z",
    },
    remote: CommercialReviewDecision = {
      ...local,
      id: randomUUID(),
      decision: "DISMISSED",
      corrections: [],
    },
    envelope = {
      id: remote.id,
      storeId,
      remoteVersion: 1 as const,
      decision: remote,
    },
    repository = new CommercialReviewRepository(a, receiptReviewDigest);
  await applyCommercialReviewEntity(a, storeId, "commercial_review_page", page);
  await repository.review(local, deviceId, randomUUID());
  await applyCommercialReviewEntity(
    a,
    storeId,
    "commercial_review_decision",
    envelope,
  );
  const command = (await new OutboxRepository(a).listPending(storeId))[0]!,
    conflict = await new ConflictRepository(a).recordPushConflict(command, {
      commandId: command.commandId,
      status: "CONFLICT",
      entityType: command.entityType,
      entityId: local.id,
      remoteVersion: 1,
      remoteEntity: envelope,
    });
  await new OutboxRepository(a).markSyncing(command.commandId);
  await new OutboxRepository(a).markConflict(
    command.commandId,
    "COMMERCIAL_REVIEW_ALREADY_RECORDED",
  );
  return {
    db,
    a,
    scope: { storeId, ownerId, deviceId },
    page,
    local,
    remote,
    envelope,
    repository,
    command,
    conflict,
  };
}
