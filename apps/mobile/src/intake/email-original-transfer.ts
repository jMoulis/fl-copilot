import { z } from "zod";
import {
  emailIntakeOriginalRequestSchema,
  emailIntakeOriginalManifestSchema,
  emailIntakeOriginalDownloadSchema,
  serializeEmailIntakeOriginalMetadata,
  type EmailIntakeOriginalRequest,
  type EmailIntakeOriginalManifest,
  type EmailIntakeOriginalDownload,
} from "@fl-copilot/sync-contracts";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { EmailIntakeCache, type EmailIntakeScope } from "./email-intake-cache";
export type EmailOriginalProof = { localUri: string };
export interface EmailOriginalFiles {
  hash(text: string): Promise<string>;
  existing(
    manifest: EmailIntakeOriginalManifest,
    ownerId: string,
  ): Promise<EmailOriginalProof | null>;
  receive(
    lease: EmailIntakeOriginalDownload,
    ownerId: string,
    check: () => void,
    signal?: AbortSignal,
  ): Promise<EmailOriginalProof>;
}

export interface EmailOriginalTransport {
  manifest(
    storeId: string,
    ownerId: string,
    ref: EmailIntakeOriginalRequest,
  ): Promise<EmailIntakeOriginalManifest>;
  download(
    storeId: string,
    ownerId: string,
    ref: EmailIntakeOriginalRequest,
  ): Promise<EmailIntakeOriginalDownload>;
}
const proofSchema = z.strictObject({
  localUri: z.string().startsWith("file://").max(4096),
});
type Basis = Awaited<ReturnType<EmailIntakeCache["originalBasis"]>>;
type Record = { manifest_json: string; local_uri: string };
/** Raw attachment recovery only. Admission and canonical publication are separate actions. */
export class EmailOriginalTransfer {
  private active = new Map<string, Promise<EmailOriginalProof>>();
  constructor(
    private cache: EmailIntakeCache,
    private api: EmailOriginalTransport,
    private files: EmailOriginalFiles,
    private now: () => Date = () => new Date(),
  ) {}
  private async binding(raw: unknown, scope: EmailIntakeScope, basis: Basis) {
    const manifest = emailIntakeOriginalManifestSchema.parse(raw);
    if (
      manifest.storeId !== scope.storeId ||
      manifest.ownerId !== scope.ownerId ||
      manifest.conversationId !== scope.conversationId ||
      manifest.receiptId !== basis.receipt.id ||
      manifest.fileId !== basis.file.id ||
      manifest.providerEmailId !== basis.receipt.providerEmailId ||
      manifest.providerAttachmentId !== basis.file.providerAttachmentId ||
      manifest.filename !== basis.file.filename ||
      manifest.declaredMimeType !== basis.file.mediaType
    )
      throw Error("EMAIL_ORIGINAL_BINDING_INVALID");
    const { manifestHash, ...metadata } = manifest;
    if (
      (await this.files.hash(
        serializeEmailIntakeOriginalMetadata(metadata),
      )) !== manifestHash
    )
      throw Error("EMAIL_ORIGINAL_BINDING_INVALID");
    this.cache.check(scope);
    return manifest;
  }
  private async record(
    scope: EmailIntakeScope,
    ref: EmailIntakeOriginalRequest,
    tx: OutboxDatabase = this.cache.db,
  ) {
    const row = await tx.getFirstAsync<Record>(
      "SELECT manifest_json,local_uri FROM email_original_manifests WHERE store_id=? AND owner_id=? AND conversation_id=? AND receipt_id=? AND file_id=?",
      scope.storeId,
      scope.ownerId,
      scope.conversationId,
      ref.receiptId,
      ref.fileId,
    );
    this.cache.check(scope);
    return row;
  }
  private async unchanged(
    scope: EmailIntakeScope,
    ref: EmailIntakeOriginalRequest,
    basis: Basis,
    tx: OutboxDatabase = this.cache.db,
  ) {
    const live = await this.cache.originalBasis(scope, ref, tx);
    if (live.snapshot !== basis.snapshot) throw Error("EMAIL_ORIGINAL_CHANGED");
  }
  private async readLocal(
    scope: EmailIntakeScope,
    ref: EmailIntakeOriginalRequest,
    basis: Basis,
  ) {
    const row = await this.record(scope, ref);
    if (!row) return null;
    // Malformed cache entries may be rebuilt from the server; valid-but-contradictory
    // manifests must never be used as a private file capability.
    let raw: unknown;
    try {
      raw = JSON.parse(row.manifest_json);
    } catch {
      return null;
    }
    if (!emailIntakeOriginalManifestSchema.safeParse(raw).success) return null;
    const manifest = await this.binding(raw, scope, basis);
    const result = await this.files.existing(manifest, scope.ownerId);
    await this.unchanged(scope, ref, basis);
    const live = await this.record(scope, ref);
    if (
      live?.manifest_json !== row.manifest_json ||
      live.local_uri !== row.local_uri
    )
      throw Error("EMAIL_ORIGINAL_CHANGED");
    return result ? proofSchema.parse(result) : null;
  }
  async local(raw: EmailIntakeOriginalRequest) {
    const ref = emailIntakeOriginalRequestSchema.parse(raw);
    const scope = this.cache.scope(ref.conversationId);
    const basis = await this.cache.originalBasis(scope, ref);
    return this.readLocal(scope, ref, basis);
  }
  recover(
    raw: EmailIntakeOriginalRequest,
    authorize?: (tx?: OutboxDatabase) => Promise<void>,
    signal?: AbortSignal,
  ) {
    const ref = emailIntakeOriginalRequestSchema.parse(raw);
    const scope = this.cache.scope(ref.conversationId);
    const key = [
      scope.storeId,
      scope.ownerId,
      ref.conversationId,
      ref.receiptId,
      ref.fileId,
    ].join(":");
    const prior = this.active.get(key);
    if (prior) return prior;
    const task = this.run(scope, ref, authorize, signal);
    this.active.set(key, task);
    void task
      .finally(() => {
        if (this.active.get(key) === task) this.active.delete(key);
      })
      .catch(() => undefined);
    return task;
  }
  private async run(
    scope: EmailIntakeScope,
    ref: EmailIntakeOriginalRequest,
    authorize?: (tx?: OutboxDatabase) => Promise<void>,
    signal?: AbortSignal,
  ) {
    const check = () => {
      this.cache.check(scope);
      if (signal?.aborted) throw Error("EMAIL_ORIGINAL_INTERRUPTED");
    };
    const allowed = async (tx?: OutboxDatabase) => {
      check();
      await authorize?.(tx);
      check();
    };
    await allowed();
    const basis = await this.cache.originalBasis(scope, ref);
    const existing = await this.readLocal(scope, ref, basis);
    await allowed();
    if (existing) return existing;
    const lease = emailIntakeOriginalDownloadSchema.parse(
      await this.api.download(scope.storeId, scope.ownerId, ref),
    );
    await allowed();
    const manifest = await this.binding(lease.manifest, scope, basis);
    await this.unchanged(scope, ref, basis);
    const proof = proofSchema.parse(
      await this.files.receive(lease, scope.ownerId, check, signal),
    );
    await allowed();
    await this.unchanged(scope, ref, basis);
    // A valid capability is not durable authorization. Recheck the live server
    // record after I/O before making its verified bytes available to intake.
    const live = await this.binding(
      await this.api.manifest(scope.storeId, scope.ownerId, ref),
      scope,
      basis,
    );
    if (JSON.stringify(live) !== JSON.stringify(manifest))
      throw Error("EMAIL_ORIGINAL_CHANGED");
    await allowed();
    await this.cache.db.withExclusiveTransactionAsync(async (tx) => {
      await allowed(tx);
      await this.unchanged(scope, ref, basis, tx);
      const previous = await this.record(scope, ref, tx);
      if (previous) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(previous.manifest_json);
        } catch {
          /* rebuild damaged cache */
        }
        if (
          emailIntakeOriginalManifestSchema.safeParse(parsed).success &&
          previous.manifest_json !== JSON.stringify(manifest)
        )
          throw Error("EMAIL_ORIGINAL_BINDING_INVALID");
      }
      await tx.runAsync(
        "INSERT INTO email_original_manifests(store_id,owner_id,conversation_id,receipt_id,file_id,manifest_json,local_uri,verified_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(store_id,owner_id,conversation_id,receipt_id,file_id) DO UPDATE SET manifest_json=excluded.manifest_json,local_uri=excluded.local_uri,verified_at=excluded.verified_at",
        scope.storeId,
        scope.ownerId,
        scope.conversationId,
        ref.receiptId,
        ref.fileId,
        JSON.stringify(manifest),
        proof.localUri,
        this.now().toISOString(),
      );
      await allowed(tx);
      await this.unchanged(scope, ref, basis, tx);
    });
    check();
    return proof;
  }
}
