import { z } from "zod";
import {
  emailIntakeOriginalManifestSchema,
  emailIntakeOriginalDownloadSchema,
  type EmailIntakeOriginalManifest,
} from "@fl-copilot/sync-contracts";
import { sourceOriginalHash } from "../documents/source-original-hash";
import {
  receivePrivateOriginalFile,
  verifyPrivateOriginalFile,
} from "../documents/private-original-file";
import type { EmailOriginalFiles } from "./email-original-transfer";
const invalid = () => Error("EMAIL_ORIGINAL_FILE_INVALID");
async function paths(raw: EmailIntakeOriginalManifest, ownerId: string) {
  const manifest = emailIntakeOriginalManifestSchema.parse(raw);
  if (z.uuid().parse(ownerId) !== manifest.ownerId) throw invalid();
  const { Directory, File, Paths } = await import("expo-file-system");
  const directory = new Directory(
    Paths.document,
    "email-originals",
    manifest.storeId,
    ownerId,
    manifest.receiptId,
    manifest.fileId,
  );
  const final = new File(
    directory,
    `original-${manifest.checksum.slice(7)}.bin`,
  );
  return { manifest, directory, final };
}
async function inspect(
  file: import("expo-file-system").File,
  manifest: EmailIntakeOriginalManifest,
) {
  // The declared media type is not a business classification or file-format proof.
  await verifyPrivateOriginalFile(file, manifest, invalid);
  return { localUri: file.uri };
}
/** Unclassified, immutable originals; no source/import/publication is created here. */
export const nativeEmailOriginalFiles: EmailOriginalFiles = {
  async hash(text) {
    return sourceOriginalHash(text);
  },
  async existing(raw, ownerId) {
    const { manifest, final } = await paths(raw, ownerId);
    return final.exists ? inspect(final, manifest) : null;
  },
  async receive(raw, ownerId, check, signal) {
    const lease = emailIntakeOriginalDownloadSchema.parse(raw);
    const { manifest, directory, final } = await paths(lease.manifest, ownerId);
    check();
    directory.create({ intermediates: true, idempotent: true });
    return receivePrivateOriginalFile({
      url: lease.url,
      expiresAt: lease.expiresAt,
      sizeBytes: manifest.sizeBytes,
      mimeType: manifest.declaredMimeType.toLowerCase(),
      directory,
      final,
      check,
      signal,
      inspect: (file) => inspect(file, manifest),
      fault: (kind) =>
        kind === "INVALID"
          ? invalid()
          : Error(
              kind === "EXPIRED"
                ? "EMAIL_ORIGINAL_LEASE_EXPIRED"
                : "EMAIL_ORIGINAL_DOWNLOAD_UNAVAILABLE",
            ),
    });
  },
};
