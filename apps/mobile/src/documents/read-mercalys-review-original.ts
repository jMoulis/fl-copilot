import type { OutboxDatabase } from "../sync/outbox-repository";
import type { SourceOriginalTransfer } from "./source-original-transfer";
import { localOperationFailureCode } from "../observability/local-operation-failure";
import { readRetainedMercalysBytes } from "./read-retained-mercalys";

/** Reuse a published copy or canonical original recovery; never start another import. */
export async function readMercalysReviewOriginal(
  uri: string,
  checksum: string,
  storeId: string,
  db: Pick<OutboxDatabase, "getFirstAsync">,
  originals?: Pick<SourceOriginalTransfer, "recover">,
) {
  try {
    return await readRetainedMercalysBytes(uri);
  } catch (missing) {
    if (
      localOperationFailureCode(missing) !== "LOCAL_FILE_MISSING" ||
      !checksum ||
      !originals
    )
      throw missing;
    const source = await db.getFirstAsync<{
      id: string;
      local_file_uri: string | null;
    }>(
      `SELECT id,local_file_uri FROM source_documents
       WHERE store_id=? AND checksum=? AND deleted_at IS NULL
       AND source_type IN ('MERCALYS_SALES','MERCALYS_WASTE')
       ORDER BY created_at DESC,id LIMIT 1`,
      storeId,
      checksum,
    );
    if (!source) throw missing;
    if (source.local_file_uri && source.local_file_uri !== uri) {
      try {
        return await readRetainedMercalysBytes(source.local_file_uri);
      } catch (error) {
        if (localOperationFailureCode(error) !== "LOCAL_FILE_MISSING")
          throw error;
      }
    }
    try {
      const proof = await originals.recover(source.id);
      return await readRetainedMercalysBytes(proof.localUri);
    } catch (cause) {
      throw new Error("MERCALYS_ORIGINAL_RECOVERY_FAILED", { cause });
    }
  }
  // The review still checks the expected immutable checksum before parsing any returned bytes.
}
