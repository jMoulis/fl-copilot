let sequence = 0;
const randomUUID = () =>
  `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "./index";
afterEach(() => vi.unstubAllGlobals());
it("reads one typed receipt by authenticated identity without listing or downloading other emails", async () => {
  const storeId = randomUUID(),
    ownerId = randomUUID(),
    conversationId = randomUUID(),
    receiptId = randomUUID();
  const receipt = {
    id: receiptId,
    storeId,
    ownerId,
    conversationId,
    bindingId: randomUUID(),
    providerEmailId: randomUUID(),
    sender: "manager@example.test",
    subject: "Sources",
    receivedAt: "2026-10-20T12:00:00Z",
    updatedAt: "2026-10-20T12:00:00Z",
    version: 1,
    status: "AWAITING_CONFIRMATION",
    files: [],
  };
  const fetch = vi.fn(
    async () => new Response(JSON.stringify(receipt), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetch);
  const api = new ApiClient("https://api.test.invalid");
  expect(
    await api.emailIntakeReceipt("unit-token", storeId, {
      conversationId,
      receiptId,
    }),
  ).toEqual(receipt);
  expect(fetch).toHaveBeenCalledWith(
    `https://api.test.invalid/api/v1/intake/email/receipts/${receiptId}?conversationId=${conversationId}`,
    expect.objectContaining({
      method: "GET",
      headers: expect.objectContaining({
        authorization: "Bearer unit-token",
        "x-store-id": storeId,
      }),
    }),
  );
  expect(() =>
    api.emailIntakeReceipt("unit-token", storeId, {
      conversationId,
      receiptId: "../../other",
    }),
  ).toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("uses authenticated store headers, typed private DTOs and scoped intake URLs", async () => {
  const storeId = randomUUID(),
    ownerId = randomUUID(),
    conversationId = randomUUID(),
    id = randomUUID();
  const binding = {
    id,
    storeId,
    ownerId,
    conversationId,
    recipient: "fl-private@unit.resend.app",
    allowedSender: "manager@example.test",
    createdAt: "2026-10-20T12:00:00Z",
    revokedAt: null,
  };
  const fetch = vi.fn(
    async (url: string, init: RequestInit) =>
      new Response(
        JSON.stringify(
          url.endsWith("/status")
            ? { enabled: true }
            : init.method === "DELETE"
              ? { revoked: true }
              : init.method === "POST"
                ? binding
                : { bindings: [binding], receipts: [], nextCursor: null },
        ),
      ),
  );
  vi.stubGlobal("fetch", fetch);
  const api = new ApiClient("https://api.test.invalid");
  expect(await api.emailIntakeStatus("unit-token", storeId)).toEqual({
    enabled: true,
  });
  expect(
    await api.createEmailIntakeBinding("unit-token", storeId, {
      id,
      conversationId,
      allowedSender: "Manager@Example.test",
    }),
  ).toEqual(binding);
  expect(
    (
      await api.emailIntakeList(
        "unit-token",
        storeId,
        conversationId,
        "opaque+cursor/",
      )
    ).bindings,
  ).toEqual([binding]);
  expect(
    await api.revokeEmailIntakeBinding(
      "unit-token",
      storeId,
      conversationId,
      id,
    ),
  ).toEqual({ revoked: true });
  for (const call of fetch.mock.calls)
    expect(call[1].headers).toMatchObject({
      authorization: "Bearer unit-token",
      "x-store-id": storeId,
    });
  expect(fetch.mock.calls[1]![1]).toMatchObject({
    method: "POST",
    body: JSON.stringify({
      id,
      conversationId,
      allowedSender: "manager@example.test",
    }),
  });
  expect(fetch.mock.calls[2]![0]).toBe(
    `https://api.test.invalid/api/v1/intake/email/conversations/${conversationId}?cursor=opaque%2Bcursor%2F`,
  );
  expect(fetch.mock.calls[3]![0]).toBe(
    `https://api.test.invalid/api/v1/intake/email/bindings/${id}?conversationId=${conversationId}`,
  );
});
it("rejects invalid identity/authority locally before emitting an intake request", () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const api = new ApiClient("https://api.test.invalid"),
    id = randomUUID();
  expect(() => api.emailIntakeList("unit-token", id, "../foreign")).toThrow();
  expect(() =>
    api.revokeEmailIntakeBinding("unit-token", id, id, "../foreign"),
  ).toThrow();
  expect(() =>
    api.createEmailIntakeBinding("unit-token", id, {
      id,
      conversationId: id,
      allowedSender: "manager@example.test",
      ownerId: id,
    } as unknown as Parameters<typeof api.createEmailIntakeBinding>[2]),
  ).toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
it("uses scoped original endpoints and validates private capabilities before returning them", async () => {
  const storeId = randomUUID(),
    ownerId = randomUUID(),
    conversationId = randomUUID(),
    receiptId = randomUUID(),
    fileId = randomUUID();
  const target = { conversationId, receiptId, fileId };
  const manifest = {
    schemaVersion: 1,
    storeId,
    ownerId,
    ...target,
    providerEmailId: randomUUID(),
    providerAttachmentId: randomUUID(),
    filename: "sources.zip",
    declaredMimeType: "application/zip",
    sizeBytes: 3,
    checksum: `sha256:${"a".repeat(64)}`,
    retainedAt: "2026-10-20T12:00:00Z",
    manifestHash: `sha256:${"b".repeat(64)}`,
  };
  let unsafe = false;
  const fetch = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.includes("original-manifest")
            ? manifest
            : {
                manifest,
                url: unsafe
                  ? "https://foreign.test/private"
                  : "https://unit.private.blob.vercel-storage.com/private?signature=test-only",
                expiresAt: "2026-10-20T12:02:00Z",
              },
        ),
      ),
  );
  vi.stubGlobal("fetch", fetch);
  const api = new ApiClient("https://api.test.invalid");
  expect(
    await api.emailIntakeOriginalManifest("unit-token", storeId, target),
  ).toEqual(manifest);
  expect(
    (await api.emailIntakeOriginalDownload("unit-token", storeId, target))
      .manifest,
  ).toEqual(manifest);
  expect(fetch.mock.calls[0]![0]).toBe(
    `https://api.test.invalid/api/v1/intake/email/${receiptId}/files/${fileId}/original-manifest?conversationId=${conversationId}`,
  );
  unsafe = true;
  await expect(
    api.emailIntakeOriginalDownload("unit-token", storeId, target),
  ).rejects.toThrow();
  expect(() =>
    api.emailIntakeOriginalManifest("unit-token", storeId, {
      ...target,
      fileId: "../foreign",
    }),
  ).toThrow();
  expect(() =>
    api.emailIntakeOriginalDownload("unit-token", storeId, {
      ...target,
      ownerId,
    } as typeof target),
  ).toThrow();
  expect(fetch).toHaveBeenCalledTimes(3);
});

it("sends a stable original retry action with authenticated scope and rejects mismatched responses", async () => {
  const storeId = randomUUID(),
    ownerId = randomUUID(),
    conversationId = randomUUID(),
    receiptId = randomUUID(),
    fileId = randomUUID(),
    actionId = randomUUID();
  const input = { conversationId, receiptId, fileId, actionId };
  const receipt = {
    id: receiptId,
    storeId,
    ownerId,
    conversationId,
    bindingId: randomUUID(),
    providerEmailId: randomUUID(),
    sender: "manager@example.test",
    subject: "Sources",
    receivedAt: "2026-10-20T12:00:00Z",
    updatedAt: "2026-10-20T12:00:00Z",
    version: 2,
    status: "AWAITING_CONFIRMATION",
    files: [
      {
        id: fileId,
        providerAttachmentId: randomUUID(),
        filename: "source.xlsx",
        mediaType: "application/octet-stream",
        status: "PENDING",
        sourceDocumentId: null,
      },
    ],
  };
  let result: unknown = { actionId, receipt };
  const fetch = vi.fn(
    async () => new Response(JSON.stringify(result), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetch);
  const api = new ApiClient("https://api.test.invalid");
  expect(
    await api.retryEmailIntakeOriginal("unit-token", storeId, input),
  ).toEqual(result);
  expect(fetch).toHaveBeenCalledWith(
    "https://api.test.invalid/api/v1/intake/email/original-retries",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify(input),
      headers: expect.objectContaining({
        authorization: "Bearer unit-token",
        "x-store-id": storeId,
      }),
    }),
  );
  for (const mismatch of [
    { actionId: randomUUID(), receipt },
    { actionId, receipt: { ...receipt, id: randomUUID() } },
    { actionId, receipt: { ...receipt, storeId: randomUUID() } },
    { actionId, receipt: { ...receipt, conversationId: randomUUID() } },
    { actionId, receipt: { ...receipt, files: [] } },
  ]) {
    result = mismatch;
    await expect(
      api.retryEmailIntakeOriginal("unit-token", storeId, input),
    ).rejects.toThrow("EMAIL_ORIGINAL_RETRY_IDENTITY_INVALID");
  }
});
