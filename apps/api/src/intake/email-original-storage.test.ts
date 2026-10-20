import { expect, it, vi } from "vitest";
const blob = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock("@vercel/blob", () => blob);
import { createEmailOriginalBlobStorage } from "./email-originals.js";
it("reads through the private Blob SDK without persisting a signed capability", async () => {
  const bytes = new Uint8Array([1, 2, 3]),
    signal = new AbortController().signal;
  blob.get.mockResolvedValueOnce({
    statusCode: 200,
    stream: new ReadableStream({
      start(c) {
        c.enqueue(bytes);
        c.close();
      },
    }),
  });
  const result = await createEmailOriginalBlobStorage().read(
    "stores/unit/private-email/original",
    3,
    signal,
  );
  expect(result).toEqual(bytes);
  expect(blob.get).toHaveBeenLastCalledWith(
    "stores/unit/private-email/original",
    { access: "private", useCache: false, abortSignal: signal },
  );
});
it("bounds bytes and cancels an oversized private stream", async () => {
  const cancel = vi.fn();
  blob.get.mockResolvedValueOnce({
    statusCode: 200,
    stream: new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(4));
      },
      cancel,
    }),
  });
  await expect(
    createEmailOriginalBlobStorage().read(
      "private/key",
      3,
      new AbortController().signal,
    ),
  ).rejects.toThrow("EMAIL_ORIGINAL_PROOF_INVALID");
  expect(cancel).toHaveBeenCalledOnce();
});
it("writes immutable private bytes with the caller's cancellation signal", async () => {
  blob.put.mockResolvedValueOnce({});
  const bytes = new Uint8Array([1]),
    signal = new AbortController().signal;
  await createEmailOriginalBlobStorage().write(
    "private/key",
    bytes,
    "application/zip",
    signal,
  );
  expect(blob.put).toHaveBeenLastCalledWith("private/key", Buffer.from(bytes), {
    access: "private",
    contentType: "application/zip",
    addRandomSuffix: false,
    allowOverwrite: false,
    abortSignal: signal,
  });
});
it("does not fabricate bytes for a missing Blob", async () => {
  blob.get.mockResolvedValueOnce(null);
  expect(
    await createEmailOriginalBlobStorage().read(
      "private/key",
      3,
      new AbortController().signal,
    ),
  ).toBeNull();
});
