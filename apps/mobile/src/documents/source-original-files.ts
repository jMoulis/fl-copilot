import { z } from "zod";
import {
  detectVisualImageMime,
  RECEIPT_PHOTO_BUNDLE_MIME,
  receiptPhotoBundleSchema,
} from "@fl-copilot/domain";
import {
  sourceOriginalDownloadSchema,
  sourceOriginalManifestSchema,
  type SourceOriginalManifest,
} from "@fl-copilot/sync-contracts";
import type {
  SourceOriginalFiles,
  SourceOriginalProof,
} from "./source-original-transfer";
import { assertPdfHeader } from "./commercial-pdf-capture";
const invalid = () => Error("SOURCE_ORIGINAL_FILE_INVALID");
async function hash(bytes: Uint8Array) {
  const { digest, CryptoDigestAlgorithm } = await import("expo-crypto");
  const result = await digest(
    CryptoDigestAlgorithm.SHA256,
    new Uint8Array(bytes),
  );
  return `sha256:${Array.from(new Uint8Array(result), (x) => x.toString(16).padStart(2, "0")).join("")}`;
}
function extension(mime: string) {
  return (
    (
      {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/heic": "heic",
        "image/heif": "heif",
        "application/pdf": "pdf",
        [RECEIPT_PHOTO_BUNDLE_MIME]: "json",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
          "xlsx",
      } as Record<string, string>
    )[mime] ??
    (() => {
      throw invalid();
    })()
  );
}
async function directory(manifest: SourceOriginalManifest, actorId: string) {
  sourceOriginalManifestSchema.parse(manifest);
  z.uuid().parse(actorId);
  if (manifest.access === "OWNER" && manifest.ownerId !== actorId)
    throw invalid();
  const { Directory, Paths } = await import("expo-file-system");
  return new Directory(
    Paths.document,
    "source-originals",
    manifest.storeId,
    actorId,
    manifest.sourceDocumentId,
  );
}
async function verify(
  bytes: Uint8Array,
  expected: { checksum: string; sizeBytes: number; mimeType: string },
) {
  if (
    bytes.length !== expected.sizeBytes ||
    expected.sizeBytes <= 0 ||
    bytes.length > 100 * 1024 * 1024 ||
    (await hash(bytes)) !== expected.checksum
  )
    throw invalid();
  if (expected.mimeType.startsWith("image/")) {
    if (detectVisualImageMime(bytes) !== expected.mimeType) throw invalid();
  } else if (expected.mimeType === "application/pdf") assertPdfHeader(bytes);
  else if (
    expected.mimeType !== RECEIPT_PHOTO_BUNDLE_MIME &&
    !(bytes[0] === 80 && bytes[1] === 75 && bytes[2] === 3 && bytes[3] === 4)
  )
    throw invalid();
}
async function inspect(
  file: import("expo-file-system").File,
  manifest: SourceOriginalManifest,
  actorId: string,
): Promise<SourceOriginalProof> {
  if (!file.exists || file.size !== manifest.sizeBytes) throw invalid();
  const bytes = await file.bytes();
  await verify(bytes, manifest);
  if (manifest.mimeType !== RECEIPT_PHOTO_BUNDLE_MIME)
    return { localUri: file.uri, views: null };
  const bundle = receiptPhotoBundleSchema.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  );
  const { File } = await import("expo-file-system"),
    dir = await directory(manifest, actorId);
  dir.create({ intermediates: true, idempotent: true });
  const views: NonNullable<SourceOriginalProof["views"]> = [];
  for (const view of bundle.views) {
    const decoded = atob(view.dataBase64);
    if (btoa(decoded) !== view.dataBase64) throw invalid();
    const data = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
    await verify(data, view);
    const child = new File(
      dir,
      `view-${view.checksum.slice(7)}.${extension(view.mimeType)}`,
    );
    // Immutable paths: an existing file is verified, never overwritten.
    if (!child.exists) child.write(data);
    if (child.size !== view.sizeBytes) throw invalid();
    await verify(await child.bytes(), view);
    views.push({
      localUri: child.uri,
      mimeType: view.mimeType,
      checksum: view.checksum,
      sizeBytes: view.sizeBytes,
    });
  }
  return { localUri: file.uri, views };
}
/** Stream into a disposable private file; final originals are never overwritten or removed. */
export const nativeSourceOriginalFiles: SourceOriginalFiles = {
  async hash(text) {
    const { digestStringAsync, CryptoDigestAlgorithm } =
      await import("expo-crypto");
    return `sha256:${await digestStringAsync(CryptoDigestAlgorithm.SHA256, text)}`;
  },
  async existing(manifest, uri, actorId) {
    sourceOriginalManifestSchema.parse(manifest);
    if (!uri.startsWith("file://") || uri.includes("\0")) throw invalid();
    const { File } = await import("expo-file-system");
    let file = new File(uri);
    if (!file.exists) {
      // Only this exact source/account/hash path may follow iOS container relocation.
      const dir = await directory(manifest, actorId),
        name = `original-${manifest.checksum.slice(7)}.${extension(manifest.mimeType)}`;
      file = new File(dir, name);
    }
    if (!file.exists) return null;
    return inspect(file, manifest, actorId);
  },
  async receive(raw, actorId, check) {
    const lease = sourceOriginalDownloadSchema.parse(raw),
      manifest = lease.manifest;
    check();
    if (Date.parse(lease.expiresAt) <= Date.now())
      throw Error("SOURCE_ORIGINAL_LEASE_EXPIRED");
    const { File } = await import("expo-file-system"),
      { randomUUID } = await import("expo-crypto");
    const dir = await directory(manifest, actorId);
    dir.create({ intermediates: true, idempotent: true });
    const final = new File(
      dir,
      `original-${manifest.checksum.slice(7)}.${extension(manifest.mimeType)}`,
    );
    if (final.exists) return inspect(final, manifest, actorId);
    const temporary = new File(dir, `${randomUUID()}.partial`),
      abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 120_000);
    let moved = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let writer: import("expo-file-system").FileHandle | undefined;
    try {
      const { fetch } = await import("expo/fetch");
      const response = await fetch(lease.url, {
        redirect: "error",
        credentials: "omit",
        signal: abort.signal,
      });
      check();
      if (!response.ok)
        throw Error(
          response.status === 401 || response.status === 403
            ? "SOURCE_ORIGINAL_LEASE_EXPIRED"
            : "SOURCE_ORIGINAL_DOWNLOAD_UNAVAILABLE",
        );
      const size = response.headers.get("content-length"),
        mime = response.headers
          .get("content-type")
          ?.split(";", 1)[0]
          ?.trim()
          .toLowerCase();
      if (
        (size !== null &&
          (!/^\d+$/.test(size) || Number(size) !== manifest.sizeBytes)) ||
        mime !== manifest.mimeType ||
        !response.body?.getReader
      )
        throw invalid();
      temporary.create();
      writer = temporary.open();
      reader = response.body.getReader();
      let count = 0;
      for (;;) {
        check();
        const part = await reader.read();
        if (part.done) break;
        count += part.value.byteLength;
        if (count > manifest.sizeBytes) throw invalid();
        writer.writeBytes(part.value);
      }
      writer.close();
      writer = undefined;
      if (count !== manifest.sizeBytes) throw invalid();
      await inspect(temporary, manifest, actorId);
      check();
      if (final.exists) return inspect(final, manifest, actorId);
      temporary.move(final);
      moved = true;
      return inspect(final, manifest, actorId);
    } finally {
      clearTimeout(timeout);
      abort.abort();
      writer?.close();
      await reader?.cancel().catch(() => undefined);
      if (!moved && temporary.exists) temporary.delete();
    }
  },
};
