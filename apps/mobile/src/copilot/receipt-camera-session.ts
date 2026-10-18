import { z } from "zod";
import {
  MAX_RECEIPT_VIEWS,
  type CopilotReceiptCameraSelection,
} from "@fl-copilot/domain";
import type { ReceiptPhotoSelection } from "./receipt-photo-intake";
type Asset = CopilotReceiptCameraSelection["assets"][number];
export type ReceiptCameraPicture = {
  uri: string;
  width: number;
  height: number;
  format: "jpg" | "png";
};
const pictureSchema = z.strictObject({
  uri: z.string().startsWith("file://").min(8).max(4096),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  format: z.enum(["jpg", "png"]),
});
/** Ephemeral framing/review state. Only explicit save enters the canonical durable capture. */
export class ReceiptCameraSession {
  private views: Asset[] = [];
  private stage: "CAMERA" | "REVIEW" = "CAMERA";
  private replacement: number | null = null;
  private captureToken?: symbol;
  private saving?: Promise<ReceiptPhotoSelection>;
  private saved?: ReceiptPhotoSelection;
  private closed = false;
  private sequence = 0;
  constructor(
    private readonly authority: { canCapture(): boolean; signal: AbortSignal },
    private readonly persist: (
      selection: CopilotReceiptCameraSelection,
    ) => Promise<ReceiptPhotoSelection>,
  ) {}
  snapshot() {
    return {
      stage: this.stage,
      views: this.views.map((view) => ({ ...view })),
      busy: Boolean(this.captureToken || this.saving),
      capturing: Boolean(this.captureToken),
      saving: Boolean(this.saving),
      saved: Boolean(this.saved),
    };
  }
  private check() {
    if (this.closed || this.authority.signal.aborted)
      throw Error("COPILOT_ATTACHMENT_CANCELLED");
    if (!this.authority.canCapture())
      throw Error("COPILOT_RECEIPT_CAPTURE_FORBIDDEN");
  }
  private editable() {
    this.check();
    if (this.captureToken || this.saving || this.saved)
      throw Error("COPILOT_RECEIPT_CAMERA_BUSY");
  }
  async take(shot: () => Promise<ReceiptCameraPicture>) {
    this.editable();
    if (
      this.stage !== "CAMERA" ||
      (this.views.length >= MAX_RECEIPT_VIEWS && this.replacement === null)
    )
      throw Error("COPILOT_RECEIPT_VIEW_COUNT_INVALID");
    const token = Symbol("camera capture");
    this.captureToken = token;
    try {
      let picture: ReceiptCameraPicture;
      try {
        picture = await shot();
      } catch {
        throw Error("COPILOT_RECEIPT_CAMERA_CAPTURE_FAILED");
      }
      this.check();
      if (this.captureToken !== token)
        throw Error("COPILOT_RECEIPT_CAMERA_INTERRUPTED");
      const parsed = pictureSchema.safeParse(picture);
      if (!parsed.success) throw Error("COPILOT_RECEIPT_CAMERA_CAPTURE_FAILED");
      if (
        this.views.some(
          (view, index) =>
            index !== this.replacement && view.uri === parsed.data.uri,
        )
      )
        throw Error("COPILOT_RECEIPT_CAMERA_CAPTURE_FAILED");
      const asset: Asset = {
        uri: parsed.data.uri,
        filename: `Ticket de casse - vue ${++this.sequence}.${parsed.data.format}`,
        mimeType: parsed.data.format === "png" ? "image/png" : "image/jpeg",
      };
      if (this.replacement === null) this.views.push(asset);
      else this.views[this.replacement] = asset;
      this.replacement = null;
      this.stage = "REVIEW";
    } finally {
      if (this.captureToken === token) this.captureToken = undefined;
    }
  }
  addView() {
    this.editable();
    if (this.views.length >= MAX_RECEIPT_VIEWS)
      throw Error("COPILOT_RECEIPT_VIEW_COUNT_INVALID");
    this.replacement = null;
    this.stage = "CAMERA";
  }
  retake(index: number) {
    this.editable();
    this.index(index);
    // The previous photo remains selected until a replacement actually succeeds.
    this.replacement = index;
    this.stage = "CAMERA";
  }
  review() {
    this.editable();
    if (!this.views.length) throw Error("COPILOT_RECEIPT_VIEW_COUNT_INVALID");
    this.replacement = null;
    this.stage = "REVIEW";
  }
  move(index: number, delta: -1 | 1) {
    this.editable();
    if (this.stage !== "REVIEW") throw Error("COPILOT_RECEIPT_CAMERA_BUSY");
    this.index(index);
    const target = index + delta;
    this.index(target);
    [this.views[index], this.views[target]] = [
      this.views[target]!,
      this.views[index]!,
    ];
  }
  remove(index: number) {
    this.editable();
    if (this.stage !== "REVIEW") throw Error("COPILOT_RECEIPT_CAMERA_BUSY");
    this.index(index);
    this.views.splice(index, 1);
    if (!this.views.length) {
      this.stage = "CAMERA";
      this.replacement = null;
    }
  }
  private index(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= this.views.length)
      throw Error("COPILOT_RECEIPT_VIEW_COUNT_INVALID");
  }
  /** Backgrounding stops framing without dropping already reviewed views. No file is deleted. */
  interruptCapture() {
    this.captureToken = undefined;
  }
  close() {
    this.closed = true;
    this.interruptCapture();
  }
  save(): Promise<ReceiptPhotoSelection> {
    this.check();
    if (this.saved) return Promise.resolve(this.saved);
    if (this.saving) return this.saving;
    if (this.captureToken || this.stage !== "REVIEW" || !this.views.length)
      throw Error("COPILOT_RECEIPT_CAMERA_BUSY");
    const selection: CopilotReceiptCameraSelection = {
      mode: "ONE_RECEIPT_CAMERA",
      assets: this.views.map((view) => ({ ...view })),
    };
    this.saving = Promise.resolve()
      .then(() => {
        this.check();
        return this.persist(selection);
      })
      .then((result) => {
        if (result.imported !== 1 || result.failures.length)
          throw Error(
            result.failures[0]?.code ?? "COPILOT_RECEIPT_PHOTO_NOT_SAVED",
          );
        this.saved = result;
        return result;
      })
      .finally(() => {
        this.saving = undefined;
      });
    return this.saving;
  }
}
