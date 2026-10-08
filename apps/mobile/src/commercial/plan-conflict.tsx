import { useAuth } from "@/auth/auth-provider";
import { useEffect, useMemo, useState } from "react";
import { Text } from "react-native";
import { router } from "expo-router";
import {
  digestStringAsync,
  CryptoDigestAlgorithm,
  randomUUID,
} from "expo-crypto";
import { commercialWeekPlanSchema } from "@fl-copilot/sync-contracts";
import type { SyncConflict } from "@/sync/conflict-repository";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import { SectionCard, SecondaryButton, InlineAlert } from "@/components/ui";
import {
  CommercialPlanRepository,
  type LocalCommercialPlan,
} from "./week-plan-repository";
import {
  commercialPlanSummary,
  commercialPlanError,
} from "./plan-presentation";
export function CommercialPlanConflict({
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
      new CommercialPlanRepository(sqlite, (text) =>
        digestStringAsync(CryptoDigestAlgorithm.SHA256, text),
      ),
    [sqlite],
  );
  const [local, setLocal] = useState<LocalCommercialPlan | null>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const parsedLocal = commercialWeekPlanSchema.safeParse(conflict.localPayload);
  const weekStart = parsedLocal.success
    ? parsedLocal.data.weekStart
    : undefined;
  useEffect(() => {
    if (!allowedStore || !weekStart) return;
    let active = true;
    void repository
      .get(conflict.storeId, weekStart)
      .then((row) => {
        if (active) setLocal(row);
      })
      .catch(() => {
        if (active) setError("Le plan local ne peut pas être lu.");
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
    weekStart,
  ]);
  const remote = commercialWeekPlanSchema.safeParse(conflict.remotePayload);
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
        commercialPlanError(
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
        message="Ouvrez ce conflit depuis le magasin auquel ce plan appartient."
      />
    );
  return (
    <>
      <SectionCard title="Mon plan local actuel">
        <Text className="text-base text-ink">
          {local
            ? commercialPlanSummary(local.entity)
            : "Lecture du plan local…"}
        </Text>
      </SectionCard>
      <SectionCard title="Plan synchronisé">
        <Text className="text-base text-ink">
          {remote.success
            ? commercialPlanSummary(remote.data)
            : "Aucun plan distant disponible."}
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
        label="Conserver mon plan local après vérification"
        disabled={busy || !local}
        onPress={() => void resolve(true)}
      />
      {remote.success ? (
        <SecondaryButton
          label="Adopter le plan synchronisé"
          disabled={busy || !local}
          onPress={() => void resolve(false)}
        />
      ) : null}
    </>
  );
}
