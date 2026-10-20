import {
  verifyPrivateOriginalFile,
  receivePrivateOriginalFile,
} from "./private-original-file";
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
  await verifyPrivateOriginalFile(file, expected, invalid, (header) =>
    verifyType(header, expected.mimeType),
  );
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
    const { File } = await import("expo-file-system");
    const dir = await directory(manifest, actorId);
    dir.create({ intermediates: true, idempotent: true });
    return receivePrivateOriginalFile({
      url: lease.url,
      expiresAt: lease.expiresAt,
      sizeBytes: manifest.sizeBytes,
      mimeType: manifest.mimeType,
      directory: dir,
      final: new File(
        dir,
        `original-${manifest.checksum.slice(7)}.${extension(manifest.mimeType)}`,
      ),
      check,
      signal,
      inspect: (file) => inspect(file, manifest, actorId),
      fault: (kind) =>
        kind === "INVALID"
          ? invalid()
          : Error(
              kind === "EXPIRED"
                ? "SOURCE_ORIGINAL_LEASE_EXPIRED"
                : "SOURCE_ORIGINAL_DOWNLOAD_UNAVAILABLE",
            ),
    });
  },
};
