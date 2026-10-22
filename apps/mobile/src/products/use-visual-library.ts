import { useCallback, useEffect, useMemo, useRef } from "react";
import { useIsFocused } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { useAuth } from "../auth/auth-provider";
import { useLocalDatabase } from "../providers/database-provider";
import { useSync } from "../sync/sync-provider";
import { subscribeOutboxChanges } from "../sync/outbox-repository";
import {
  loadVisualLibraryState,
  shareVisualLibraryState,
  type VisualLibraryState,
} from "./visual-library-state";
import { nativeVisualFileStorage } from "./visual-file-storage";
import { VisualFileCache } from "./visual-file-cache";
import { VisualLibraryRepository } from "./visual-library-repository";
import type { VisualActionContext } from "./visual-library-actions";
import type { VisualAsset } from "@fl-copilot/domain";
export function useVisualLibrary() {
  const focused = useIsFocused();
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
    () => ["visual-library", 2, deviceId, storeId, ownerId],
    [deviceId, storeId, ownerId],
  );
  const query = useQuery({
    queryKey: key,
    enabled: focused && !!storeId && !!ownerId,
    queryFn: () => loadVisualLibraryState(sqlite, storeId!, ownerId!),
    staleTime: Infinity,
    structuralSharing: (previous, next) =>
      shareVisualLibraryState(
        previous as VisualLibraryState | undefined,
        next as VisualLibraryState,
      ),
  });
  const refresh = useCallback(async () => {
    await client.invalidateQueries(
      { queryKey: key, exact: true },
      { cancelRefetch: false },
    );
  }, [client, key]);
  useEffect(() => {
    if (!focused) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeOutboxChanges(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void refresh().catch(() => undefined);
      }, 50);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [refresh, focused]);
  useEffect(() => {
    // A retained hidden screen misses mutations intentionally. Revalidate the
    // shared local cache on focus; never replace its existing data with empty state.
    if (focused && storeId && ownerId) void refresh().catch(() => undefined);
  }, [focused, storeId, ownerId, sync.lastSyncedAt, refresh]);
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
    [query.data?.assets, query.data?.files, query.data?.jobs, storeId, ownerId],
  );
  const queuePreview = sync.visuals?.requestPreview;
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
        // Return the placeholder now; the durable worker fetches only the small
        // preview after metadata acknowledgement, including on another device.
        if (
          !record.dirty &&
          record.remoteVersion !== null &&
          record.remoteVersion >= record.entity.version &&
          queuePreview
        ) {
          checked();
          void queuePreview(asset.id).catch(() => undefined);
        }
        return null;
      })();
      reads.set(key, task);
      return task;
    },
    [checked, reads, sqlite, storeId, queuePreview],
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
  const setOfflineRequired = useCallback(
    async (assetId: string, required: boolean) => {
      checked();
      const cache = new VisualFileCache(sqlite);
      const canChange = () =>
        current.current.storeId === storeId &&
        current.current.ownerId === ownerId;
      await cache.setOfflineRequired(storeId!, assetId, required, canChange);
      if (!required)
        await cache.clean(
          storeId!,
          (file) => nativeVisualFileStorage.removeCached(storeId!, file),
          canChange,
        );
      await refresh().catch(() => undefined);
      // The local preference is saved even when a preview cannot yet be queued.
      if (required && sync.visuals)
        await sync.visuals.requestPreview(assetId).catch(() => undefined);
    },
    [checked, sqlite, storeId, ownerId, refresh, sync.visuals],
  );
  return {
    state: query.data ?? null,
    loading: query.isLoading,
    error: query.error,
    readUri,
    readDetailUri,
    setOfflineRequired,
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
