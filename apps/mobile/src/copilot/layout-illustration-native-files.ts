import {
  layoutIllustrationManifestSchema,
  type LayoutIllustrationManifest,
  type LayoutIllustrationFileVariant,
} from "@fl-copilot/sync-contracts";
import { z } from "zod";
import { detectVisualImageMime } from "@fl-copilot/domain";
import { verifyPrivateOriginalFile } from "../documents/private-original-file";
import { sourceOriginalHash } from "../documents/source-original-hash";
import { withVisualFiles } from "../products/visual-file-lock";
import type { LayoutIllustrationFilePort } from "./layout-illustration-transfer";
const invalid = () => Error("LAYOUT_ILLUSTRATION_FILE_INVALID");
async function location(
  raw: LayoutIllustrationManifest,
  variant: LayoutIllustrationFileVariant,
) {
  const m = layoutIllustrationManifestSchema.parse(raw);
  if (!Object.hasOwn(m.files, variant)) throw invalid();
  const { File, Directory, Paths } = await import("expo-file-system");
  const directory = new Directory(
    Paths.document,
    "copilot-illustrations",
    m.preparation.storeId,
    m.preparation.ownerId,
    m.preparation.id,
    m.id,
  );
  return {
    directory,
    preparationDirectory: new Directory(
      Paths.document,
      "copilot-illustrations",
      m.preparation.storeId,
      m.preparation.ownerId,
      m.preparation.id,
    ),
    File,
    file: new File(
      directory,
      `${variant}-${m.files[variant].checksum.slice(7)}.${variant === "data" ? "json" : "png"}`,
    ),
  };
}
async function inspect(
  file: import("expo-file-system").File,
  m: LayoutIllustrationManifest,
  variant: LayoutIllustrationFileVariant,
) {
  const e = m.files[variant];
  await verifyPrivateOriginalFile(file, e, invalid, (header) => {
    if (
      e.mimeType === "image/png" &&
      detectVisualImageMime(header) !== "image/png"
    )
      throw invalid();
  });
  if (e.mimeType === "image/png") {
    const { readNativeImageSize } = await import("../media/image-size"),
      dimensions = await readNativeImageSize(file.uri);
    if (dimensions.width !== 1536 || dimensions.height !== 1024)
      throw invalid();
  } else {
    JSON.parse(await file.text());
  }
  return file.uri;
}
export const nativeLayoutIllustrationFiles: LayoutIllustrationFilePort = {
  async usage(scope) {
    z.uuid().parse(scope.storeId);
    z.uuid().parse(scope.userId);
    return withVisualFiles(scope.storeId, async () => {
      const { Directory, File, Paths } = await import("expo-file-system");
      const root = new Directory(
        Paths.document,
        "copilot-illustrations",
        scope.storeId,
        scope.userId,
      );
      if (!root.exists) return 0;
      let count = 0;
      function bytes(
        directory: import("expo-file-system").Directory,
        depth: number,
      ): number {
        if (depth > 8) throw invalid();
        return directory.list().reduce((total, entry) => {
          if (++count > 4096) throw invalid();
          if (entry instanceof File) {
            const size = entry.size;
            if (!Number.isSafeInteger(size) || size < 0) throw invalid();
            return total + size;
          }
          return total + bytes(entry, depth + 1);
        }, 0);
      }
      return bytes(root, 0);
    });
  },
  async remove(m, v, check) {
    return withVisualFiles(m.preparation.storeId, async () => {
      check();
      const { file, directory, preparationDirectory } = await location(m, v);
      check();
      // This directory contains downloaded server copies only, never captured originals.
      if (file.exists) file.delete();
      if (directory.exists && !directory.list().length) directory.delete();
      if (preparationDirectory.exists && !preparationDirectory.list().length)
        preparationDirectory.delete();
    });
  },
  async existing(m, v) {
    return withVisualFiles(m.preparation.storeId, async () => {
      const { file } = await location(m, v);
      return file.exists ? inspect(file, m, v) : null;
    });
  },
  async write(m, v, bytes, check) {
    return withVisualFiles(m.preparation.storeId, async () => {
      check();
      const e = m.files[v];
      if (
        bytes.byteLength !== e.sizeBytes ||
        sourceOriginalHash(bytes) !== e.checksum
      )
        throw invalid();
      const { file, directory, File } = await location(m, v);
      directory.create({ intermediates: true, idempotent: true });
      const { randomUUID } = await import("expo-crypto"),
        temp = new File(directory, `${randomUUID()}.partial`);
      let moved = false;
      try {
        temp.create();
        temp.write(bytes);
        await inspect(temp, m, v);
        check();
        if (file.exists) {
          try {
            return await inspect(file, m, v);
          } catch {
            check();
            file.delete();
          }
        }
        check();
        temp.move(file);
        moved = true;
        return file.uri;
      } finally {
        if (!moved && temp.exists) temp.delete();
      }
    });
  },
};
