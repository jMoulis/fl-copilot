import { describe, expect, it, vi } from "vitest";
import {
  persistWasteReceiptCapture,
  type WasteReceiptCaptureStorage,
} from "./waste-receipt-capture";

describe("waste receipt capture", () => {
  it("persists the temporary camera image under a stable capture name", async () => {
    const persist = vi.fn(async ({ filename }: { filename: string }) =>
      Promise.resolve(`file:///documents/waste-receipts/${filename}`),
    );
    const storage: WasteReceiptCaptureStorage = { persist };

    await expect(
      persistWasteReceiptCapture(
        {
          temporaryUri: "file:///cache/camera.jpg",
          captureId: "11111111-1111-4111-8111-111111111111",
        },
        storage,
      ),
    ).resolves.toEqual({
      localUri:
        "file:///documents/waste-receipts/11111111-1111-4111-8111-111111111111.jpg",
      filename: "11111111-1111-4111-8111-111111111111.jpg",
    });
    expect(persist).toHaveBeenCalledWith({
      temporaryUri: "file:///cache/camera.jpg",
      filename: "11111111-1111-4111-8111-111111111111.jpg",
    });
  });

  it("does not report a durable capture when persistence fails", async () => {
    const storage: WasteReceiptCaptureStorage = {
      persist: async () => {
        throw new Error("WASTE_CAPTURE_COPY_FAILED");
      },
    };

    await expect(
      persistWasteReceiptCapture(
        {
          temporaryUri: "file:///cache/camera.jpg",
          captureId: "11111111-1111-4111-8111-111111111111",
        },
        storage,
      ),
    ).rejects.toThrow("WASTE_CAPTURE_COPY_FAILED");
  });
});
