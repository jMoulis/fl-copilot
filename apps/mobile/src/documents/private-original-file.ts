import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { sourceOriginalDownloadSchema } from "@fl-copilot/sync-contracts";
import type { Directory, File } from "expo-file-system";

type ExpectedFile = { checksum: string; sizeBytes: number };
type Fault = "INVALID" | "EXPIRED" | "UNAVAILABLE";
/** Raw-byte proof shared by canonical sources and unclassified email attachments. */
export async function verifyPrivateOriginalFile(
  file: File,
  expected: ExpectedFile,
  invalid: () => Error,
  header?: (bytes: Uint8Array) => void,
) {
  if (
    !Number.isSafeInteger(expected.sizeBytes) ||
    expected.sizeBytes <= 0 ||
    expected.sizeBytes > 100 * 1024 * 1024 ||
    !file.exists ||
    file.size !== expected.sizeBytes
  )
    throw invalid();
  const { FileMode } = await import("expo-file-system");
  const handle = file.open(FileMode.ReadOnly),
    digest = sha256.create();
  let count = 0,
    chunks = 0;
  try {
    while (count < expected.sizeBytes) {
      const part = handle.readBytes(
        Math.min(1024 * 1024, expected.sizeBytes - count),
      );
      if (!part.length || part.length > expected.sizeBytes - count)
        throw invalid();
      if (!count) header?.(part.subarray(0, 1024));
      digest.update(part);
      count += part.length;
      if (++chunks % 4 === 0)
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    if (
      file.size !== expected.sizeBytes ||
      `sha256:${bytesToHex(digest.digest())}` !== expected.checksum
    )
      throw invalid();
  } finally {
    handle.close();
    digest.destroy();
  }
}

/** One bounded private download. The caller validates its manifest, account and final path.
 * Partial files are disposable; a confirmed original is never overwritten or removed. */
export async function receivePrivateOriginalFile<
  T extends { localUri: string },
>(input: {
  url: string;
  expiresAt: string;
  sizeBytes: number;
  mimeType: string;
  directory: Directory;
  final: File;
  check(): void;
  inspect(file: File): Promise<T>;
  fault(kind: Fault): Error;
  signal?: AbortSignal;
}): Promise<T> {
  const { check, final, signal, fault } = input;
  sourceOriginalDownloadSchema.shape.url.parse(input.url);
  check();
  if (
    !Number.isSafeInteger(input.sizeBytes) ||
    input.sizeBytes <= 0 ||
    input.sizeBytes > 100 * 1024 * 1024
  )
    throw fault("INVALID");
  if (
    !Number.isFinite(Date.parse(input.expiresAt)) ||
    Date.parse(input.expiresAt) <= Date.now()
  )
    throw fault("EXPIRED");
  if (signal?.aborted) throw fault("UNAVAILABLE");
  if (final.exists) {
    const result = await input.inspect(final);
    check();
    return result;
  }
  const { File } = await import("expo-file-system"),
    { randomUUID } = await import("expo-crypto");
  const temporary = new File(input.directory, `${randomUUID()}.partial`),
    abort = new AbortController();
  const interrupted = () => abort.abort();
  signal?.addEventListener("abort", interrupted, { once: true });
  if (signal?.aborted) abort.abort();
  const timeout = setTimeout(() => abort.abort(), 120_000);
  let moved = false,
    created = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
    writer: import("expo-file-system").FileHandle | undefined;
  try {
    const { fetch } = await import("expo/fetch");
    let response;
    try {
      response = await fetch(input.url, {
        redirect: "error",
        credentials: "omit",
        signal: abort.signal,
      });
    } catch {
      throw fault("UNAVAILABLE");
    }
    check();
    if (!response.ok)
      throw fault(
        response.status === 401 || response.status === 403
          ? "EXPIRED"
          : "UNAVAILABLE",
      );
    const size = response.headers.get("content-length"),
      mime = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
    if (
      (size !== null &&
        (!/^\d+$/.test(size) || Number(size) !== input.sizeBytes)) ||
      mime !== input.mimeType ||
      !response.body?.getReader
    )
      throw fault("INVALID");
    temporary.create();
    created = true;
    writer = temporary.open();
    reader = response.body.getReader();
    let count = 0;
    for (;;) {
      check();
      let part: ReadableStreamReadResult<Uint8Array>;
      try {
        part = await reader.read();
      } catch {
        throw fault("UNAVAILABLE");
      }
      check();
      if (abort.signal.aborted) throw fault("UNAVAILABLE");
      if (part.done) break;
      count += part.value.byteLength;
      if (count > input.sizeBytes) throw fault("INVALID");
      writer.writeBytes(part.value);
    }
    writer.close();
    writer = undefined;
    if (count !== input.sizeBytes) throw fault("INVALID");
    const verified = await input.inspect(temporary);
    check();
    if (abort.signal.aborted) throw fault("UNAVAILABLE");
    if (final.exists) {
      const result = await input.inspect(final);
      check();
      return result;
    }
    temporary.move(final);
    moved = true;
    return { ...verified, localUri: final.uri };
  } finally {
    signal?.removeEventListener("abort", interrupted);
    clearTimeout(timeout);
    abort.abort();
    try {
      writer?.close();
    } finally {
      await reader?.cancel().catch(() => undefined);
      if (created && !moved && temporary.exists) temporary.delete();
    }
  }
}
