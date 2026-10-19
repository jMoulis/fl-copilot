import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { useAuth } from "../auth/auth-provider";
import { useLocalDatabase } from "../providers/database-provider";
import { useSync } from "../sync/sync-provider";
import { subscribeOutboxChanges } from "../sync/outbox-repository";
import { loadVisualLibraryState } from "./visual-library-state";
import { nativeVisualFileStorage } from "./visual-file-storage";
import { VisualFileCache } from "./visual-file-cache";
import { VisualLibraryRepository } from "./visual-library-repository";
import type { VisualActionContext } from "./visual-library-actions";
import type { VisualAsset } from "@fl-copilot/domain";
export function useVisualLibrary() {
  const { sqlite, deviceId } = useLocalDatabase(),
    { session } = useAuth(),
    sync = useSync(),
    client = useQueryClient();
  const storeId = session?.stores[0]?.storeId,
    ownerId = session?.user.id,
    manager = session?.stores[0]?.role === "MANAGER";
  const current = useRef({ storeId, ownerId, manager });
  current.current = { storeId, ownerId, manager };
  const key = useMemo(
    () => ["visual-library", deviceId, storeId, ownerId],
    [deviceId, storeId, ownerId],
  );
  const query = useQuery({
    queryKey: key,
    enabled: !!storeId && !!ownerId,
    queryFn: () => loadVisualLibraryState(sqlite, storeId!, ownerId!),
    staleTime: Infinity,
  });
  const refresh = useCallback(async () => {
    await client.invalidateQueries({ queryKey: key, exact: true });
  }, [client, key]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeOutboxChanges(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void refresh();
      }, 50);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [refresh]);
  useEffect(() => {
    if (sync.lastSyncedAt) void refresh();
  }, [sync.lastSyncedAt, refresh]);
  const checked = useCallback(() => {
    if (
      !storeId ||
      !ownerId ||
      current.current.storeId !== storeId ||
      current.current.ownerId !== ownerId
    )
      throw Error("VISUAL_SCOPE_CHANGED");
  }, [storeId, ownerId]);
  const context = useMemo<VisualActionContext | null>(
    () =>
      storeId && ownerId
        ? {
            storeId,
            actorId: ownerId,
            deviceId,
            id: randomUUID,
            now: () => new Date().toISOString(),
            canWrite: () =>
              current.current.storeId === storeId &&
              current.current.ownerId === ownerId &&
              current.current.manager,
          }
        : null,
    [storeId, ownerId, deviceId],
  );
  const reads = useMemo(
    () => new Map<string, Promise<string | null>>(),
    [query.dataUpdatedAt, storeId, ownerId],
  );
  const readImageUri = useCallback(
    (asset: VisualAsset, original = false) => {
      checked();
      const key = `${asset.id}:${asset.version}:${original}`,
        prior = reads.get(key);
      if (prior) return prior;
      const task = (async () => {
        const record = await new VisualLibraryRepository(sqlite).get(
          "visual_asset",
          storeId!,
          asset.id,
        );
        checked();
        if (
          asset.storeId !== storeId ||
          !record ||
          record.entity.deletedAt ||
          record.entity.review.status !== "APPROVED" ||
          record.remote?.deletedAt ||
          ["REVOKED", "REJECTED"].includes(
            record.remote?.review.status ?? "",
          ) ||
          ["ERROR", "CONFLICT"].includes(record.syncState)
        )
          return null;
        const cache = new VisualFileCache(sqlite);
        for (const variant of original
          ? (["PREVIEW", "SOURCE"] as const)
          : (["PREVIEW"] as const)) {
          try {
            const file = await cache.get(storeId!, asset, variant);
            if (!file) continue;
            const descriptor =
              variant === "SOURCE" ? asset : file.manifest!.preview;
            const uri = await nativeVisualFileStorage.uri(
              storeId!,
              variant,
              descriptor,
            );
            checked();
            if (uri) {
              await cache.touch(storeId!, asset.id, variant);
              return uri;
            }
          } catch (error) {
            checked();
            if (
              error instanceof Error &&
              error.message === "VISUAL_SCOPE_CHANGED"
            )
              throw error;
          }
        }
        return null;
      })();
      reads.set(key, task);
      return task;
    },
    [checked, reads, sqlite, storeId],
  );
  const readUri = useCallback(
    (asset: VisualAsset) => readImageUri(asset, false),
    [readImageUri],
  );
  const readDetailUri = useCallback(
    (asset: VisualAsset) => readImageUri(asset, true),
    [readImageUri],
  );
  const requestPreview = useCallback(
    async (assetId: string) => {
      checked();
      if (!sync.visuals) throw Error("VISUAL_ACCESS_INVALID");
      await sync.visuals.requestPreview(assetId);
      await refresh();
    },
    [checked, sync.visuals, refresh],
  );
  const retry = useCallback(
    async (assetId: string) => {
      checked();
      if (!sync.visuals) throw Error("VISUAL_ACCESS_INVALID");
      await sync.visuals.retry(assetId);
      await refresh();
    },
    [checked, sync.visuals, refresh],
  );
  return {
    state: query.data ?? null,
    loading: query.isLoading,
    error: query.error,
    readUri,
    readDetailUri,
    synchronize: sync.syncNow,
    refresh,
    requestPreview,
    retry,
    context,
    sqlite,
    canWrite: !!context?.canWrite(),
  };
}
export type VisualLibraryController = ReturnType<typeof useVisualLibrary>;
