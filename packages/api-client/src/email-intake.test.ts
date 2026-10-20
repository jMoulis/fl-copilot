let sequence = 0;
const randomUUID = () =>
  `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "./index";
afterEach(() => vi.unstubAllGlobals());
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
