import { z } from "zod";
import {
  detectVisualImageMime,
  VISUAL_LIBRARY_POLICY,
  type VisualAsset,
} from "@fl-copilot/domain";
import {
  visualFilePath,
  type VerifiedVisualFile,
  type VisualFileVariant,
} from "./visual-file-cache";
export type VisualFileDescriptor = Pick<
  VisualAsset,
  "contentHash" | "mimeType" | "sizeBytes"
>;
export interface VisualFileStorage {
  capture(
    storeId: string,
    selectedUri: string,
  ): Promise<
    VerifiedVisualFile & {
      mimeType: VisualAsset["mimeType"];
      width: number;
      height: number;
    }
  >;
  read(
    storeId: string,
    variant: VisualFileVariant,
    descriptor: VisualFileDescriptor,
  ): Promise<Uint8Array>;
  write(
    storeId: string,
    variant: VisualFileVariant,
    descriptor: VisualFileDescriptor,
    bytes: Uint8Array,
  ): Promise<VerifiedVisualFile>;
  uri(
    storeId: string,
    variant: VisualFileVariant,
    descriptor: VisualFileDescriptor,
  ): Promise<string | null>;
  upload(
    storeId: string,
    descriptor: VisualFileDescriptor,
    url: string,
    headers: Record<string, string>,
  ): Promise<void>;
}
async function checksum(bytes: Uint8Array) {
  const { digest, CryptoDigestAlgorithm } = await import("expo-crypto");
  const result = await digest(
    CryptoDigestAlgorithm.SHA256,
    new Uint8Array(bytes),
  );
  return `sha256:${Array.from(new Uint8Array(result), (v) => v.toString(16).padStart(2, "0")).join("")}`;
}
async function verify(bytes: Uint8Array, expected: VisualFileDescriptor) {
  if (
    bytes.byteLength !== expected.sizeBytes ||
    expected.sizeBytes <= 0 ||
    expected.sizeBytes > VISUAL_LIBRARY_POLICY.maximumBytes ||
    detectVisualImageMime(bytes) !== expected.mimeType ||
    (await checksum(bytes)) !== expected.contentHash
  )
    throw Error("VISUAL_FILE_INVALID");
}
async function destination(
  storeId: string,
  variant: VisualFileVariant,
  descriptor: VisualFileDescriptor,
) {
  const { File, Paths } = await import("expo-file-system");
  return new File(
    Paths.document,
    visualFilePath(
      storeId,
      variant,
      descriptor.mimeType,
      descriptor.contentHash,
    ),
  );
}
/** App-owned immutable bytes only. No absolute path is stored in sync metadata. */
export const nativeVisualFileStorage: VisualFileStorage = {
  async capture(storeId, selectedUri) {
    z.uuid().parse(storeId);
    const { File } = await import("expo-file-system");
    const selected = new File(selectedUri);
    if (
      !selected.exists ||
      selected.size <= 0 ||
      selected.size > VISUAL_LIBRARY_POLICY.maximumBytes
    )
      throw Error("VISUAL_FILE_INVALID");
    const bytes = await selected.bytes(),
      mimeType = detectVisualImageMime(bytes);
    if (!mimeType) throw Error("VISUAL_FILE_INVALID");
    const { Image } = await import("react-native");
    const { width, height } = await Image.getSize(selected.uri);
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width <= 0 ||
      height <= 0 ||
      width > 12000 ||
      height > 12000 ||
      width * height > VISUAL_LIBRARY_POLICY.maximumPixels
    )
      throw Error("VISUAL_FILE_INVALID");
    const descriptor = {
      contentHash: await checksum(bytes),
      mimeType,
      sizeBytes: bytes.byteLength,
    };
    const result = await nativeVisualFileStorage.write(
      storeId,
      "SOURCE",
      descriptor,
      bytes,
    );
    return { ...result, mimeType, width, height };
  },
  async read(storeId, variant, descriptor) {
    const file = await destination(storeId, variant, descriptor);
    if (!file.exists) throw Error("VISUAL_SOURCE_FILE_MISSING");
    if (
      file.size !== descriptor.sizeBytes ||
      file.size > VISUAL_LIBRARY_POLICY.maximumBytes
    )
      throw Error("VISUAL_FILE_INVALID");
    const bytes = await file.bytes();
    await verify(bytes, descriptor);
    return bytes;
  },
  async write(storeId, variant, descriptor, bytes) {
    z.uuid().parse(storeId);
    if (variant === "PREVIEW" && bytes.byteLength > 2 * 1024 * 1024)
      throw Error("VISUAL_FILE_INVALID");
    await verify(bytes, descriptor);
    const { File, Directory, Paths } = await import("expo-file-system"),
      { randomUUID } = await import("expo-crypto");
    const directory = new Directory(Paths.document, "visual-library", storeId);
    directory.create({ intermediates: true, idempotent: true });
    const file = await destination(storeId, variant, descriptor);
    if (file.exists)
      await nativeVisualFileStorage.read(storeId, variant, descriptor);
    else {
      const temporary = new File(directory, `${randomUUID()}.part`);
      const temporaryUri = temporary.uri;
      try {
        temporary.create();
        temporary.write(bytes);
        await verify(await temporary.bytes(), descriptor);
        // A concurrent capture may have installed the identical hash while we verified.
        if (file.exists)
          await nativeVisualFileStorage.read(storeId, variant, descriptor);
        else await temporary.move(file);
      } finally {
        if (temporary.uri === temporaryUri && temporary.exists)
          temporary.delete();
      }
    }
    return {
      relativePath: visualFilePath(
        storeId,
        variant,
        descriptor.mimeType,
        descriptor.contentHash,
      ),
      contentHash: descriptor.contentHash,
      sizeBytes: descriptor.sizeBytes,
    };
  },
  async uri(storeId, variant, descriptor) {
    const file = await destination(storeId, variant, descriptor);
    if (!file.exists) return null;
    await nativeVisualFileStorage.read(storeId, variant, descriptor);
    return file.uri;
  },
  async upload(storeId, descriptor, url, headers) {
    // No session token is forwarded to storage; only headers returned with the scoped signed URL.
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password)
      throw Error("VISUAL_UPLOAD_URL_INVALID");
    await nativeVisualFileStorage.read(storeId, "SOURCE", descriptor);
    const file = await destination(storeId, "SOURCE", descriptor);
    const response = await file.upload(url, { httpMethod: "PUT", headers });
    if (response.status < 200 || response.status >= 300)
      throw Error(`VISUAL_UPLOAD_HTTP_${response.status}`);
  },
};
