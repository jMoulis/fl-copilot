import { useAuth } from "@/auth/auth-provider";
import { useEffect, useMemo, useState } from "react";
import { Text } from "react-native";
import { router } from "expo-router";
import {
  randomUUID,
  digestStringAsync,
  CryptoDigestAlgorithm,
} from "expo-crypto";
import { productSubstitutionSchema } from "@fl-copilot/sync-contracts";
import type { SyncConflict } from "@/sync/conflict-repository";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import { SectionCard, SecondaryButton, InlineAlert } from "@/components/ui";
import {
  ProductSubstitutionRepository,
  type LocalProductSubstitution,
} from "./substitution-repository";
import {
  substitutionSummary,
  substitutionError,
} from "./substitution-presentation";
export function ProductSubstitutionConflict({
  conflict,
}: {
  conflict: SyncConflict;
}) {
  const { session } = useAuth();
  const allowedStore = session?.stores[0]?.storeId === conflict.storeId;
  const { sqlite, deviceId } = useLocalDatabase(),
    { syncNow } = useSync();
  const repository = useMemo(
    () =>
      new ProductSubstitutionRepository(sqlite, (s) =>
        digestStringAsync(CryptoDigestAlgorithm.SHA256, s),
      ),
    [sqlite],
  );
  const [local, setLocal] = useState<LocalProductSubstitution | null>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const parsedLocal = productSubstitutionSchema.safeParse(
    conflict.localPayload,
  );
  const settingsStoreId = parsedLocal.success
    ? parsedLocal.data.storeId
    : undefined;
  useEffect(() => {
    if (!allowedStore || !settingsStoreId) return;
    let active = true;
    void repository
      .get(conflict.storeId, conflict.entityId)
      .then((row) => {
        if (active) setLocal(row);
      })
      .catch(() => {
        if (active) setError("La relation locale ne peut pas être lue.");
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
  const remote = productSubstitutionSchema.safeParse(conflict.remotePayload);
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
        substitutionError(reason instanceof Error ? reason.message : undefined),
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
      <SectionCard title="Ma version locale">
        <Text className="text-base text-ink">
          {local
            ? substitutionSummary(local.entity)
            : "Lecture de la version locale…"}
        </Text>
      </SectionCard>
      <SectionCard title="Version synchronisée">
        <Text className="text-base text-ink">
          {remote.success
            ? substitutionSummary(remote.data)
            : "Aucune version distante disponible."}
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
        label="Conserver ma version locale"
        disabled={busy || !local}
        onPress={() => void resolve(true)}
      />
      {remote.success ? (
        <SecondaryButton
          label="Adopter la version synchronisée"
          disabled={busy || !local}
          onPress={() => void resolve(false)}
        />
      ) : null}
    </>
  );
}
