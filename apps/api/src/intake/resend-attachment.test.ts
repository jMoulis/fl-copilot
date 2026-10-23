import { createHash, randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import {
  createResendAttachmentReader,
  resendAttachmentUrl,
} from "./resend-attachment.js";
afterEach(() => vi.useRealTimers());
function fixture(format: "legacy" | "receiving" = "legacy") {
  const emailId = randomUUID(),
    attachmentId = randomUUID(),
    bytes = new TextEncoder().encode("%PDF-1.7\noriginal bytes"),
    now = Date.parse("2026-10-20T12:00:00Z");
  const target = {
    emailId,
    attachmentId,
    filename: "semaine.pdf",
    mediaType: "application/pdf",
    maximumBytes: 1000,
  };
  const metadata = {
    id: attachmentId,
    filename: target.filename,
    size: bytes.length,
    content_type: target.mediaType,
    download_url:
      format === "receiving"
        ? `https://cdn.resend.app/receiving/${emailId}/attachments/${attachmentId}?signature=test-only`
        : `https://inbound-cdn.resend.com/${emailId}/attachments/${attachmentId}?signature=test-only`,
    expires_at: "2026-10-20T12:02:00Z",
  };
  const sdk = {
    get: vi
      .fn()
      .mockImplementation(async () => ({ data: metadata, error: null })),
  };
  const fetcher = vi.fn<typeof fetch>().mockImplementation(
    async () =>
      new Response(bytes, {
        headers: {
          "content-type": target.mediaType,
          "content-length": String(metadata.size),
        },
      }),
  );
  const authorize = vi.fn(async () => {}),
    reader = createResendAttachmentReader(sdk, fetcher, () => now);
  return {
    emailId,
    attachmentId,
    target,
    metadata,
    bytes,
    sdk,
    fetcher,
    authorize,
    reader,
  };
}
it.each(["legacy", "receiving"] as const)(
  "retrieves the exact %s attachment and returns immutable byte proof without a URL or body parsing",
  async (format) => {
    const f = fixture(format);
    const result = await f.reader.read(f.target, f.authorize);
    expect(result).toEqual({
      bytes: f.bytes,
      sizeBytes: f.bytes.length,
      checksum: `sha256:${createHash("sha256").update(f.bytes).digest("hex")}`,
      declaredMimeType: f.target.mediaType,
      filename: f.target.filename,
    });
    expect(JSON.stringify(result)).not.toContain("signature");
    expect(f.sdk.get).toHaveBeenCalledExactlyOnceWith({
      emailId: f.emailId,
      id: f.attachmentId,
    });
    expect(f.fetcher).toHaveBeenCalledExactlyOnceWith(
      f.metadata.download_url,
      expect.objectContaining({
        method: "GET",
        redirect: "error",
        credentials: "omit",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(f.fetcher.mock.calls[0]![1]?.headers).toBeUndefined();
    expect(f.authorize).toHaveBeenCalledTimes(3);
  },
);
it.each(
  (["legacy", "receiving"] as const).flatMap((format) =>
    [
      "foreign-host",
      "http",
      "port",
      "credentials",
      "fragment",
      "foreign-email",
      "foreign-attachment",
      "host-suffix",
      "swapped-path-format",
    ].map((mode) => ({ format, mode })),
  ),
)("rejects $format $mode capability before HTTP", async ({ format, mode }) => {
  const f = fixture(format),
    url = new URL(f.metadata.download_url);
  if (mode === "foreign-host") url.hostname = "127.0.0.1";
  if (mode === "http") url.protocol = "http:";
  if (mode === "port") url.port = "8443";
  if (mode === "credentials") url.username = "not-allowed";
  if (mode === "fragment") url.hash = "not-allowed";
  if (mode === "foreign-email")
    url.pathname = url.pathname.replace(f.emailId, randomUUID());
  if (mode === "foreign-attachment")
    url.pathname = url.pathname.replace(f.attachmentId, randomUUID());
  if (mode === "host-suffix") url.hostname = `${url.hostname}.attacker.example`;
  if (mode === "swapped-path-format")
    url.pathname =
      format === "receiving"
        ? `/${f.emailId}/attachments/${f.attachmentId}`
        : `/receiving/${f.emailId}/attachments/${f.attachmentId}`;
  f.metadata.download_url = url.href;
  await expect(f.reader.read(f.target, f.authorize)).rejects.toThrow(
    "EMAIL_ATTACHMENT_CAPABILITY_INVALID",
  );
  expect(f.fetcher).not.toHaveBeenCalled();
});

it.each([
  ["restricted_api_key", 401, "KEY_RESTRICTED"],
  ["missing_api_key", 401, "KEY_INVALID"],
  ["invalid_api_key", 401, "KEY_INVALID"],
  ["invalid_access", 403, "ACCESS_DENIED"],
  ["security_error", 403, "ACCESS_DENIED"],
  ["not_found", 404, "NOT_FOUND"],
  ["rate_limit_exceeded", 429, "RATE_LIMITED"],
  ["monthly_quota_exceeded", 429, "QUOTA_EXCEEDED"],
  ["daily_quota_exceeded", 429, "QUOTA_EXCEEDED"],
  ["internal_server_error", 503, "PROVIDER_ERROR"],
  ["__proto__", 999, "PROVIDER_ERROR"],
] as const)(
  "reports only a closed reason for %s, preserving the existing private retry contract",
  async (name, statusCode, reason) => {
    const f = fixture("receiving"),
      report = vi.fn();
    f.sdk.get.mockResolvedValue({
      data: null,
      error: {
        name,
        statusCode,
        message: `${f.metadata.download_url} re_private-test-key`,
        headers: { authorization: "private" },
      },
    });
    const reader = createResendAttachmentReader(
      f.sdk,
      f.fetcher,
      undefined,
      report,
    );
    const error = await reader
      .read(f.target, f.authorize)
      .catch((e: unknown) => e);
    expect(String(error)).toBe("Error: EMAIL_ATTACHMENT_PROVIDER_UNAVAILABLE");
    expect(report).toHaveBeenCalledExactlyOnceWith({
      reason,
      httpStatus: statusCode === 999 ? null : statusCode,
    });
    expect(JSON.stringify(report.mock.calls)).not.toMatch(
      /signature|re_private|authorization|semaine.pdf/,
    );
    expect(f.fetcher).not.toHaveBeenCalled();
  },
);

it("reports an empty SDK response and does not replace the failure when diagnostics themselves fail", async () => {
  const f = fixture(),
    report = vi.fn(() => {
      throw Error("private logger details");
    });
  f.sdk.get.mockResolvedValue({ data: null, error: null });
  const reader = createResendAttachmentReader(
    f.sdk,
    f.fetcher,
    undefined,
    report,
  );
  await expect(reader.read(f.target, f.authorize)).rejects.toThrow(
    "EMAIL_ATTACHMENT_PROVIDER_UNAVAILABLE",
  );
  expect(report).toHaveBeenCalledExactlyOnceWith({
    reason: "EMPTY_RESPONSE",
    httpStatus: null,
  });
  expect(f.fetcher).not.toHaveBeenCalled();
});
it.each(["id", "filename", "mime", "expired", "oversize", "provider-error"])(
  "rejects %s metadata without exposing capability/body data",
  async (mode) => {
    const f = fixture();
    if (mode === "id") f.metadata.id = randomUUID();
    if (mode === "filename") f.metadata.filename = "changed.pdf";
    if (mode === "mime") f.metadata.content_type = "text/html";
    if (mode === "expired") f.metadata.expires_at = "2026-10-20T11:00:00Z";
    if (mode === "oversize") f.metadata.size = 1001;
    if (mode === "provider-error")
      f.sdk.get.mockResolvedValue({
        data: null,
        error: { name: "restricted_api_key", message: f.metadata.download_url },
      });
    const error = await f.reader
      .read(f.target, f.authorize)
      .catch((e) => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(/EMAIL_ATTACHMENT_/);
    expect(String(error)).not.toContain("signature");
    expect(f.fetcher).not.toHaveBeenCalled();
  },
);
it.each(["http", "length", "mime", "too-long", "short", "transport-error"])(
  "rejects %s response while keeping provider capabilities out of errors",
  async (mode) => {
    const f = fixture();
    if (mode === "transport-error")
      f.fetcher.mockRejectedValue(Error(f.metadata.download_url));
    else
      f.fetcher.mockImplementation(
        async () =>
          new Response(
            mode === "too-long"
              ? new Uint8Array(f.bytes.length + 1)
              : mode === "short"
                ? f.bytes.slice(1)
                : f.bytes,
            {
              status: mode === "http" ? 403 : 200,
              headers: {
                "content-type":
                  mode === "mime" ? "text/html" : f.target.mediaType,
                ...(mode === "length" ? { "content-length": "999" } : {}),
              },
            },
          ),
      );
    const error = await f.reader
      .read(f.target, f.authorize)
      .catch((e) => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(/EMAIL_ATTACHMENT_/);
    expect(String(error)).not.toContain("signature");
  },
);
it.each([1, 2, 3])(
  "rechecks authorization at boundary %s and exposes no original after withdrawal",
  async (boundary) => {
    const f = fixture();
    let checks = 0;
    f.authorize.mockImplementation(async () => {
      if (++checks === boundary) throw Error("EMAIL_ATTACHMENT_SCOPE_CHANGED");
    });
    await expect(f.reader.read(f.target, f.authorize)).rejects.toThrow(
      "EMAIL_ATTACHMENT_SCOPE_CHANGED",
    );
    if (boundary < 3) expect(f.fetcher).not.toHaveBeenCalled();
    if (boundary === 1) expect(f.sdk.get).not.toHaveBeenCalled();
  },
);
it("stops awaiting revoked metadata and never starts a late download", async () => {
  const f = fixture(),
    controller = new AbortController();
  let started!: () => void, resolve!: (value: unknown) => void;
  const reached = new Promise<void>((r) => {
    started = r;
  });
  f.sdk.get.mockImplementation(() => {
    started();
    return new Promise((r) => {
      resolve = r;
    });
  });
  const pending = f.reader.read(f.target, f.authorize, controller.signal),
    assertion = expect(pending).rejects.toThrow("EMAIL_ATTACHMENT_CANCELLED");
  await reached;
  controller.abort();
  await assertion;
  resolve({ data: f.metadata, error: null });
  await Promise.resolve();
  await Promise.resolve();
  expect(f.fetcher).not.toHaveBeenCalled();
});
it("cancels a blocked body read and releases its stream without returning partial bytes", async () => {
  const f = fixture(),
    controller = new AbortController();
  let reached!: () => void,
    pulls = 0;
  const reading = new Promise<void>((r) => {
      reached = r;
    }),
    cancel = vi.fn();
  f.fetcher.mockImplementation(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(c) {
            if (++pulls === 1) c.enqueue(f.bytes.slice(0, 2));
            else reached();
          },
          cancel,
        }),
        { headers: { "content-type": f.target.mediaType } },
      ),
  );
  const pending = f.reader.read(f.target, f.authorize, controller.signal),
    assertion = expect(pending).rejects.toThrow("EMAIL_ATTACHMENT_CANCELLED");
  await reading;
  controller.abort();
  await assertion;
  expect(cancel).toHaveBeenCalledOnce();
  expect(f.fetcher.mock.calls[0]![1]?.signal?.aborted).toBe(true);
});
it("enforces the metadata deadline and does not pass provider errors through", async () => {
  vi.useFakeTimers();
  const f = fixture();
  let started!: () => void;
  const reached = new Promise<void>((r) => {
    started = r;
  });
  f.sdk.get.mockImplementation(() => {
    started();
    return new Promise(() => {});
  });
  const assertion = expect(
    f.reader.read(f.target, f.authorize),
  ).rejects.toThrow("EMAIL_ATTACHMENT_TIMED_OUT");
  await reached;
  await vi.advanceTimersByTimeAsync(60000);
  await assertion;
  expect(f.fetcher).not.toHaveBeenCalled();
});
it("refuses unsupported types and invalid target identity before contacting the provider", async () => {
  const f = fixture();
  await expect(
    f.reader.read({ ...f.target, mediaType: "text/html" }, f.authorize),
  ).rejects.toThrow("EMAIL_ATTACHMENT_UNSUPPORTED");
  await expect(
    f.reader.read({ ...f.target, emailId: "../foreign" }, f.authorize),
  ).rejects.toThrow();
  expect(f.sdk.get).not.toHaveBeenCalled();
  expect(() =>
    resendAttachmentUrl("not-a-url", f.emailId, f.attachmentId),
  ).toThrow("EMAIL_ATTACHMENT_CAPABILITY_INVALID");
});
it("retains transport bytes without claiming that their declared MIME proves a usable business document", async () => {
  const f = fixture(),
    bytes = new TextEncoder().encode(
      "a malformed declared PDF still needs canonical validation",
    );
  f.metadata.size = bytes.length;
  f.fetcher.mockResolvedValue(
    new Response(bytes, {
      headers: { "content-type": "application/octet-stream" },
    }),
  );
  expect((await f.reader.read(f.target, f.authorize)).bytes).toEqual(bytes);
});

it.each(["\n", "\0", "\x7f"])(
  "rejects raw control characters even when URL normalization would hide them",
  (control) => {
    const f = fixture();
    expect(() =>
      resendAttachmentUrl(
        f.metadata.download_url + control,
        f.emailId,
        f.attachmentId,
      ),
    ).toThrow("EMAIL_ATTACHMENT_CAPABILITY_INVALID");
  },
);

it("does not accept a provider error message impersonating an internal code", async () => {
  const f = fixture();
  f.sdk.get.mockRejectedValue(
    Error("EMAIL_ATTACHMENT_PRIVATE_PROVIDER_DETAIL"),
  );
  await expect(f.reader.read(f.target, f.authorize)).rejects.toThrow(
    "EMAIL_ATTACHMENT_READ_FAILED",
  );
});

it("reserves the authenticated metadata size before fetching bytes, and never fetches on a daily limit", async () => {
  const f = fixture();
  let reserved = false;
  f.fetcher.mockImplementation(async () => {
    expect(reserved).toBe(true);
    return new Response(f.bytes, {
      headers: {
        "content-type": f.target.mediaType,
        "content-length": String(f.bytes.length),
      },
    });
  });
  const budget = vi.fn(async (size: number) => {
    expect(size).toBe(f.bytes.length);
    reserved = true;
  });
  await f.reader.read(f.target, f.authorize, undefined, budget);
  expect(budget).toHaveBeenCalledOnce();
  f.fetcher.mockClear();
  await expect(
    f.reader.read(f.target, f.authorize, undefined, async () => {
      throw Error("EMAIL_INTAKE_DAILY_LIMIT");
    }),
  ).rejects.toThrow("EMAIL_INTAKE_DAILY_LIMIT");
  expect(f.fetcher).not.toHaveBeenCalled();
});
it("rechecks scope after reserving before it can start a download", async () => {
  const f = fixture();
  await expect(
    f.reader.read(f.target, f.authorize, undefined, async () => {
      f.authorize.mockRejectedValueOnce(
        Error("EMAIL_ATTACHMENT_SCOPE_CHANGED"),
      );
    }),
  ).rejects.toThrow("EMAIL_ATTACHMENT_SCOPE_CHANGED");
  expect(f.fetcher).not.toHaveBeenCalled();
});
