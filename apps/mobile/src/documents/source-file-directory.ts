/** Handles the new private copy folder when iOS relocates the app container. */
export function sourceFileDirectory(
  localUri: string,
  ordinaryDirectory: string,
) {
  return /\/source-restorations\/[a-f0-9-]{36}\.(pdf|xlsx)$/.test(localUri)
    ? "source-restorations"
    : ordinaryDirectory;
}
