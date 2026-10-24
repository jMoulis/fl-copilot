import { randomUUID } from "node:crypto";
import { nativeLayoutConflictFixture } from "./test-layout-conflict-fixtures";
import { storeConflictPreview } from "./test-store-conflict-fixtures";
import { receiptReviewDigest } from "./test-receipt-publication-sqlite";
import { buildStoreConflictMessages } from "../apps/api/src/copilot/store-conflict-messages";
import { applyCopilotRecord } from "../apps/mobile/src/copilot/conversation-repository";
import { CopilotStoreConflictController } from "../apps/mobile/src/copilot/store-conflict-controller";
export async function nativeLayoutChatConflictFixture(path = ":memory:") {
  const s = await nativeLayoutConflictFixture(path),
    preview = storeConflictPreview("STORE_LAYOUT", s.review.remote),
    message = buildStoreConflictMessages(s.f.assistant, [preview])[0]!,
    scope = {
      storeId: s.scope.storeId,
      ownerId: s.scope.ownerId,
      deviceId: s.scope.deviceId,
      canManageStoreLayout: true,
      canCaptureStoreEvents: false,
      canManageStoreSettings: false,
    },
    controller = new CopilotStoreConflictController(
      s.a,
      scope,
      receiptReviewDigest,
      randomUUID,
    );
  await s.a.withExclusiveTransactionAsync((tx) =>
    applyCopilotRecord(tx, s.f.chat, "copilot_message", message),
  );
  return {
    ...s,
    preview,
    message,
    chatScope: scope,
    controller,
    state: await controller.open(message),
  };
}
