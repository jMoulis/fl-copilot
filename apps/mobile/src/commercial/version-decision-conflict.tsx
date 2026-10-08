import { CommercialOriginalButton } from "./original-button";
import { commercialVersionDecisionSummary } from "@fl-copilot/commercial-core";
import { useAuth } from "@/auth/auth-provider";
import { useEffect, useMemo, useState } from "react";
import { Text } from "react-native";
import { router } from "expo-router";
import {
  digestStringAsync,
  CryptoDigestAlgorithm,
  randomUUID,
} from "expo-crypto";
import { commercialVersionDecisionSchema } from "@fl-copilot/sync-contracts";
import type { SyncConflict } from "@/sync/conflict-repository";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import { SectionCard, SecondaryButton, InlineAlert } from "@/components/ui";
import {
  CommercialVersionDecisionRepository,
  type LocalCommercialVersionDecision,
} from "./version-decision-repository";
import { commercialVersionDecisionError } from "./version-decision-presentation";
export function CommercialVersionDecisionConflict({
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
      new CommercialVersionDecisionRepository(sqlite, (text) =>
        digestStringAsync(CryptoDigestAlgorithm.SHA256, text),
      ),
    [sqlite],
  );
  const [local, setLocal] = useState<LocalCommercialVersionDecision | null>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const parsedLocal = commercialVersionDecisionSchema.safeParse(
    conflict.localPayload,
  );
  const sources = parsedLocal.success ? parsedLocal.data : undefined;
  const beforeId = sources?.before.documentId,
    afterId = sources?.after.documentId;
  useEffect(() => {
    if (!allowedStore || !beforeId || !afterId) return;
    let active = true;
    void repository
      .get(conflict.storeId, beforeId, afterId)
      .then((row) => {
        if (active) setLocal(row);
      })
      .catch(() => {
        if (active) setError("Le choix local ne peut pas être lu.");
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
    beforeId,
    afterId,
  ]);
  const remote = commercialVersionDecisionSchema.safeParse(
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
        commercialVersionDecisionError(
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
        message="Ouvrez ce conflit depuis le magasin auquel ce choix appartient."
      />
    );
  return (
    <>
      <SectionCard title="Mon choix local actuel">
        <Text className="text-base text-ink">
          {local
            ? commercialVersionDecisionSummary(local.entity)
            : "Lecture du choix local…"}
        </Text>
      </SectionCard>
      <SectionCard title="Choix synchronisé">
        <Text className="text-base text-ink">
          {remote.success
            ? commercialVersionDecisionSummary(remote.data)
            : "Aucun choix distant disponible."}
        </Text>
      </SectionCard>
      {beforeId && afterId ? (
        <SectionCard title="Sources de la comparaison">
          <CommercialOriginalButton sourceDocumentId={beforeId} />
          <CommercialOriginalButton sourceDocumentId={afterId} />
        </SectionCard>
      ) : null}
      <Text className="text-sm text-muted">
        Les deux versions et les modifications locales restent dans
        l’historique. Aucune n’est retenue automatiquement.
      </Text>
      {error ? (
        <InlineAlert title="Résolution impossible" message={error} />
      ) : null}
      <SecondaryButton
        label="Conserver mon choix local"
        disabled={busy || !local}
        onPress={() => void resolve(true)}
      />
      {remote.success ? (
        <SecondaryButton
          label="Adopter le choix synchronisé"
          disabled={busy || !local}
          onPress={() => void resolve(false)}
        />
      ) : null}
    </>
  );
}
