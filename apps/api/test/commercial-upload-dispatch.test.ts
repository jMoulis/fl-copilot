import { describe, expect, it, vi } from "vitest";
import { createCommercialUploadDispatch } from "../src/uploads/commercial-upload-dispatch.js";

describe("confirmed commercial upload dispatch", () => {
  it("registers a handled promise and acknowledges before a delayed provider finishes", async () => {
    let finish!: () => void;
    const provider = new Promise<void>((resolve) => (finish = resolve));
    const send = vi.fn(() => provider);
    const tasks: Promise<void>[] = [];
    const report = vi.fn();
    const dispatch = createCommercialUploadDispatch(
      send,
      (p) => tasks.push(p),
      report,
    );
    await dispatch("store", "source");
    expect(tasks).toHaveLength(1);
    expect(send).toHaveBeenCalledExactlyOnceWith("store", "source");
    finish();
    await tasks[0];
    expect(report).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "contains asynchronous and synchronous provider failures (sync=%s)",
    async (sync) => {
      const privateError = Error("provider /signed?secret=private");
      const send = vi.fn(() => {
        if (sync) throw privateError;
        return Promise.reject(privateError);
      });
      const report = vi.fn();
      const tasks: Promise<void>[] = [];
      await createCommercialUploadDispatch(
        send,
        (p) => tasks.push(p),
        report,
      )("store", "source");
      await expect(tasks[0]).resolves.toBeUndefined();
      expect(report.mock.calls).toEqual([
        [
          {
            code: "COMMERCIAL_UPLOAD_DISPATCH_FAILED",
            storeId: "store",
            sourceDocumentId: "source",
          },
        ],
      ]);
      expect(JSON.stringify(report.mock.calls)).not.toContain("private");
    },
  );

  it.each([false, true])(
    "drains the same task without a lifecycle or if registration fails (throws=%s)",
    async (throws) => {
      let finish!: () => void;
      const send = vi.fn(
        () => new Promise<void>((resolve) => (finish = resolve)),
      );
      const report = vi.fn();
      let acknowledged = false;
      const task = createCommercialUploadDispatch(
        send,
        throws
          ? () => {
              throw Error("lifecycle unavailable");
            }
          : undefined,
        report,
      )("store", "source").then(() => {
        acknowledged = true;
      });
      await Promise.resolve();
      expect(acknowledged).toBe(false);
      finish();
      await task;
      expect(send).toHaveBeenCalledTimes(1);
      expect(acknowledged).toBe(true);
      expect(report).toHaveBeenCalledTimes(throws ? 1 : 0);
    },
  );

  it("contains logging failures in the portable runtime", async () => {
    await expect(
      createCommercialUploadDispatch(
        async () => {
          throw Error("provider");
        },
        undefined,
        () => {
          throw Error("logger");
        },
      )("store", "source"),
    ).resolves.toBeUndefined();
  });
});
