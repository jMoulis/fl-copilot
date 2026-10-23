import { sourceFileDirectory } from "./source-file-directory";

/** Read an immutable retained original after a native app-container move. */
export async function readRetainedMercalysBytes(uri: string) {
  if (
    !uri.startsWith("file://") ||
    uri.includes("%") ||
    uri.includes("\0") ||
    uri.split("/").includes("..")
  )
    throw missingOriginal();
  const { File, Paths } = await import("expo-file-system");
  let file = new File(uri);
  if (!file.exists) {
    const directory = sourceFileDirectory(uri, "mercalys-imports");
    const name = uri.split("/").at(-1) ?? "";
    // Never search by a user filename or follow traversal into another folder.
    const retainedName =
      /^(?:[a-f0-9-]{36}|(?:original|view)-[a-f0-9]{64})\.xlsx$/;
    if (retainedName.test(name) && uri.endsWith(`/${directory}/${name}`))
      file = new File(Paths.document, directory, name);
  }
  if (!file.exists) throw missingOriginal();
  // Callers still verify the immutable checksum and, for preparation, the size.
  return file.bytes();
}

function missingOriginal() {
  return Object.assign(new Error("Retained Mercalys original is missing."), {
    code: "ENOENT",
  });
}
