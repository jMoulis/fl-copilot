import { z } from "zod";
import {
  layoutIllustrationManifestSchema,
  serializeLayoutIllustrationMetadata,
  type LayoutIllustrationManifest,
  type LayoutIllustrationFileVariant,
} from "@fl-copilot/sync-contracts";
import { sourceOriginalHash } from "../documents/source-original-hash";
import type { OutboxDatabase } from "../sync/outbox-repository";

export const LAYOUT_ILLUSTRATION_CACHE_BYTES = 64 * 1024 * 1024;
export type IllustrationCacheScope = { storeId: string; userId: string };
export interface LayoutIllustrationCacheFiles {
  usage(scope: IllustrationCacheScope): Promise<number>;
  remove(
    manifest: LayoutIllustrationManifest,
    variant: LayoutIllustrationFileVariant,
    check: () => void,
  ): Promise<void>;
}
// One gate shared by all transfer instances for this account/store. Never acquire it
// inside a SQLite transaction. Native file operations then use the existing file gate.
const tails = new Map<string, Promise<void>>();
export async function withIllustrationCache<T>(
  scope: IllustrationCacheScope,
  task: () => Promise<T>,
): Promise<T> {
  z.uuid().parse(scope.storeId);
  z.uuid().parse(scope.userId);
  const key = `${scope.storeId}/${scope.userId}`,
    run = (tails.get(key) ?? Promise.resolve()).then(task),
    tail = run.then(
      () => undefined,
      () => undefined,
    );
  tails.set(key, tail);
  try {
    return await run;
  } finally {
    if (tails.get(key) === tail) tails.delete(key);
  }
}
export function checkedIllustrationManifest(raw: unknown) {
  const m = layoutIllustrationManifestSchema.parse(raw),
    { manifestHash, ...metadata } = m;
  if (
    sourceOriginalHash(serializeLayoutIllustrationMetadata(metadata)) !==
    manifestHash
  )
    throw Error("LAYOUT_ILLUSTRATION_MANIFEST_INVALID");
  return m;
}
/** Local derived downloads only: this metadata never grants provider authority.
 * Keep metadata after eviction so absent copies can be restored without generation.
 * Call under withIllustrationCache, before opening a SQLite transaction. */
export async function reserveIllustrationCache(
  db: OutboxDatabase,
  files: LayoutIllustrationCacheFiles,
  incoming: LayoutIllustrationManifest,
  additionalBytes: number,
  check: () => void,
  budgetBytes = LAYOUT_ILLUSTRATION_CACHE_BYTES,
) {
  z.number().int().nonnegative().parse(additionalBytes);
  z.number().int().nonnegative().parse(budgetBytes);
  const scope = {
    storeId: incoming.preparation.storeId,
    userId: incoming.preparation.ownerId,
  };
  const used = async () => {
    check();
    const bytes = await files.usage(scope);
    check();
    return z.number().int().nonnegative().parse(bytes);
  };
  if (additionalBytes > budgetBytes)
    throw Error("LAYOUT_ILLUSTRATION_CACHE_FULL");
  if ((await used()) + additionalBytes <= budgetBytes) return;
  const rows = await db.getAllAsync<{
    id: string;
    preparation_id: string;
    manifest_json: string;
    offline_required: number;
  }>(
    "SELECT id,preparation_id,manifest_json,offline_required FROM copilot_layout_illustration_files WHERE store_id=? AND owner_id=? ORDER BY last_accessed_at,id",
    scope.storeId,
    scope.userId,
  );
  check();
  for (const row of rows) {
    if (
      row.id === incoming.id ||
      row.preparation_id === incoming.preparation.id ||
      row.offline_required
    )
      continue;
    let m: LayoutIllustrationManifest;
    try {
      m = checkedIllustrationManifest(JSON.parse(row.manifest_json));
      if (
        m.id !== row.id ||
        m.preparation.id !== row.preparation_id ||
        m.preparation.storeId !== scope.storeId ||
        m.preparation.ownerId !== scope.userId
      )
        continue;
    } catch {
      continue;
    }
    // Remove only exact paths described by a remotely received manifest. Unknown
    // files are counted but never deleted. Pin/touch operations share this gate.
    for (const variant of ["original", "data", "image", "source"] as const) {
      check();
      await files.remove(m, variant, check);
      if ((await used()) + additionalBytes <= budgetBytes) return;
    }
  }
  throw Error("LAYOUT_ILLUSTRATION_CACHE_FULL");
}
