import type { ImportVerificationConflict } from "./import-verification-conflict-repository";

export function useOpenImportVerificationConflicts(
  storeId: string | undefined,
  refreshKey: unknown,
): ImportVerificationConflict[] {
  void storeId;
  void refreshKey;
  return [];
}

export function useImportVerificationConflict(
  sourceDocumentId: string | undefined,
  storeId: string | undefined,
) {
  void sourceDocumentId;
  void storeId;
  return null;
}
