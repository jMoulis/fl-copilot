import { describe, expect, it, vi } from "vitest";
import {
  persistWasteReceiptCapture,
  persistWasteReceiptImport,
  resolveWasteReceiptImageExtension,
  UnsupportedWasteReceiptImageError,
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
      removeSourceAfterCopy: true,
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

  it.each([
    ["image/jpeg", "ticket.anything", "jpg"],
    ["image/png", "ticket.anything", "png"],
    ["image/heic", "ticket.anything", "heic"],
    ["image/heif", "ticket.anything", "heif"],
    [undefined, "ticket.JPEG", "jpg"],
  ])("preserves supported image formats", (mimeType, filename, expected) => {
    expect(
      resolveWasteReceiptImageExtension({
        temporaryUri: "file:///picker/image",
        mimeType,
        originalFilename: filename,
      }),
    ).toBe(expected);
  });

  it("rejects an unsupported selected file before copying it", () => {
    expect(() =>
      resolveWasteReceiptImageExtension({
        temporaryUri: "file:///picker/ticket.jpg",
        mimeType: "image/gif",
        originalFilename: "ticket.jpg",
      }),
    ).toThrow(UnsupportedWasteReceiptImageError);
  });

  it("copies an imported photo without deleting the picker source", async () => {
    const persist = vi.fn(async ({ filename }: { filename: string }) =>
      Promise.resolve(`file:///documents/waste-receipts/${filename}`),
    );
    const storage: WasteReceiptCaptureStorage = { persist };

    await expect(
      persistWasteReceiptImport(
        {
          temporaryUri: "file:///picker/ticket.heic",
          captureId: "11111111-1111-4111-8111-111111111111",
          mimeType: "image/heic",
          originalFilename: "ticket.heic",
        },
        storage,
      ),
    ).resolves.toEqual({
      localUri:
        "file:///documents/waste-receipts/11111111-1111-4111-8111-111111111111.heic",
      filename: "11111111-1111-4111-8111-111111111111.heic",
      extension: "heic",
    });
    expect(persist).toHaveBeenCalledWith({
      temporaryUri: "file:///picker/ticket.heic",
      filename: "11111111-1111-4111-8111-111111111111.heic",
      removeSourceAfterCopy: false,
    });
  });
});
