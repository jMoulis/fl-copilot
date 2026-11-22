import { MAX_PROCUREMENT_SOURCE_BYTES } from "@fl-copilot/domain";
import { sourceOriginalHash } from "./source-original-hash";
import { sourceFileDirectory } from "./source-file-directory";
import { retainedOriginalFile } from "./read-retained-mercalys";
/** App-owned immutable original, never deleted after staging or a failed operation. */
export async function retainProcurementJson(uri: string, check: () => void) {
  const { File, Directory, Paths } = await import("expo-file-system");
  check();
  const source = new File(uri);
  if (
    !source.exists ||
    !source.size ||
    source.size > MAX_PROCUREMENT_SOURCE_BYTES
  )
    throw Error("PROCUREMENT_SOURCE_SIZE_INVALID");
  const bytes = await source.bytes();
  check();
  if (bytes.length > MAX_PROCUREMENT_SOURCE_BYTES)
    throw Error("PROCUREMENT_SOURCE_SIZE_INVALID");
  const checksum = sourceOriginalHash(bytes);
  const directory = new Directory(Paths.document, "procurement-catalogues");
  directory.create({ idempotent: true, intermediates: true });
  const target = new File(directory, `original-${checksum.slice(7)}.json`);
  if (target.exists) {
    if (sourceOriginalHash(await target.bytes()) !== checksum)
      throw Error("PROCUREMENT_SOURCE_CHANGED");
  } else target.write(bytes);
  check();
  return { localUri: target.uri, checksum };
}
export const procurementNativeOriginals = {
  sha256: async (bytes: Uint8Array) => sourceOriginalHash(bytes),
  read: async (uri: string, maximumBytes = 25 * 1024 * 1024) => {
    const { File, Paths } = await import("expo-file-system");
    if (
      !uri.startsWith("file://") ||
      uri.includes("%") ||
      uri.includes("\0") ||
      uri.split("/").includes("..")
    )
      throw Error("PROCUREMENT_ORIGINAL_REQUIRED");
    let file = new File(uri);
    if (!file.exists) {
      const name = uri.split("/").at(-1) ?? "";
      if (
        /^original-[a-f0-9]{64}\.json$/.test(name) &&
        uri.endsWith("/procurement-catalogues/" + name)
      )
        file = new File(Paths.document, "procurement-catalogues", name);
      else if (sourceFileDirectory(uri, "") !== "")
        file = new File(Paths.document, sourceFileDirectory(uri, ""), name);
      else file = await retainedOriginalFile(uri);
    }
    if (!file.exists || !file.size || file.size > maximumBytes)
      throw Error("PROCUREMENT_REFERENCE_ORIGINAL_REQUIRED");
    const bytes = await file.bytes();
    if (bytes.length > maximumBytes)
      throw Error("PROCUREMENT_SOURCE_SIZE_INVALID");
    return bytes;
  },
};
