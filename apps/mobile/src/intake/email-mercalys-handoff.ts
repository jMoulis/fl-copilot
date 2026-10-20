import { z } from "zod";
import { assertSafeXlsxContainer } from "@fl-copilot/import-core";
import {
  MAX_MERCALYS_BATCH_BYTES,
  MAX_MERCALYS_BATCH_FILE_BYTES,
  copilotImportReferenceSchema,
  type CopilotMessage,
} from "@fl-copilot/domain";
import {
  emailIntakeDecisionSchema,
  emailIntakeOriginalManifestSchema,
  emailIntakeOriginalRequestSchema,
  serializeEmailIntakeOriginalMetadata,
} from "@fl-copilot/sync-contracts";
import { CopilotConversationRepository } from "../copilot/conversation-repository";
import { importManifestHash } from "../copilot/mercalys-import-controller";
import { MercalysBatchRepository } from "../documents/mercalys-batch-repository";
import { MercalysArchiveRepository } from "../documents/mercalys-archive-repository";
import {
  extractRetainedMercalysZip,
  nativeMercalysZipStorage,
  type MercalysZipStorage,
} from "../documents/mercalys-zip-capture";
import { SheetJsSpreadsheetParser } from "../documents/sheetjs-spreadsheet-parser";
import { sourceOriginalHash } from "../documents/source-original-hash";
import { joinedMutationDatabase } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { EmailIntakeCache } from "./email-intake-cache";
import type { EmailOriginalTransfer } from "./email-original-transfer";
import { assertEmailMercalysAuthority } from "./email-mercalys-authority";
import { emailProcessingIdentity } from "./email-processing-identity";

type Input = z.infer<typeof emailIntakeOriginalRequestSchema>;
type Dependencies = {
  read(uri: string, limit: number): Promise<Uint8Array<ArrayBuffer>>;
  zip: MercalysZipStorage;
};
const nativeDependencies: Dependencies = {
  async read(uri, limit) {
    const { File } = await import("expo-file-system");
    const file = new File(uri);
    if (!file.exists || file.size <= 0 || file.size > limit)
      throw Error("EMAIL_MERCALYS_SIZE_INVALID");
    return file.bytes();
  },
  zip: nativeMercalysZipStorage,
};
export type EmailMercalysHandoffResult =
  | { status: "ATTACHED"; message: CopilotMessage; batchId: string }
  | {
      status: "RETRY";
      archiveId: string;
      retainedCount: number;
      failures: Array<{ path: string; code: string }>;
    };

/** Bridge to the existing import card/engine. No AI, publication or new job runner here.
 * Its structured USER event records the already authenticated ADMIT action; no email
 * subject/body becomes a user instruction and the composer's draft is untouched. */
export class EmailMercalysHandoff {
  private active = new Map<string, Promise<EmailMercalysHandoffResult>>();
  constructor(
    private cache: EmailIntakeCache,
    private originals: Pick<EmailOriginalTransfer, "local">,
    private deviceId: string,
    private dependencies: Dependencies = nativeDependencies,
  ) {
    z.uuid().parse(deviceId);
  }
  async attach(raw: Input, signal?: AbortSignal) {
    const ref = emailIntakeOriginalRequestSchema.parse(raw),
      scope = this.cache.scope(ref.conversationId);
    const key = [
      scope.storeId,
      scope.ownerId,
      ref.conversationId,
      ref.receiptId,
      ref.fileId,
    ].join(":");
    const prior = this.active.get(key);
    if (prior) return prior;
    const task = this.run(ref, signal);
    this.active.set(key, task);
    void task
      .finally(() => {
        if (this.active.get(key) === task) this.active.delete(key);
      })
      .catch(() => undefined);
    return task;
  }
  private async run(
    ref: Input,
    signal?: AbortSignal,
  ): Promise<EmailMercalysHandoffResult> {
    const scope = this.cache.scope(ref.conversationId);
    const cancelled = () => {
      this.cache.check(scope);
      if (signal?.aborted) throw Error("EMAIL_INTAKE_PROCESSING_INTERRUPTED");
    };
    cancelled();
    await this.cache.authorize(scope);
    const row = await this.cache.db.getFirstAsync<{ payload_json: string }>(
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
    const batchId = emailProcessingIdentity(scope, origin, "BATCH");
    // The temporary reference is used only for authority checks, never persisted.
    const authority = copilotImportReferenceSchema.parse({
      kind: "MERCALYS_CHAT_IMPORT",
      schemaVersion: 1,
      policyVersion: 2,
      batchId,
      label: "Email",
      manifestHash: "0".repeat(64),
      emailOrigin: origin,
    });
    const allowed = async (tx: OutboxDatabase = this.cache.db) => {
      cancelled();
      await this.cache.authorize(scope, tx);
      await assertEmailMercalysAuthority(tx, scope, authority);
      cancelled();
    };
    await allowed();
    const basis = await this.cache.originalBasis(scope, ref);
    const filename = basis.file.filename ?? "";
    const zip = /\.zip$/i.test(filename),
      xlsx = /\.xlsx$/i.test(filename);
    if (!zip && !xlsx) throw Error("EMAIL_MERCALYS_FORMAT_REQUIRED");
    const proof = await this.originals.local(ref);
    await allowed();
    if (!proof) throw Error("EMAIL_ORIGINAL_RECOVERY_REQUIRED");
    const retained = await this.cache.db.getFirstAsync<{
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
      manifest.filename !== basis.file.filename ||
      manifest.providerEmailId !== basis.receipt.providerEmailId ||
      manifest.providerAttachmentId !== basis.file.providerAttachmentId ||
      manifest.declaredMimeType !== basis.file.mediaType ||
      sourceOriginalHash(serializeEmailIntakeOriginalMetadata(metadata)) !==
        manifestHash
    )
      throw Error("EMAIL_INTAKE_ORIGINAL_CHANGED");
    if (
      (selection.manifestHash &&
        selection.manifestHash !== manifest.manifestHash) ||
      (selection.checksum && selection.checksum !== manifest.checksum)
    )
      throw Error("EMAIL_INTAKE_ORIGINAL_CHANGED");
    const limit = zip
      ? MAX_MERCALYS_BATCH_BYTES
      : MAX_MERCALYS_BATCH_FILE_BYTES;
    if (manifest.sizeBytes > limit) throw Error("EMAIL_MERCALYS_SIZE_INVALID");
    const bytes = await this.dependencies.read(proof.localUri, limit);
    await allowed();
    if (
      !bytes.length ||
      bytes.length > limit ||
      bytes.length !== manifest.sizeBytes ||
      sourceOriginalHash(bytes) !== manifest.checksum
    )
      throw Error("EMAIL_INTAKE_ORIGINAL_CHANGED");
    if (!zip) {
      await assertSafeXlsxContainer(bytes, signal);
      new SheetJsSpreadsheetParser().parse(bytes);
    }
    await allowed();
    // Every repository commit rechecks the live owner/conversation and accepted choice.
    const database = {
      ...joinedMutationDatabase(this.cache.db),
      withExclusiveTransactionAsync: (
        work: (tx: OutboxDatabase) => Promise<void>,
      ) =>
        this.cache.db.withExclusiveTransactionAsync(async (tx) => {
          await allowed(tx);
          await work(tx);
          await allowed(tx);
        }),
    };
    const batches = new MercalysBatchRepository(database, scope);
    const label =
      Array.from(filename, (char) =>
        char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? " " : char,
      )
        .join("")
        .trim()
        .slice(0, 240) || (zip ? "Exports.zip" : "Export.xlsx");
    if (zip) {
      const archiveId = emailProcessingIdentity(scope, origin, "ARCHIVE"),
        archives = new MercalysArchiveRepository(database, scope);
      await archives.create({
        id: archiveId,
        batchId,
        ...scope,
        filename: label,
        localUri: proof.localUri,
        sizeBytes: manifest.sizeBytes,
        checksum: manifest.checksum,
        createdAt: decision.createdAt,
      });
      // A prior outcome is not a physical-file proof after restart/cache loss.
      // The existing member store verifies/reuses stable copies or restores them.
      {
        const result = await extractRetainedMercalysZip(
          archiveId,
          archives,
          batches,
          {
            ...this.dependencies.zip,
            read: async (uri) => {
              await allowed();
              const result = await this.dependencies.zip.read(uri);
              await allowed();
              return result;
            },
            member: async (data, id) => {
              await allowed();
              await assertSafeXlsxContainer(data, signal);
              new SheetJsSpreadsheetParser().parse(data);
              const result = await this.dependencies.zip.member(data, id);
              await allowed();
              return result;
            },
          },
          signal,
        );
        if (result.outcome.status !== "PROCESSED")
          throw Error("EMAIL_MERCALYS_ARCHIVE_INVALID");
        if (result.outcome.failures.length)
          return {
            status: "RETRY",
            archiveId,
            retainedCount: result.outcome.retainedCount,
            failures: result.outcome.failures,
          };
      }
    } else {
      await batches.create({
        id: batchId,
        ...scope,
        createdAt: decision.createdAt,
        files: [
          {
            id: emailProcessingIdentity(scope, origin, "ITEM"),
            filename: label,
            localUri: proof.localUri,
            sizeBytes: manifest.sizeBytes,
            checksum: manifest.checksum,
          },
        ],
      });
    }
    await allowed();
    const batch = await batches.header(batchId);
    const reference = copilotImportReferenceSchema.parse({
      ...authority,
      label,
      manifestHash: await importManifestHash(batch, async (text) =>
        sourceOriginalHash(text).slice(7),
      ),
    });
    const message: CopilotMessage = {
      id: emailProcessingIdentity(scope, origin, "MESSAGE"),
      ...scope,
      role: "USER",
      text: JSON.stringify(reference),
      attachments: [],
      replyToMessageId: null,
      supersedesMessageId: null,
      version: 1,
      createdAt: decision.createdAt,
    };
    await database.withExclusiveTransactionAsync(async (tx) => {
      await new CopilotConversationRepository(
        joinedMutationDatabase(tx),
        scope,
      ).append(message, {
        commandId: emailProcessingIdentity(scope, origin, "COMMAND"),
        deviceId: this.deviceId,
        preserveDraft: true,
      });
    });
    return { status: "ATTACHED", message, batchId };
  }
}
