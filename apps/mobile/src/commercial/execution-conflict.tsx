import { useAuth } from "@/auth/auth-provider";
import { useEffect, useMemo, useState } from "react";
import { Text } from "react-native";
import { router } from "expo-router";
import {
  digestStringAsync,
  CryptoDigestAlgorithm,
  randomUUID,
} from "expo-crypto";
import { commercialExecutionTaskSchema } from "@fl-copilot/sync-contracts";
import type { SyncConflict } from "@/sync/conflict-repository";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import { SectionCard, SecondaryButton, InlineAlert } from "@/components/ui";
import {
  CommercialExecutionRepository,
  type LocalCommercialExecution,
} from "./execution-repository";
import {
  commercialExecutionSummary,
  commercialExecutionError,
} from "./execution-presentation";
export function CommercialExecutionConflict({
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
      new CommercialExecutionRepository(sqlite, (text) =>
        digestStringAsync(CryptoDigestAlgorithm.SHA256, text),
      ),
    [sqlite],
  );
  const [local, setLocal] = useState<LocalCommercialExecution | null>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const parsedLocal = commercialExecutionTaskSchema.safeParse(
    conflict.localPayload,
  );
  const taskId = parsedLocal.success ? parsedLocal.data.id : undefined;
  useEffect(() => {
    if (!allowedStore || !taskId) return;
    let active = true;
    void repository
      .get(conflict.storeId, taskId)
      .then((row) => {
        if (active) setLocal(row);
      })
      .catch(() => {
        if (active) setError("La déclaration locale ne peut pas être lu.");
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
    taskId,
  ]);
  const remote = commercialExecutionTaskSchema.safeParse(
    conflict.remotePayload,
  );
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
        commercialExecutionError(
          reason instanceof Error ? reason.message : undefined,
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  if (!allowedStore)
    return (
      <InlineAlert
        title="Magasin différent"
        message="Ouvrez ce conflit depuis le magasin auquel ce déclaration appartient."
      />
    );
  return (
    <>
      <SectionCard title="Ma déclaration locale actuelle">
        <Text className="text-base text-ink">
          {local
            ? commercialExecutionSummary(local.entity)
            : "Lecture de la déclaration locale…"}
        </Text>
      </SectionCard>
      <SectionCard title="Déclaration synchronisée">
        <Text className="text-base text-ink">
          {remote.success
            ? commercialExecutionSummary(remote.data)
            : "Aucune déclaration distante disponible."}
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
        label="Conserver ma déclaration locale"
        disabled={busy || !local}
        onPress={() => void resolve(true)}
      />
      {remote.success ? (
        <SecondaryButton
          label="Adopter la déclaration synchronisée"
          disabled={busy || !local}
          onPress={() => void resolve(false)}
        />
      ) : null}
    </>
  );
}
