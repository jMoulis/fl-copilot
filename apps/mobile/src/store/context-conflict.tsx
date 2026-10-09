import { useAuth } from "@/auth/auth-provider";
import { useEffect, useMemo, useState } from "react";
import { Text } from "react-native";
import { router } from "expo-router";
import { randomUUID } from "expo-crypto";
import { storeContextSettingsSchema } from "@fl-copilot/sync-contracts";
import type { SyncConflict } from "@/sync/conflict-repository";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import { SectionCard, SecondaryButton, InlineAlert } from "@/components/ui";
import {
  StoreContextRepository,
  type LocalStoreContext,
} from "./context-repository";
import { storeContextSummary, storeContextError } from "./context-presentation";
export function StoreContextConflict({ conflict }: { conflict: SyncConflict }) {
  const { session } = useAuth();
  const allowedStore = session?.stores[0]?.storeId === conflict.storeId;
  const { sqlite, deviceId } = useLocalDatabase(),
    { syncNow } = useSync();
  const repository = useMemo(
    () => new StoreContextRepository(sqlite),
    [sqlite],
  );
  const [local, setLocal] = useState<LocalStoreContext | null>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const parsedLocal = storeContextSettingsSchema.safeParse(
    conflict.localPayload,
  );
  const settingsStoreId = parsedLocal.success
    ? parsedLocal.data.storeId
    : undefined;
  useEffect(() => {
    if (!allowedStore || !settingsStoreId) return;
    let active = true;
    void repository
      .get(conflict.storeId)
      .then((row) => {
        if (active) setLocal(row);
      })
      .catch(() => {
        if (active) setError("Les réglages locaux ne peut pas être lu.");
      });

    return () => {
      active = false;
    };
  }, [
    repository,
    conflict.storeId,
    conflict.entityId,
    sqlite,
    allowedStore,
    settingsStoreId,
  ]);
  const remote = storeContextSettingsSchema.safeParse(conflict.remotePayload);
  async function resolve(useLocal: boolean) {
    if (!allowedStore) return;
    setBusy(true);
    setError(undefined);
    try {
      await repository.resolve(conflict.id, useLocal, {
        commandId: randomUUID(),
        deviceId,
      });
      void syncNow(conflict.storeId).catch(() => undefined);
      router.back();
    } catch (reason) {
      setError(
        storeContextError(reason instanceof Error ? reason.message : undefined),
      );
    } finally {
      setBusy(false);
    }
  }
  if (!allowedStore)
    return (
      <InlineAlert
        title="Magasin différent"
        message="Ouvrez ce conflit depuis le magasin auquel ce réglage appartient."
      />
    );
  return (
    <>
      <SectionCard title="Mes réglages locaux">
        <Text className="text-base text-ink">
          {local
            ? storeContextSummary(local.entity)
            : "Lecture des réglages locaux…"}
        </Text>
      </SectionCard>
      <SectionCard title="Réglages synchronisés">
        <Text className="text-base text-ink">
          {remote.success
            ? storeContextSummary(remote.data)
            : "Aucun réglage distant disponible."}
        </Text>
      </SectionCard>
      <Text className="text-sm text-muted">
        Les deux versions et les modifications locales restent dans
        l’historique. Aucune n’est retenue automatiquement.
      </Text>
      {error ? (
        <InlineAlert title="Résolution impossible" message={error} />
      ) : null}
      <SecondaryButton
        label="Conserver mes réglages locaux"
        disabled={busy || !local}
        onPress={() => void resolve(true)}
      />
      {remote.success ? (
        <SecondaryButton
          label="Adopter les réglages synchronisés"
          disabled={busy || !local}
          onPress={() => void resolve(false)}
        />
      ) : null}
    </>
  );
}
