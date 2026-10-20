import { withVisualFiles } from "./visual-file-lock";
import { joinedMutationDatabase } from "../sync/atomic-local-mutation";
import { z } from "zod";
import { visualAssetSchema, type VisualAsset } from "@fl-copilot/domain";
import {
  readVisualFileManifest,
  type VisualFileManifest,
} from "@fl-copilot/sync-contracts";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import {
  notifyOutboxChanged,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import { VisualLibraryRepository } from "./visual-library-repository";
export type VisualFileVariant = "SOURCE" | "PREVIEW";
export function visualFilePath(
  storeId: string,
  variant: VisualFileVariant,
  mime: VisualAsset["mimeType"],
  hash: string,
) {
  z.uuid().parse(storeId);
  visualAssetSchema.shape.contentHash.parse(hash);
  if (variant !== "SOURCE" && variant !== "PREVIEW")
    throw Error("VISUAL_FILE_LOCATION_INVALID");
  const ext = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
  }[mime];
  if (!ext || (variant === "PREVIEW" && mime !== "image/jpeg"))
    throw Error("VISUAL_FILE_LOCATION_INVALID");
  return `visual-library/${storeId}/${variant.toLowerCase()}-${hash.slice(7)}.${ext}`;
}
type FileRow = {
  asset_id: string;
  store_id: string;
  variant: VisualFileVariant;
  relative_path: string;
  verified_hash: string;
  size_bytes: number;
  last_accessed_at: string;
  pinned: number;
  uploaded: number;
  manifest_json: string | null;
};
function verifiedRow(row: FileRow, asset: VisualAsset, storeId: string) {
  if (
    row.store_id !== storeId ||
    asset.storeId !== storeId ||
    row.asset_id !== asset.id
  )
    throw Error("VISUAL_SCOPE_INVALID");
  const variant = row.variant;
  const manifest = row.manifest_json
    ? readVisualFileManifest(JSON.parse(row.manifest_json), asset)
    : null;
  const expected = variant === "SOURCE" ? asset : manifest?.preview;
  if (
    !expected ||
    row.relative_path !==
      visualFilePath(
        storeId,
        variant,
        expected.mimeType,
        expected.contentHash,
      ) ||
    row.verified_hash !== expected.contentHash ||
    row.size_bytes !== expected.sizeBytes
  )
    throw Error("VISUAL_FILE_INVALID");
  return {
    relativePath: row.relative_path,
    contentHash: row.verified_hash,
    sizeBytes: row.size_bytes,
    pinned: !!row.pinned,
    uploaded: !!row.uploaded,
    manifest,
  };
}
function recoverable(
  row: FileRow & { payload_json: string; remote_payload_json: string | null },
  storeId: string,
) {
  try {
    const asset = visualAssetSchema.parse(JSON.parse(row.payload_json));
    const remote = row.remote_payload_json
      ? visualAssetSchema.parse(JSON.parse(row.remote_payload_json))
      : null;
    const proof = verifiedRow(row, asset, storeId);
    if (!remote || !proof.manifest) return false;
    readVisualFileManifest(proof.manifest, remote);
    return (
      !asset.deletedAt &&
      asset.review.status === "APPROVED" &&
      !remote.deletedAt &&
      remote.review.status === "APPROVED" &&
      proof.uploaded
    );
  } catch {
    return false;
  }
}
export type VerifiedVisualFile = {
  relativePath: string;
  contentHash: string;
  sizeBytes: number;
};
export class VisualFileCache {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private now: () => string = () => new Date().toISOString(),
  ) {}
  async remember(
    storeId: string,
    assetId: string,
    variant: VisualFileVariant,
    file: VerifiedVisualFile,
    manifest?: VisualFileManifest,
  ) {
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const record = await tx.getFirstAsync<{ payload_json: string }>(
        "SELECT payload_json FROM visual_assets WHERE id=? AND store_id=?",
        assetId,
        storeId,
      );
      if (!record) throw Error("VISUAL_ASSET_UNAVAILABLE");
      const asset = visualAssetSchema.parse(JSON.parse(record.payload_json));
      if (asset.id !== assetId || asset.storeId !== storeId)
        throw Error("VISUAL_SCOPE_INVALID");
      const verified = manifest
        ? readVisualFileManifest(manifest, asset)
        : null;
      if (variant === "PREVIEW" && !verified)
        throw Error("VISUAL_FILE_MANIFEST_REQUIRED");
      const expected = variant === "SOURCE" ? asset : verified!.preview;
      if (
        file.contentHash !== expected.contentHash ||
        file.sizeBytes !== expected.sizeBytes ||
        file.relativePath !==
          visualFilePath(
            storeId,
            variant,
            expected.mimeType,
            expected.contentHash,
          )
      )
        throw Error("VISUAL_FILE_INVALID");
      await tx.runAsync(
        "INSERT INTO visual_asset_files(asset_id,store_id,variant,relative_path,verified_hash,size_bytes,last_accessed_at,pinned,uploaded,manifest_json) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(asset_id,variant) DO UPDATE SET relative_path=excluded.relative_path,verified_hash=excluded.verified_hash,size_bytes=excluded.size_bytes,last_accessed_at=excluded.last_accessed_at,manifest_json=COALESCE(excluded.manifest_json,visual_asset_files.manifest_json),uploaded=MAX(visual_asset_files.uploaded,excluded.uploaded)",
        assetId,
        storeId,
        variant,
        file.relativePath,
        file.contentHash,
        file.sizeBytes,
        this.now(),
        variant === "SOURCE" ? 1 : 0,
        variant === "PREVIEW" || !!verified ? 1 : 0,
        verified ? JSON.stringify(verified) : null,
      );
      // Once a verified preview exists, an uploaded source is recoverable remotely.
      if (variant === "PREVIEW")
        await tx.runAsync(
          "UPDATE visual_asset_files SET pinned=0 WHERE asset_id=? AND store_id=? AND variant='SOURCE' AND uploaded=1",
          assetId,
          storeId,
        );
    });
  }
  async get(storeId: string, asset: VisualAsset, variant: VisualFileVariant) {
    if (asset.storeId !== storeId) throw Error("VISUAL_SCOPE_INVALID");
    const row = await this.db.getFirstAsync<FileRow>(
      "SELECT * FROM visual_asset_files WHERE asset_id=? AND store_id=? AND variant=?",
      asset.id,
      storeId,
      variant,
    );
    if (!row) return null;
    return verifiedRow(row, asset, storeId);
  }
  async touch(storeId: string, assetId: string, variant: VisualFileVariant) {
    await this.db.runAsync(
      "UPDATE visual_asset_files SET last_accessed_at=? WHERE store_id=? AND asset_id=? AND variant=?",
      this.now(),
      storeId,
      assetId,
      variant,
    );
  }
  /** User pinning may never make an unconfirmed original eligible for cleanup. */
  async setPinned(
    storeId: string,
    assetId: string,
    variant: VisualFileVariant,
    pinned: boolean,
  ) {
    await this.db.runAsync(
      "UPDATE visual_asset_files SET pinned=? WHERE store_id=? AND asset_id=? AND variant=?",
      pinned ? 1 : 0,
      storeId,
      assetId,
      variant,
    );
  }
  async markUploaded(
    storeId: string,
    asset: VisualAsset,
    manifest: VisualFileManifest,
  ) {
    const source = await this.get(storeId, asset, "SOURCE");
    if (!source) throw Error("VISUAL_SOURCE_FILE_MISSING");
    await this.remember(storeId, asset.id, "SOURCE", source, manifest);
  }
  async evictable(storeId: string, budgetBytes = 64 * 1024 * 1024) {
    z.number().int().nonnegative().parse(budgetBytes);
    const rows = await this.db.getAllAsync<
      FileRow & {
        dirty: number;
        offline_required: number;
        payload_json: string;
        remote_payload_json: string | null;
      }
    >(
      "SELECT f.*,a.dirty,a.offline_required,a.payload_json,a.remote_payload_json FROM visual_asset_files f JOIN visual_assets a ON a.id=f.asset_id AND a.store_id=f.store_id WHERE f.store_id=? ORDER BY f.last_accessed_at,f.asset_id,f.variant",
      storeId,
    );
    const byPath = new Map<string, typeof rows>();
    for (const row of rows)
      byPath.set(row.relative_path, [
        ...(byPath.get(row.relative_path) ?? []),
        row,
      ]);
    let total = Array.from(byPath.values()).reduce(
      (n, group) => n + Math.max(...group.map((r) => r.size_bytes)),
      0,
    );
    const usedBytes = total;
    const candidates: Array<{
      relativePath: string;
      lastAccessedAt: string;
      contentHash: string;
      sizeBytes: number;
    }> = [];
    for (const [relativePath, group] of [...byPath].sort(
      (a, b) =>
        Number(a[1].some((r) => r.variant === "PREVIEW")) -
          Number(b[1].some((r) => r.variant === "PREVIEW")) ||
        a[1]
          .reduce(
            (m, r) => (r.last_accessed_at > m ? r.last_accessed_at : m),
            "",
          )
          .localeCompare(
            b[1].reduce(
              (m, r) => (r.last_accessed_at > m ? r.last_accessed_at : m),
              "",
            ),
          ),
    )) {
      if (total <= budgetBytes) break;
      if (
        group.some(
          (r) =>
            r.pinned ||
            r.offline_required ||
            !r.uploaded ||
            r.dirty ||
            !recoverable(r, storeId),
        )
      )
        continue;
      const first = group[0]!;
      candidates.push({
        relativePath,
        lastAccessedAt: group.reduce(
          (m, r) => (r.last_accessed_at > m ? r.last_accessed_at : m),
          "",
        ),
        contentHash: first.verified_hash,
        sizeBytes: first.size_bytes,
      });
      total -= first.size_bytes;
    }
    return {
      candidates,
      usedBytes,
      retainedBytes: total,
      overBudget: total > budgetBytes,
    };
  }
  async setOfflineRequired(
    storeId: string,
    assetId: string,
    required: boolean,
    canChange: () => boolean,
  ) {
    await withVisualFiles(storeId, () =>
      this.db.withExclusiveTransactionAsync(async (tx) => {
        if (!canChange()) throw Error("VISUAL_SCOPE_CHANGED");
        const asset = await new VisualLibraryRepository(
          joinedMutationDatabase(tx),
        ).get("visual_asset", storeId, assetId);
        if (!asset || asset.entity.deletedAt)
          throw Error("VISUAL_ASSET_UNAVAILABLE");
        await tx.runAsync(
          "UPDATE visual_assets SET offline_required=? WHERE store_id=? AND id=?",
          required ? 1 : 0,
          storeId,
          assetId,
        );
      }),
    );
  }
  async evictRecoverable(
    storeId: string,
    candidate: {
      relativePath: string;
      lastAccessedAt: string;
      contentHash: string;
      sizeBytes: number;
    },
    remove: (file: {
      relativePath: string;
      contentHash: string;
      sizeBytes: number;
    }) => Promise<void>,
    canClean: () => boolean,
  ) {
    let removed = false;
    await withVisualFiles(storeId, () =>
      this.db.withExclusiveTransactionAsync(async (tx) => {
        if (!canClean()) throw Error("VISUAL_SCOPE_CHANGED");
        const rows = await tx.getAllAsync<
          FileRow & {
            dirty: number;
            offline_required: number;
            payload_json: string;
            remote_payload_json: string | null;
          }
        >(
          "SELECT f.*,a.dirty,a.offline_required,a.payload_json,a.remote_payload_json FROM visual_asset_files f JOIN visual_assets a ON a.id=f.asset_id AND a.store_id=f.store_id WHERE f.store_id=? AND f.relative_path=?",
          storeId,
          candidate.relativePath,
        );
        if (
          !rows.length ||
          rows.some(
            (r) =>
              r.pinned ||
              r.offline_required ||
              !r.uploaded ||
              r.dirty ||
              r.last_accessed_at > candidate.lastAccessedAt ||
              r.verified_hash !== candidate.contentHash ||
              r.size_bytes !== candidate.sizeBytes ||
              !recoverable(r, storeId),
          )
        )
          return;
        if (!canClean()) throw Error("VISUAL_SCOPE_CHANGED");
        await remove(candidate);
        await tx.runAsync(
          "DELETE FROM visual_asset_files WHERE store_id=? AND relative_path=?",
          storeId,
          candidate.relativePath,
        );
        removed = true;
      }),
    );
    return removed;
  }
  async clean(
    storeId: string,
    remove: (file: {
      relativePath: string;
      contentHash: string;
      sizeBytes: number;
    }) => Promise<void>,
    canClean: () => boolean,
    budgetBytes = 64 * 1024 * 1024,
  ) {
    const plan = await this.evictable(storeId, budgetBytes);
    let removed = 0,
      failed = 0;
    for (const candidate of plan.candidates) {
      if (!canClean()) break;
      try {
        if (await this.evictRecoverable(storeId, candidate, remove, canClean))
          removed++;
      } catch {
        failed++;
      }
    }
    if (removed) notifyOutboxChanged();
    const final = await this.evictable(storeId, budgetBytes);
    return {
      removed,
      failed,
      retainedBytes: final.usedBytes,
      overBudget: final.usedBytes > budgetBytes,
    };
  }
  async resolved(product: Parameters<VisualLibraryRepository["resolve"]>[0]) {
    const resolved = await new VisualLibraryRepository(this.db).resolve(
      product,
    );
    if (resolved.kind !== "ASSET") return { resolved, file: null };
    return {
      resolved,
      file:
        (await this.get(product.storeId, resolved.asset, "PREVIEW")) ??
        (await this.get(product.storeId, resolved.asset, "SOURCE")),
    };
  }
}
