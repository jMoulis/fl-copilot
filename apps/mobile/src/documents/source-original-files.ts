import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { sourceOriginalHash } from "./source-original-hash";
import { sourceFileDirectory } from "./source-file-directory";
import { z } from "zod";
import {
  detectVisualImageMime,
  MAX_STORE_PHOTO_PIXELS,
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
type ExpectedOriginal = {
  checksum: string;
  sizeBytes: number;
  mimeType: string;
};
function verifyType(header: Uint8Array, mimeType: string) {
  if (mimeType.startsWith("image/")) {
    if (detectVisualImageMime(header) !== mimeType) throw invalid();
  } else if (mimeType === "application/pdf") {
    try {
      assertPdfHeader(header);
    } catch {
      throw invalid();
    }
  } else if (
    mimeType !== RECEIPT_PHOTO_BUNDLE_MIME &&
    !(
      header[0] === 80 &&
      header[1] === 75 &&
      header[2] === 3 &&
      header[3] === 4
    )
  )
    throw invalid();
}
async function verifyFile(
  file: import("expo-file-system").File,
  expected: ExpectedOriginal,
) {
  if (
    !file.exists ||
    file.size !== expected.sizeBytes ||
    expected.sizeBytes <= 0 ||
    expected.sizeBytes > 100 * 1024 * 1024
  )
    throw invalid();
  const { FileMode } = await import("expo-file-system"),
    handle = file.open(FileMode.ReadOnly),
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
      if (!count) verifyType(part.subarray(0, 1024), expected.mimeType);
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
async function inspect(
  file: import("expo-file-system").File,
  manifest: SourceOriginalManifest,
  actorId: string,
): Promise<SourceOriginalProof> {
  await verifyFile(file, manifest);
  if (manifest.sourceType === "STORE_PHOTO") {
    const { readNativeImageSize } = await import("../media/image-size");
    let dimensions;
    try {
      dimensions = await readNativeImageSize(file.uri);
    } catch {
      throw invalid();
    }
    if (
      !Number.isSafeInteger(dimensions.width) ||
      !Number.isSafeInteger(dimensions.height) ||
      dimensions.width <= 0 ||
      dimensions.height <= 0 ||
      dimensions.width * dimensions.height > MAX_STORE_PHOTO_PIXELS
    )
      throw invalid();
  }
  if (manifest.mimeType !== RECEIPT_PHOTO_BUNDLE_MIME)
    return { localUri: file.uri, views: null };
  const text = await file.text();
  if (text.includes("\uFFFD")) throw invalid();
  let bundle;
  try {
    bundle = receiptPhotoBundleSchema.parse(JSON.parse(text));
  } catch {
    throw invalid();
  }
  const { File } = await import("expo-file-system"),
    dir = await directory(manifest, actorId);
  dir.create({ intermediates: true, idempotent: true });
  const views: NonNullable<SourceOriginalProof["views"]> = [];
  for (const view of bundle.views) {
    const decoded = atob(view.dataBase64);
    if (btoa(decoded) !== view.dataBase64) throw invalid();
    const data = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
    if (
      data.length !== view.sizeBytes ||
      sourceOriginalHash(data) !== view.checksum
    )
      throw invalid();
    verifyType(data.subarray(0, 1024), view.mimeType);
    const child = new File(
      dir,
      `view-${view.checksum.slice(7)}.${extension(view.mimeType)}`,
    );
    // Immutable paths: an existing file is verified, never overwritten.
    if (!child.exists) child.write(data);
    if (child.size !== view.sizeBytes) throw invalid();
    await verifyFile(child, view);
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
    return sourceOriginalHash(text);
  },
  async existing(manifest, uri, actorId) {
    sourceOriginalManifestSchema.parse(manifest);
    if (manifest.access === "OWNER" && manifest.ownerId !== actorId)
      throw invalid();
    if (!uri.startsWith("file://") || uri.includes("\0")) throw invalid();
    const { File } = await import("expo-file-system");
    let file = new File(uri);
    if (!file.exists && !uri.includes("/source-originals/")) {
      const { Paths } = await import("expo-file-system");
      const ordinary =
        manifest.sourceType === "WEEKLY_COMMERCIAL_PDF"
          ? "commercial-pdfs"
          : manifest.sourceType === "STORE_PHOTO"
            ? "store-photos"
            : manifest.sourceType === "WASTE_RECEIPT"
              ? "waste-receipts"
              : "mercalys-imports";
      const name = uri.split("/").at(-1);
      if (name)
        file = new File(
          Paths.document,
          sourceFileDirectory(uri, ordinary),
          name,
        );
    }
    if (!file.exists) {
      // Only this exact source/account/hash path may follow iOS container relocation.
      const dir = await directory(manifest, actorId),
        name = `original-${manifest.checksum.slice(7)}.${extension(manifest.mimeType)}`;
      file = new File(dir, name);
    }
    if (!file.exists) return null;
    return inspect(file, manifest, actorId);
  },
  async receive(raw, actorId, check, signal) {
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
    const interrupted = () => abort.abort();
    signal?.addEventListener("abort", interrupted, { once: true });
    if (signal?.aborted) abort.abort();
    const timeout = setTimeout(() => abort.abort(), 120_000);
    let moved = false,
      created = false;
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
      created = true;
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
      const verified = await inspect(temporary, manifest, actorId);
      check();
      if (final.exists) return inspect(final, manifest, actorId);
      temporary.move(final);
      moved = true;
      return { ...verified, localUri: final.uri };
    } finally {
      signal?.removeEventListener("abort", interrupted);
      clearTimeout(timeout);
      abort.abort();
      writer?.close();
      await reader?.cancel().catch(() => undefined);
      if (created && !moved && temporary.exists) temporary.delete();
    }
  },
};
