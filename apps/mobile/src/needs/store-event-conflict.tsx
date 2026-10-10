import { useEffect, useMemo, useState } from "react";
import { Text } from "react-native";
import { router } from "expo-router";
import { randomUUID } from "expo-crypto";
import {
  storeProductEventSchema,
  sameStoreEventCapture,
} from "@fl-copilot/domain";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import type { SyncConflict } from "@/sync/conflict-repository";
import {
  StoreProductEventRepository,
  type LocalStoreProductEvent,
} from "./store-event-repository";
import { storeEventSummary, storeEventError } from "./store-event-presentation";
import { SectionCard, SecondaryButton, InlineAlert } from "@/components/ui";
export function StoreEventConflict({ conflict }: { conflict: SyncConflict }) {
  const { session } = useAuth(),
    allowed = session?.stores[0]?.storeId === conflict.storeId,
    { sqlite, deviceId } = useLocalDatabase(),
    { syncNow } = useSync(),
    repo = useMemo(() => new StoreProductEventRepository(sqlite), [sqlite]);
  const [local, setLocal] = useState<LocalStoreProductEvent | null>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    if (allowed)
      void repo
        .get(conflict.storeId, conflict.entityId)
        .then((r) => {
          if (active) setLocal(r);
        })
        .catch(() => {
          if (active) setError("La version locale ne peut pas être lue.");
        });
    return () => {
      active = false;
    };
  }, [repo, conflict.storeId, conflict.entityId, allowed]);
  const parsed = storeProductEventSchema.safeParse(conflict.remotePayload),
    remote =
      parsed.success &&
      parsed.data.storeId === conflict.storeId &&
      parsed.data.id === conflict.entityId
        ? parsed.data
        : null,
    current =
      local?.entity.storeId === conflict.storeId &&
      local.entity.id === conflict.entityId
        ? local
        : null,
    canKeep =
      !!current &&
      !!remote &&
      current.entity.status === "CLOSED" &&
      sameStoreEventCapture(current.entity, remote);
  async function resolve(useLocal: boolean) {
    if (!allowed || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await repo.resolve(conflict.id, useLocal, {
        commandId: randomUUID(),
        deviceId,
        capturedAt: new Date().toISOString(),
      });
      void syncNow(conflict.storeId).catch(() => undefined);
      router.back();
    } catch (e) {
      setError(storeEventError(e instanceof Error ? e.message : undefined));
    } finally {
      setBusy(false);
    }
  }
  if (!allowed)
    return (
      <InlineAlert
        title="Magasin différent"
        message="Ouvrez ce conflit depuis le magasin auquel appartient le signalement."
      />
    );
  return (
    <>
      <SectionCard title="Votre observation locale">
        <Text className="text-ink">
          {current
            ? storeEventSummary(current.entity)
            : "Lecture de la version locale…"}
        </Text>
      </SectionCard>
      <SectionCard title="Version synchronisée">
        <Text className="text-ink">
          {remote
            ? storeEventSummary(remote)
            : "Aucune version distante disponible."}
        </Text>
      </SectionCard>
      <Text className="text-muted">
        Les captures initiales restent immuables. Seule une heure de fin peut
        être confirmée sur une capture identique. Aucune version n’est choisie
        automatiquement.
      </Text>
      {canKeep ? (
        <SecondaryButton
          label="Confirmer mon heure de fin"
          disabled={busy}
          onPress={() => void resolve(true)}
        />
      ) : null}
      {remote ? (
        <SecondaryButton
          label="Adopter la version synchronisée"
          disabled={busy || !current}
          onPress={() => void resolve(false)}
        />
      ) : null}
      {error ? (
        <InlineAlert title="Résolution impossible" message={error} />
      ) : null}
    </>
  );
}
