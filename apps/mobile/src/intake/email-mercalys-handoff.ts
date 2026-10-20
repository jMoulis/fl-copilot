import { readNativeEmailProcessingBytes } from "./email-original-files";
import { z } from "zod";
import { assertSafeXlsxContainer } from "@fl-copilot/import-core";
import {
  MAX_MERCALYS_BATCH_BYTES,
  MAX_MERCALYS_BATCH_FILE_BYTES,
  copilotImportReferenceSchema,
  type CopilotMessage,
} from "@fl-copilot/domain";
import { emailIntakeOriginalRequestSchema } from "@fl-copilot/sync-contracts";
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
import {
  emailProcessingBasis,
  verifiedEmailProcessingOriginal,
  emailSourceFilename,
} from "./email-processing-basis";
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
  read: readNativeEmailProcessingBytes,
  zip: nativeMercalysZipStorage,
};
export type EmailMercalysHandoffResult =
  | {
      status: "ATTACHED";
      message: CopilotMessage;
      batchId: string;
      failures?: Array<{ path: string; code: string }>;
    }
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
  async attach(
    raw: Input,
    signal?: AbortSignal,
    authorize?: (tx?: OutboxDatabase) => Promise<void>,
    format?: "XLSX" | "ZIP",
  ) {
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
    const task = this.run(ref, signal, authorize, format);
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
    authorize?: (tx?: OutboxDatabase) => Promise<void>,
    format?: "XLSX" | "ZIP",
  ): Promise<EmailMercalysHandoffResult> {
    const basis = await emailProcessingBasis(
      this.cache,
      ref,
      signal,
      authorize,
    );
    const { scope, origin, decision, database } = basis;
    const batchId = emailProcessingIdentity(scope, origin, "BATCH");
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
      await basis.authorize(tx);
      await assertEmailMercalysAuthority(tx, scope, authority);
    };
    await allowed();
    const filename = basis.file.filename ?? "";
    const zip = format ? format === "ZIP" : /\.zip$/i.test(filename),
      xlsx = format ? format === "XLSX" : /\.xlsx$/i.test(filename);
    if (!zip && !xlsx) throw Error("EMAIL_MERCALYS_FORMAT_REQUIRED");
    const { bytes, manifest, ...proof } = await verifiedEmailProcessingOriginal(
      basis,
      this.originals,
      this.dependencies.read,
      zip ? MAX_MERCALYS_BATCH_BYTES : MAX_MERCALYS_BATCH_FILE_BYTES,
    );
    if (!zip) {
      await assertSafeXlsxContainer(bytes, signal);
      new SheetJsSpreadsheetParser().parse(bytes);
    }
    await allowed();
    const batches = new MercalysBatchRepository(database, scope);
    const label = emailSourceFilename(
      filename,
      zip ? "Exports.zip" : "Export.xlsx",
    );
    let memberFailures: Array<{ path: string; code: string }> = [];
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
            validate: async (data) => {
              await allowed();
              await assertSafeXlsxContainer(data, signal);
              await allowed();
            },
            member: async (data, id) => {
              await allowed();
              const result = await this.dependencies.zip.member(data, id);
              await allowed();
              return result;
            },
          },
          signal,
        );
        if (result.outcome.status !== "PROCESSED")
          throw Error("EMAIL_MERCALYS_ARCHIVE_INVALID");
        if (result.identityPending || result.identifiedCount === 0)
          return {
            status: "RETRY",
            archiveId,
            retainedCount: result.outcome.retainedCount,
            failures: result.outcome.failures,
          };
        memberFailures = result.outcome.failures;
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
    return {
      status: "ATTACHED",
      message,
      batchId,
      ...(memberFailures.length ? { failures: memberFailures } : {}),
    };
  }
}
