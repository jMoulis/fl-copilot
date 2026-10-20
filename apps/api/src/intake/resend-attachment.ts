import { createHash } from "node:crypto";
import type { Resend } from "resend";
import { z } from "zod";
const targetSchema = z.strictObject({
  emailId: z.uuid(),
  attachmentId: z.uuid(),
  filename: z.string().max(1024).nullable(),
  mediaType: z.string().min(1).max(120),
  maximumBytes: z
    .number()
    .int()
    .positive()
    .max(100 * 1024 * 1024),
});
const metadataSchema = z.object({
  id: z.uuid(),
  filename: z.string().max(1024).nullish(),
  size: z.number().int().positive(),
  content_type: z.string().min(1).max(120),
  download_url: z.string().min(1).max(8192),
  expires_at: z.iso.datetime({ offset: true }),
});
const allowed = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "application/x-zip-compressed",
  "application/octet-stream",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
]);
export type EmailAttachmentTarget = z.infer<typeof targetSchema>;
class AttachmentReadError extends Error {}
const failure = (code: string) =>
  new AttachmentReadError(`EMAIL_ATTACHMENT_${code}`);

/** The URL comes only from the authenticated attachment SDK endpoint, never email prose. */
export function resendAttachmentUrl(
  raw: string,
  emailId: string,
  attachmentId: string,
) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw failure("CAPABILITY_INVALID");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "inbound-cdn.resend.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    url.pathname !== `/${emailId}/attachments/${attachmentId}` ||
    [...raw].some(
      (char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127,
    )
  )
    throw failure("CAPABILITY_INVALID");
  return url.href;
}
/** Retain exact bytes only; no extraction, publication, model call or automatic source typing. */
export function createResendAttachmentReader(
  attachments: Pick<Resend["emails"]["receiving"]["attachments"], "get">,
  fetcher: typeof fetch = fetch,
  now: () => number = () => Date.now(),
) {
  return {
    async read(
      raw: EmailAttachmentTarget,
      authorize: () => Promise<void>,
      external?: AbortSignal,
    ) {
      const target = targetSchema.parse(raw);
      if (!allowed.has(target.mediaType)) throw failure("UNSUPPORTED");
      const controller = new AbortController(),
        signal = external
          ? AbortSignal.any([external, controller.signal])
          : controller.signal;
      let timedOut = false;
      const abortError = () => failure(timedOut ? "TIMED_OUT" : "CANCELLED");
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 60000);
      timeout.unref();
      // The installed SDK has no per-attachment AbortSignal option. Stop awaiting late
      // metadata, consume its eventual resolution/rejection, and never start a late download.
      const wait = <T>(promise: Promise<T>) =>
        new Promise<T>((resolve, reject) => {
          const abort = () => {
            signal.removeEventListener("abort", abort);
            reject(abortError());
          };
          signal.addEventListener("abort", abort, { once: true });
          promise.then(
            (value) => {
              signal.removeEventListener("abort", abort);
              resolve(value);
            },
            (error) => {
              signal.removeEventListener("abort", abort);
              reject(error);
            },
          );
          if (signal.aborted) abort();
        });
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
        complete = false;
      try {
        if (signal.aborted) throw abortError();
        await wait(authorize());
        if (signal.aborted) throw abortError();
        const result = await wait(
          attachments.get({ emailId: target.emailId, id: target.attachmentId }),
        );
        if (result.error || !result.data) throw failure("PROVIDER_UNAVAILABLE");
        const parsed = metadataSchema.safeParse(result.data);
        if (!parsed.success) throw failure("METADATA_INVALID");
        const metadata = parsed.data;
        if (
          metadata.id !== target.attachmentId ||
          (metadata.filename ?? null) !== target.filename ||
          metadata.content_type !== target.mediaType
        )
          throw failure("IDENTITY_CHANGED");
        if (metadata.size > target.maximumBytes) throw failure("TOO_LARGE");
        const url = resendAttachmentUrl(
          metadata.download_url,
          target.emailId,
          target.attachmentId,
        );
        if (Date.parse(metadata.expires_at) <= now())
          throw failure("CAPABILITY_EXPIRED");
        await wait(authorize());
        if (signal.aborted) throw abortError();
        if (Date.parse(metadata.expires_at) <= now())
          throw failure("CAPABILITY_EXPIRED");
        const response = await wait(
          fetcher(url, {
            method: "GET",
            redirect: "error",
            credentials: "omit",
            signal,
          }),
        );
        if (!response.ok || !response.body) {
          await response.body?.cancel().catch(() => {});
          throw failure("DOWNLOAD_FAILED");
        }
        reader = response.body.getReader();
        const length = response.headers.get("content-length"),
          mime = response.headers
            .get("content-type")
            ?.split(";")[0]
            ?.trim()
            .toLowerCase();
        if (
          (length !== null &&
            (!/^[1-9][0-9]*$/.test(length) ||
              Number(length) !== metadata.size)) ||
          (mime !== target.mediaType && mime !== "application/octet-stream")
        )
          throw failure("METADATA_INVALID");
        const chunks: Uint8Array[] = [],
          hash = createHash("sha256");
        let size = 0;
        for (;;) {
          if (signal.aborted) throw abortError();
          const part = await wait(reader.read());
          if (part.done) {
            complete = true;
            break;
          }
          size += part.value.byteLength;
          if (size > metadata.size || size > target.maximumBytes)
            throw failure("TOO_LARGE");
          hash.update(part.value);
          chunks.push(part.value);
        }
        if (size !== metadata.size) throw failure("SIZE_INVALID");
        const bytes = new Uint8Array(Buffer.concat(chunks, size));
        await wait(authorize());
        if (signal.aborted) throw abortError();
        return {
          bytes,
          checksum: `sha256:${hash.digest("hex")}`,
          sizeBytes: size,
          declaredMimeType: target.mediaType,
          filename: target.filename,
        };
      } catch (error) {
        if (signal.aborted) throw abortError();
        if (error instanceof AttachmentReadError) throw error;
        if (
          error instanceof Error &&
          [
            "EMAIL_ATTACHMENT_SCOPE_CHANGED",
            "EMAIL_ATTACHMENT_SCOPE_UNAVAILABLE",
          ].includes(error.message)
        )
          throw failure(
            error.message === "EMAIL_ATTACHMENT_SCOPE_CHANGED"
              ? "SCOPE_CHANGED"
              : "SCOPE_UNAVAILABLE",
          );
        // Never propagate a fetch/SDK exception containing a signed URL or provider body.
        throw failure("READ_FAILED");
      } finally {
        clearTimeout(timeout);
        if (reader) {
          if (!complete) await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      }
    },
  };
}
