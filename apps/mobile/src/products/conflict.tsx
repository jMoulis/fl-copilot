import { useMemo, useState, useCallback } from "react";
import { View, Text, Pressable, Switch, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import {
  digestStringAsync,
  CryptoDigestAlgorithm,
  randomUUID,
} from "expo-crypto";
import { useAuth } from "../auth/auth-provider";
import { useLocalDatabase } from "../providers/database-provider";
import { useSync } from "../sync/sync-provider";
import type { SyncConflict } from "../sync/conflict-repository";
import { useReviewedConflict } from "../components/use-reviewed-conflict";
import { ProductMasterConflictRepository } from "./conflict-repository";
import { catalogueConflictSummary } from "./conflict-presentation";
import { colors } from "../design/tokens";
const digest = (value: string) =>
  digestStringAsync(CryptoDigestAlgorithm.SHA256, value);
type Decision = "KEEP_LOCAL" | "ADOPT_REMOTE";
export function ProductMasterConflict({
  conflict,
}: {
  conflict: SyncConflict;
}) {
  const { session } = useAuth(),
    { deviceId } = useLocalDatabase(),
    store = session?.stores[0];
  if (
    !session ||
    store?.storeId !== conflict.storeId ||
    store.role !== "MANAGER"
  )
    return (
      <Text style={{ color: colors.ink }}>
        La résolution du référentiel nécessite les droits de responsable du
        magasin actif.
      </Text>
    );
  return (
    <CatalogueReview
      key={`${session.user.id}:${store.storeId}:${store.role}:${deviceId}:${conflict.id}`}
      conflict={conflict}
      ownerId={session.user.id}
    />
  );
}
function CatalogueReview({
  conflict,
  ownerId,
}: {
  conflict: SyncConflict;
  ownerId: string;
}) {
  const { sqlite, deviceId } = useLocalDatabase(),
    { syncNow } = useSync(),
    repository = useMemo(
      () => new ProductMasterConflictRepository(sqlite, digest),
      [sqlite],
    ),
    scope = useMemo(
      () => ({
        repository,
        deviceId,
        ownerId,
        storeId: conflict.storeId,
        conflictId: conflict.id,
      }),
      [repository, deviceId, ownerId, conflict.storeId, conflict.id],
    ),
    read = useCallback(
      () => repository.review(conflict.storeId, conflict.id),
      [repository, conflict.storeId, conflict.id],
    );
  const [selection, setSelection] = useState<{
      hash: string;
      decision: Decision;
    } | null>(null),
    [extraKey, setExtraKey] = useState<string | null>(null),
    [localDeletionKey, setLocalDeletionKey] = useState<string | null>(null),
    [completed, setCompleted] = useState(false);
  const {
    review,
    compared,
    setCompared,
    busy,
    reading,
    error,
    resolve,
    reload,
  } = useReviewedConflict({
    scope,
    read,
    canChoose: (r, local) => {
      const direction = local ? "KEEP_LOCAL" : "ADOPT_REMOTE",
        key = `${r.hash}:${direction}`,
        p = r.policy;
      const extraRequired = local
        ? p.reactivateLocal || p.activateLocal
        : p.reactivateRemote || p.activateRemote || p.remoteDeleted;
      return (
        selection?.hash === r.hash &&
        selection.decision === direction &&
        (local ? r.canKeep : r.canAdopt) &&
        (!extraRequired || extraKey === key) &&
        (!(p.localDeleted && !p.remoteDeleted) || localDeletionKey === key)
      );
    },
    choose: (r, local, lifetime) => {
      const key = `${r.hash}:${local ? "KEEP_LOCAL" : "ADOPT_REMOTE"}`;
      return repository.resolve(conflict.storeId, conflict.id, local, {
        commandId: randomUUID(),
        deviceId,
        jobId: randomUUID(),
        reviewHash: r.hash,
        reactivateRejected:
          (local ? r.policy.reactivateLocal : r.policy.reactivateRemote) &&
          extraKey === key,
        activateProduct:
          (local ? r.policy.activateLocal : r.policy.activateRemote) &&
          extraKey === key,
        acceptRemoteDeletion:
          !local && r.policy.remoteDeleted && extraKey === key,
        confirmLocalDeletionChoice:
          r.policy.localDeleted &&
          !r.policy.remoteDeleted &&
          localDeletionKey === key,
        ...lifetime,
      });
    },
    errorText: () =>
      "La comparaison a changé ou la résolution n’a pas été enregistrée. Relisez les versions avant de confirmer.",
    onSuccess: () => {
      setCompleted(true);
      void Promise.resolve()
        .then(() => syncNow(conflict.storeId))
        .catch(() => undefined);
      try {
        router.back();
      } catch {
        /* The committed choice remains available locally. */
      }
    },
  });
  const decision =
      selection?.hash === review?.hash ? (selection?.decision ?? null) : null,
    choiceKey = review && decision ? `${review.hash}:${decision}` : null,
    extra = choiceKey !== null && extraKey === choiceKey,
    localDeletionConfirmed =
      choiceKey !== null && localDeletionKey === choiceKey,
    reactivate =
      decision === "KEEP_LOCAL"
        ? review?.policy.reactivateLocal
        : decision === "ADOPT_REMOTE"
          ? review?.policy.reactivateRemote
          : false,
    activate =
      decision === "KEEP_LOCAL"
        ? review?.policy.activateLocal
        : decision === "ADOPT_REMOTE"
          ? review?.policy.activateRemote
          : false,
    deletion = decision === "ADOPT_REMOTE" && !!review?.policy.remoteDeleted,
    needsExtra = reactivate || activate || deletion,
    localDeletion =
      !!decision &&
      !!review?.policy.localDeleted &&
      !review.policy.remoteDeleted,
    localDeletionLabel =
      decision === "KEEP_LOCAL"
        ? "Je confirme le maintien de ma suppression malgré la modification synchronisée."
        : "Je confirme l’annulation de ma suppression et le rétablissement de la version synchronisée.",
    eligible =
      decision === "KEEP_LOCAL"
        ? review?.canKeep
        : decision === "ADOPT_REMOTE"
          ? review?.canAdopt
          : false,
    disabled =
      busy ||
      reading ||
      !!error ||
      !eligible ||
      !compared ||
      (!!needsExtra && !extra) ||
      (localDeletion && !localDeletionConfirmed);
  if (completed)
    return (
      <Text accessibilityLiveRegion="polite" style={{ color: colors.ink }}>
        Comparaison enregistrée. Votre choix est conservé sur cet appareil.
      </Text>
    );
  const choice = (
    value: "KEEP_LOCAL" | "ADOPT_REMOTE",
    label: string,
    enabled: boolean,
  ) => (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{
        checked: decision === value,
        disabled: busy || reading || !!error || !enabled,
      }}
      disabled={busy || reading || !!error || !enabled}
      onPress={() => {
        setSelection({ hash: review!.hash, decision: value });
        setCompared(false);
        setExtraKey(null);
        setLocalDeletionKey(null);
      }}
      style={{
        minHeight: 44,
        padding: 12,
        borderWidth: 1,
        borderRadius: 12,
        borderColor: colors.forest,
        opacity: enabled ? 1 : 0.45,
        backgroundColor:
          decision === value ? colors.positiveSoft : colors.surface,
      }}
    >
      <Text style={{ color: colors.ink }}>{label}</Text>
    </Pressable>
  );
  return (
    <View
      style={{
        gap: 12,
        padding: 16,
        borderWidth: 1,
        borderColor: colors.forest,
        borderRadius: 16,
      }}
    >
      {reading ? (
        <ActivityIndicator accessibilityLabel="Lecture des versions du référentiel" />
      ) : null}
      {review ? (
        <>
          {review.conflicts.length > 1 ? (
            <Text style={{ color: colors.ink }}>
              {review.conflicts.length} conflits concernent cette même fiche.
              Votre choix porte sur la version locale actuelle et la version
              synchronisée v{review.remote.version}. Les versions précédentes
              restent conservées dans l’historique.
            </Text>
          ) : null}
          <Text style={{ color: colors.ink, fontWeight: "700" }}>
            Votre version actuelle
          </Text>
          <Text style={{ color: colors.ink }}>
            {catalogueConflictSummary(
              review.kind,
              review.current.entity,
              review.policy.products,
            )}
          </Text>
          <Text style={{ color: colors.ink, fontWeight: "700" }}>
            Version synchronisée
          </Text>
          <Text style={{ color: colors.ink }}>
            {catalogueConflictSummary(
              review.kind,
              review.remote,
              review.policy.products,
            )}
          </Text>
          <Text style={{ color: colors.ink }}>
            Les autres fiches, codes, associations et données historiques
            restent conservés. Pour un alias, la confiance synchronisée est
            préservée.
          </Text>
          {review.reason ? (
            <Text style={{ color: colors.ink }}>{review.reason}</Text>
          ) : null}
          {choice(
            "KEEP_LOCAL",
            review.policy.localDeleted && !review.policy.remoteDeleted
              ? "Maintenir ma suppression locale"
              : "Conserver ma version locale",
            review.canKeep,
          )}
          {choice(
            "ADOPT_REMOTE",
            review.policy.remoteDeleted
              ? "Accepter la suppression synchronisée"
              : review.policy.localDeleted
                ? "Annuler ma suppression et rétablir la version synchronisée"
                : "Adopter la version synchronisée",
            review.canAdopt,
          )}
          {localDeletion ? (
            <View
              style={{ flexDirection: "row", gap: 8, alignItems: "center" }}
            >
              <Switch
                disabled={busy || reading || !!error}
                accessibilityLabel={localDeletionLabel}
                value={localDeletionConfirmed}
                onValueChange={(value) =>
                  setLocalDeletionKey(value ? choiceKey : null)
                }
              />
              <Text style={{ color: colors.ink, flex: 1 }}>
                {localDeletionLabel}
              </Text>
            </View>
          ) : null}
          {needsExtra ? (
            <View
              style={{ flexDirection: "row", gap: 8, alignItems: "center" }}
            >
              <Switch
                disabled={busy || reading || !!error}
                accessibilityLabel={
                  deletion
                    ? "Je confirme l’acceptation de la suppression synchronisée"
                    : activate
                      ? "Je confirme la remise en activité du produit"
                      : "Je confirme la réactivation de l’alias refusé"
                }
                value={extra}
                onValueChange={(value) => setExtraKey(value ? choiceKey : null)}
              />
              <Text style={{ color: colors.ink, flex: 1 }}>
                {deletion
                  ? "Je confirme cette suppression. Ma saisie locale reste conservée sur cet appareil pour traçabilité."
                  : activate
                    ? "Je confirme la remise en activité du produit."
                    : "Je confirme la réactivation de l’alias refusé."}
              </Text>
            </View>
          ) : null}
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Switch
              disabled={busy || reading || !!error || !decision}
              accessibilityLabel="J’ai comparé les deux versions et je confirme mon choix"
              value={compared}
              onValueChange={setCompared}
            />
            <Text style={{ color: colors.ink, flex: 1 }}>
              J’ai comparé les deux versions et je confirme mon choix.
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Confirmer cette résolution"
            accessibilityState={{ busy, disabled }}
            disabled={disabled}
            onPress={() => {
              if (decision) void resolve(decision === "KEEP_LOCAL");
            }}
            style={{
              minHeight: 44,
              padding: 12,
              borderRadius: 12,
              backgroundColor: colors.forest,
              opacity: disabled ? 0.45 : 1,
            }}
          >
            <Text style={{ color: colors.onAccent, textAlign: "center" }}>
              {busy ? "Enregistrement…" : "Confirmer cette résolution"}
            </Text>
          </Pressable>
        </>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Relire la comparaison"
        disabled={busy || reading}
        onPress={() => {
          setSelection(null);
          setExtraKey(null);
          setLocalDeletionKey(null);
          reload();
        }}
        style={{ minHeight: 44, padding: 12 }}
      >
        <Text style={{ color: colors.forest }}>Relire la comparaison</Text>
      </Pressable>
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: colors.critical }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}
