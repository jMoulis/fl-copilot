import {
  copilotReceiptCameraSelectionSchema,
  type CopilotReceiptCameraSelection,
} from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import { CopilotReceiptPhotoIntake } from "./receipt-photo-intake";
import {
  CopilotReceiptViewsIntake,
  nativeReceiptViewsIntakeStorage,
  type ReceiptViewsIntakeStorage,
} from "./receipt-views-intake";
/** Camera capture is another selection source for the same canonical receipt workflows. */
export class CopilotReceiptCameraIntake {
  constructor(
    private readonly db: OutboxDatabase & AtomicMutationDatabase,
    private readonly scope: { storeId: string; ownerId: string },
    private readonly id: () => string,
    private readonly storage: ReceiptViewsIntakeStorage = nativeReceiptViewsIntakeStorage,
    private readonly now = () => new Date().toISOString(),
  ) {}
  capture(
    conversationId: string,
    raw: CopilotReceiptCameraSelection,
    authority: { canCapture(): boolean; signal: AbortSignal },
    capacity: number,
  ) {
    const input = copilotReceiptCameraSelectionSchema.parse(raw);
    if (input.assets.length === 1)
      return new CopilotReceiptPhotoIntake(
        this.db,
        this.scope,
        this.id,
        this.storage,
        this.now,
      ).capture(
        conversationId,
        { mode: "ONE_PHOTO_PER_RECEIPT", assets: input.assets },
        authority,
        capacity,
      );
    return new CopilotReceiptViewsIntake(
      this.db,
      this.scope,
      this.id,
      this.storage,
      this.now,
    ).capture(
      conversationId,
      { mode: "ONE_RECEIPT_MULTIPLE_PHOTOS", assets: input.assets },
      authority,
      capacity,
    );
  }
}
