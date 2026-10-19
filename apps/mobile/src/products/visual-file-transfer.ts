import { withVisualFiles } from "./visual-file-lock";
import {
  readVisualFileManifest,
  type VisualFileManifest,
} from "@fl-copilot/sync-contracts";
import type { VisualAsset } from "@fl-copilot/domain";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { VisualFileCache } from "./visual-file-cache";
import { VisualLibraryRepository } from "./visual-library-repository";
import type { VisualFileStorage } from "./visual-file-storage";
export interface VisualFileTransport {
  init(
    storeId: string,
    assetId: string,
  ): Promise<import("@fl-copilot/sync-contracts").InitVisualFileResponse>;
  complete(
    storeId: string,
    assetId: string,
    uploadId: string,
  ): Promise<VisualFileManifest>;
  manifest(storeId: string, assetId: string): Promise<VisualFileManifest>;
  download(
    storeId: string,
    manifest: VisualFileManifest,
    variant: "source" | "preview",
  ): Promise<Uint8Array>;
}
export interface VisualFileSession {
  storeId: string;
  userId: string;
  canWrite: boolean;
}
/** Binary transfer resumes from durable metadata/file proofs; it never creates a receipt job. */
export class VisualFileTransfer {
  private cache: VisualFileCache;
  private library: VisualLibraryRepository;
  private inFlight = new Map<string, Promise<VisualFileManifest>>();
  constructor(
    db: OutboxDatabase & AtomicMutationDatabase,
    private api: VisualFileTransport,
    private files: VisualFileStorage,
    private session: () => VisualFileSession | null,
  ) {
    this.cache = new VisualFileCache(db);
    this.library = new VisualLibraryRepository(db);
  }
  private context() {
    const value = this.session();
    if (!value) throw Error("VISUAL_ACCESS_INVALID");
    return { ...value };
  }
  private check(context: VisualFileSession) {
    const current = this.session();
    if (
      !current ||
      current.storeId !== context.storeId ||
      current.userId !== context.userId
    )
      throw Error("VISUAL_SCOPE_CHANGED");
  }
  private async approved(
    context: VisualFileSession,
    id: string,
    write = false,
  ) {
    this.check(context);
    if (write && !this.session()?.canWrite)
      throw Error("VISUAL_ACCESS_INVALID");
    const record = await this.library.get("visual_asset", context.storeId, id);
    this.check(context);
    if (
      !record ||
      record.entity.deletedAt ||
      record.entity.review.status !== "APPROVED" ||
      record.syncState === "CONFLICT" ||
      record.syncState === "ERROR" ||
      record.remote?.deletedAt ||
      record.remote?.review.status === "REVOKED" ||
      record.remote?.review.status === "REJECTED"
    )
      throw Error("VISUAL_ASSET_UNAVAILABLE");
    return record;
  }
  private single(key: string, task: () => Promise<VisualFileManifest>) {
    const current = this.inFlight.get(key);
    if (current) return current;
    const promise = task();
    this.inFlight.set(key, promise);
    void promise
      .finally(() => {
        if (this.inFlight.get(key) === promise) this.inFlight.delete(key);
      })
      .catch(() => undefined);
    return promise;
  }
  send(assetId: string) {
    const context = this.context();
    return this.single(
      `send:${context.storeId}:${context.userId}:${assetId}`,
      async () => {
        const record = await this.approved(context, assetId, true),
          asset = record.entity;
        if (
          record.dirty ||
          record.remoteVersion === null ||
          record.remoteVersion < asset.version
        )
          throw Error("VISUAL_METADATA_PENDING");
        const source = await this.cache.get(context.storeId, asset, "SOURCE");
        if (!source) throw Error("VISUAL_SOURCE_FILE_MISSING");
        await this.files.read(context.storeId, "SOURCE", asset);
        await this.approved(context, assetId, true);
        const init = await this.api.init(context.storeId, assetId);
        await this.approved(context, assetId, true);
        let manifest: VisualFileManifest;
        if (init.state === "READY")
          manifest = readVisualFileManifest(init.manifest, asset);
        else {
          if (!init.uploadId || !init.uploadUrl)
            throw Error("VISUAL_UPLOAD_INVALID");
          await this.files.upload(
            context.storeId,
            asset,
            init.uploadUrl,
            init.headers,
          );
          await this.approved(context, assetId, true);
          manifest = readVisualFileManifest(
            await this.api.complete(context.storeId, assetId, init.uploadId),
            asset,
          );
        }
        await this.approved(context, assetId, true);
        await this.cache.markUploaded(context.storeId, asset, manifest);
        return manifest;
      },
    );
  }
  fetchPreview(assetId: string) {
    const context = this.context();
    return this.single(
      `preview:${context.storeId}:${context.userId}:${assetId}`,
      async () => {
        const { entity: asset } = await this.approved(context, assetId);
        const manifest = readVisualFileManifest(
          await this.api.manifest(context.storeId, assetId),
          asset,
        );
        await this.approved(context, assetId);
        try {
          const cached = await this.cache.get(
            context.storeId,
            asset,
            "PREVIEW",
          );
          if (
            cached &&
            (await this.files.uri(context.storeId, "PREVIEW", manifest.preview))
          )
            return manifest;
        } catch {
          this.check(
            context,
          ); /* A disposable preview can be rebuilt from the freshly bound server proof. */
        }
        const bytes = await this.api.download(
          context.storeId,
          manifest,
          "preview",
        );
        await this.approved(context, assetId);
        await withVisualFiles(context.storeId, async () => {
          await this.approved(context, assetId);
          const proof = await this.files.write(
            context.storeId,
            "PREVIEW",
            manifest.preview,
            bytes,
          );
          await this.approved(context, assetId);
          await this.cache.remember(
            context.storeId,
            assetId,
            "PREVIEW",
            proof,
            manifest,
          );
        });
        return manifest;
      },
    );
  }
  /** Existing content renders locally; fetching is a separate asynchronous operation. */
  async localUri(asset: VisualAsset) {
    const context = this.context();
    await this.approved(context, asset.id);
    for (const variant of ["PREVIEW", "SOURCE"] as const) {
      const cached = await this.cache.get(context.storeId, asset, variant);
      if (!cached) continue;
      const descriptor =
        variant === "SOURCE" ? asset : cached.manifest!.preview;
      const uri = await this.files.uri(context.storeId, variant, descriptor);
      this.check(context);
      if (uri) {
        await this.cache.touch(context.storeId, asset.id, variant);
        return uri;
      }
    }
    return null;
  }
}
