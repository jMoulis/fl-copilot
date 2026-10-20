import { z } from "zod";
import {
  emailIntakeDecisionSchema,
  emailIntakeReceiptSchema,
  emailIntakeOriginalRequestSchema,
  emailIntakeOriginalManifestSchema,
  serializeEmailIntakeOriginalMetadata,
} from "@fl-copilot/sync-contracts";
import { sourceOriginalHash } from "../documents/source-original-hash";
import { joinedMutationDatabase } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { EmailIntakeCache, EmailIntakeScope } from "./email-intake-cache";
import type { EmailOriginalTransfer } from "./email-original-transfer";
export type EmailProcessingOrigin = {
  receiptId: string;
  fileId: string;
  actionId: string;
  processingId: string;
};
export async function readEmailProcessingAuthority(
  db: OutboxDatabase,
  scope: EmailIntakeScope,
  origin: EmailProcessingOrigin,
) {
  const row = await db.getFirstAsync<{
    payload_json: string;
    remote_payload_json: string | null;
    sync_state: string;
    dirty: number;
    remote_version: number | null;
  }>(
    "SELECT payload_json,remote_payload_json,sync_state,dirty,remote_version FROM email_intake_decisions WHERE id=? AND store_id=? AND owner_id=? AND conversation_id=?",
    origin.receiptId,
    scope.storeId,
    scope.ownerId,
    scope.conversationId,
  );
  if (
    !row ||
    row.sync_state !== "SYNCED" ||
    row.dirty ||
    row.remote_version !== 1 ||
    row.remote_payload_json !== row.payload_json
  )
    throw Error("EMAIL_INTAKE_DECISION_SYNC_REQUIRED");
  const decision = emailIntakeDecisionSchema.parse(
    JSON.parse(row.payload_json),
  );
  const selection = decision.files.find((f) => f.fileId === origin.fileId);
  if (
    decision.storeId !== scope.storeId ||
    decision.ownerId !== scope.ownerId ||
    decision.conversationId !== scope.conversationId ||
    decision.receiptId !== origin.receiptId ||
    decision.actionId !== origin.actionId ||
    decision.choice !== "ADMIT" ||
    !selection ||
    selection.processingId !== origin.processingId
  )
    throw Error("EMAIL_INTAKE_PROCESSING_FORBIDDEN");
  const cached = await db.getFirstAsync<{ payload_json: string }>(
    "SELECT payload_json FROM email_intake_receipts WHERE id=? AND store_id=? AND owner_id=? AND conversation_id=?",
    origin.receiptId,
    scope.storeId,
    scope.ownerId,
    scope.conversationId,
  );
  const receipt = cached
    ? emailIntakeReceiptSchema.parse(JSON.parse(cached.payload_json))
    : null;
  const file = receipt?.files.find((file) => file.id === origin.fileId);
  if (
    !receipt ||
    receipt.id !== origin.receiptId ||
    receipt.storeId !== scope.storeId ||
    receipt.ownerId !== scope.ownerId ||
    receipt.conversationId !== scope.conversationId ||
    ["DISMISSED", "QUARANTINED"].includes(receipt.status) ||
    !file ||
    !["READY", "APPLIED"].includes(file.status)
  )
    throw Error("EMAIL_INTAKE_PROCESSING_FORBIDDEN");
  return { decision, selection, receipt, file };
}
/** Common admission/ownership proof for the existing Mercalys, PDF and photo paths. */
export async function emailProcessingBasis(
  cache: EmailIntakeCache,
  raw: unknown,
  signal?: AbortSignal,
  externalAuthorize?: (tx?: OutboxDatabase) => Promise<void>,
) {
  const ref = emailIntakeOriginalRequestSchema.parse(raw),
    scope = cache.scope(ref.conversationId);
  const check = () => {
    cache.check(scope);
    if (signal?.aborted) throw Error("EMAIL_INTAKE_PROCESSING_INTERRUPTED");
  };
  check();
  await cache.authorize(scope);
  const row = await cache.db.getFirstAsync<{ payload_json: string }>(
    "SELECT payload_json FROM email_intake_decisions WHERE id=? AND store_id=? AND owner_id=? AND conversation_id=?",
    ref.receiptId,
    scope.storeId,
    scope.ownerId,
    scope.conversationId,
  );
  if (!row) throw Error("EMAIL_INTAKE_DECISION_SYNC_REQUIRED");
  const decision = emailIntakeDecisionSchema.parse(
    JSON.parse(row.payload_json),
  );
  const selection = decision.files.find((f) => f.fileId === ref.fileId);
  if (!selection) throw Error("EMAIL_INTAKE_PROCESSING_FORBIDDEN");
  const origin = {
    receiptId: ref.receiptId,
    fileId: ref.fileId,
    actionId: decision.actionId,
    processingId: selection.processingId,
  };
  const authorize = async (tx: OutboxDatabase = cache.db) => {
    check();
    await externalAuthorize?.(tx);
    await cache.authorize(scope, tx);
    const result = await readEmailProcessingAuthority(tx, scope, origin);
    check();
    return result;
  };
  const current = await authorize();
  const database = {
    ...joinedMutationDatabase(cache.db),
    withExclusiveTransactionAsync: (
      work: (tx: OutboxDatabase) => Promise<void>,
    ) =>
      cache.db.withExclusiveTransactionAsync(async (tx) => {
        await authorize(tx);
        await work(tx);
        await authorize(tx);
      }),
  };
  return { cache, scope, ref, origin, ...current, authorize, database };
}
export type EmailProcessingBasis = Awaited<
  ReturnType<typeof emailProcessingBasis>
>;
export async function verifiedEmailProcessingOriginal(
  basis: EmailProcessingBasis,
  originals: Pick<EmailOriginalTransfer, "local">,
  read: (uri: string, limit: number) => Promise<Uint8Array<ArrayBuffer>>,
  limit: number,
) {
  z.number()
    .int()
    .min(1)
    .max(100 * 1024 * 1024)
    .parse(limit);
  const { cache, scope, ref, selection, receipt, file, authorize } = basis;
  await authorize();
  const proof = await originals.local(ref);
  await authorize();
  if (!proof) throw Error("EMAIL_ORIGINAL_RECOVERY_REQUIRED");
  const retained = await cache.db.getFirstAsync<{
    manifest_json: string;
    local_uri: string;
  }>(
    "SELECT manifest_json,local_uri FROM email_original_manifests WHERE store_id=? AND owner_id=? AND conversation_id=? AND receipt_id=? AND file_id=?",
    scope.storeId,
    scope.ownerId,
    scope.conversationId,
    ref.receiptId,
    ref.fileId,
  );
  if (!retained || retained.local_uri !== proof.localUri)
    throw Error("EMAIL_INTAKE_ORIGINAL_CHANGED");
  const manifest = emailIntakeOriginalManifestSchema.parse(
    JSON.parse(retained.manifest_json),
  );
  const { manifestHash, ...metadata } = manifest;
  if (
    manifest.storeId !== scope.storeId ||
    manifest.ownerId !== scope.ownerId ||
    manifest.conversationId !== scope.conversationId ||
    manifest.receiptId !== ref.receiptId ||
    manifest.fileId !== ref.fileId ||
    manifest.filename !== file.filename ||
    manifest.providerEmailId !== receipt.providerEmailId ||
    manifest.providerAttachmentId !== file.providerAttachmentId ||
    manifest.declaredMimeType !== file.mediaType ||
    sourceOriginalHash(serializeEmailIntakeOriginalMetadata(metadata)) !==
      manifestHash ||
    (selection.manifestHash && selection.manifestHash !== manifestHash) ||
    (selection.checksum && selection.checksum !== manifest.checksum)
  )
    throw Error("EMAIL_INTAKE_ORIGINAL_CHANGED");
  if (manifest.sizeBytes > limit) throw Error("EMAIL_INTAKE_FILE_SIZE_INVALID");
  const bytes = await read(proof.localUri, limit);
  await authorize();
  if (
    !bytes.length ||
    bytes.length > limit ||
    bytes.length !== manifest.sizeBytes ||
    sourceOriginalHash(bytes) !== manifest.checksum
  )
    throw Error("EMAIL_INTAKE_ORIGINAL_CHANGED");
  return { ...proof, manifest, bytes };
}
export function emailSourceFilename(raw: string | null, fallback: string) {
  return (
    Array.from(raw ?? "", (char) =>
      char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? " " : char,
    )
      .join("")
      .trim()
      .slice(0, 240) || fallback
  );
}
