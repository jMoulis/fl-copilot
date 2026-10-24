import { useMemo, useCallback, useState } from "react";
import { Text, View, Switch } from "react-native";
import { router } from "expo-router";
import {
  randomUUID,
  digestStringAsync,
  CryptoDigestAlgorithm,
} from "expo-crypto";
import {
  needUnitSchema,
  needMembershipSchema,
  productSubstitutionSchema,
} from "@fl-copilot/domain";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import type { SyncConflict } from "@/sync/conflict-repository";
import { SectionCard, SecondaryButton, InlineAlert } from "@/components/ui";
import { useReviewedConflict } from "../components/use-reviewed-conflict";
import type { NeedConflictKind } from "./conflict-review";
import { NeedUnitRepository } from "./repository";
import { NeedMembershipRepository } from "./membership-repository";
import { ProductSubstitutionRepository } from "./substitution-repository";
import { needUnitSummary } from "./presentation";
import { membershipSummary } from "./membership-presentation";
import { substitutionSummary } from "./substitution-presentation";
const digest = (s: string) =>
  digestStringAsync(CryptoDigestAlgorithm.SHA256, s);
export function NeedFamilyConflict({
  kind,
  conflict,
}: {
  kind: NeedConflictKind;
  conflict: SyncConflict;
}) {
  const { session } = useAuth(),
    { deviceId } = useLocalDatabase(),
    store = session?.stores[0];
  return session && store?.storeId === conflict.storeId ? (
    <NeedFamilyReview
      key={`${session.user.id}:${store.storeId}:${conflict.id}:${kind}:${deviceId}:${store.role}`}
      kind={kind}
      conflict={conflict}
    />
  ) : (
    <InlineAlert
      title="Magasin différent"
      message="Ouvrez ce conflit depuis le magasin auquel appartient le besoin ou l’association."
    />
  );
}
function NeedFamilyReview({
  kind,
  conflict,
}: {
  kind: NeedConflictKind;
  conflict: SyncConflict;
}) {
  const { sqlite, deviceId } = useLocalDatabase(),
    { syncNow } = useSync(),
    repo = useMemo(
      () =>
        kind === "NEED"
          ? new NeedUnitRepository(sqlite, digest)
          : kind === "MEMBERSHIP"
            ? new NeedMembershipRepository(sqlite, digest)
            : new ProductSubstitutionRepository(sqlite, digest),
      [kind, sqlite],
    ),
    scope = useMemo(
      () => ({
        repo,
        deviceId,
        storeId: conflict.storeId,
        conflictId: conflict.id,
      }),
      [repo, deviceId, conflict.storeId, conflict.id],
    ),
    read = useCallback(
      () => repo.review(conflict.storeId, conflict.id),
      [repo, conflict.storeId, conflict.id],
    ),
    [reactivation, setReactivation] = useState<{
      hash: string;
      local: boolean;
    } | null>(null);
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
    canChoose: (r, local) =>
      (local ? r.canKeepLocal : r.canAdoptRemote) &&
      (!(local ? r.policy.reactivateLocal : r.policy.reactivateRemote) ||
        (reactivation?.hash === r.hash && reactivation.local === local)),
    choose: (r, local, lifetime) => {
      const consent =
        reactivation?.hash === r.hash && reactivation.local === local;
      setReactivation(null);
      return repo.resolve(conflict.id, local, {
        storeId: conflict.storeId,
        deviceId,
        commandId: randomUUID(),
        remoteHistoryId: randomUUID(),
        reviewHash: r.hash,
        reactivateRejected: consent,
        ...lifetime,
      });
    },
    errorText: () =>
      "La comparaison a changé ou votre accès n’est plus disponible. Vos versions sont conservées. Relisez-les avant de décider.",
    onSuccess: () => {
      void syncNow(conflict.storeId).catch(() => undefined);
      router.back();
    },
  });
  const canChoose = !!review && (review.canKeepLocal || review.canAdoptRemote),
    summary = (raw: unknown) => {
      if (kind === "NEED") return needUnitSummary(needUnitSchema.parse(raw));
      if (kind === "SUBSTITUTION")
        return substitutionSummary(
          productSubstitutionSchema.parse(raw),
          review?.policy.names,
        );
      const m = needMembershipSchema.parse(raw),
        names = review?.policy.names;
      return `${names?.products[m.productId] ?? "Produit non disponible localement"} → ${names?.needs[m.needUnitId] ?? "Besoin non disponible localement"} · ${membershipSummary(m)}`;
    };
  return (
    <>
      {reading ? (
        <Text className="text-sm text-muted" accessibilityLiveRegion="polite">
          Lecture de la comparaison…
        </Text>
      ) : null}
      <SectionCard title="Votre version locale">
        <Text className="text-ink">
          {review
            ? summary(review.current.entity)
            : "Lecture de la version locale…"}
        </Text>
      </SectionCard>
      <SectionCard title="Version synchronisée">
        <Text className="text-ink">
          {review?.group.remote
            ? summary(review.group.remote)
            : "Version distante non vérifiée."}
        </Text>
      </SectionCard>
      {(review?.group.conflicts.length ?? 0) > 1 ? (
        <Text className="text-sm text-muted">
          {review!.group.conflicts.length} conflits concernent cette même
          référence. Le choix compare votre version actuelle à la version
          synchronisée v{review?.group.remote?.version}. Les versions
          précédentes restent conservées.
        </Text>
      ) : null}
      <Text className="text-muted">
        {kind === "SUBSTITUTION"
          ? "Le sens produit source → remplaçant reste conservé. Retenir vos déclarations préserve les scores synchronisés ; aucune observation n’est créée ni recalculée ici."
          : "Les identités, les versions précédentes et les modifications locales restent conservées. Aucune version n’est choisie automatiquement."}
      </Text>
      {review?.reason ? (
        <InlineAlert
          title={review.ready ? "Choix disponibles" : "Comparaison à revoir"}
          message={review.reason}
        />
      ) : null}
      {error ? (
        <InlineAlert title="Résolution impossible" message={error} />
      ) : null}
      <View className="flex-row items-center gap-3">
        <Switch
          accessibilityLabel="J’ai comparé les versions locale et synchronisée"
          value={compared}
          disabled={busy || reading || !!error || !canChoose}
          onValueChange={(value) => {
            setCompared(value);
            if (!value) setReactivation(null);
          }}
        />
        <Text className="flex-1 text-base text-ink">
          J’ai comparé les versions locale et synchronisée.
        </Text>
      </View>
      {([true, false] as const).map((local) => {
        const allowed =
            !!review && (local ? review.canKeepLocal : review.canAdoptRemote),
          required =
            !!review &&
            (local
              ? review.policy.reactivateLocal
              : review.policy.reactivateRemote),
          consent =
            reactivation?.hash === review?.hash &&
            reactivation?.local === local;
        return (
          <View key={String(local)} className="gap-3">
            {allowed && required ? (
              <View className="flex-row items-center gap-3">
                <Switch
                  accessibilityLabel={`Je confirme la réactivation de l’association rejetée dans la version ${local ? "locale" : "synchronisée"}`}
                  value={!!consent}
                  disabled={busy || reading || !!error || !compared}
                  onValueChange={(value) =>
                    setReactivation(
                      value && review ? { hash: review.hash, local } : null,
                    )
                  }
                />
                <Text className="flex-1 text-ink">
                  Je confirme la réactivation de l’association rejetée dans la
                  version {local ? "locale" : "synchronisée"}.
                </Text>
              </View>
            ) : null}
            <SecondaryButton
              label={
                local
                  ? "Conserver ma version locale"
                  : "Adopter la version synchronisée"
              }
              disabled={
                busy ||
                reading ||
                !!error ||
                !compared ||
                !allowed ||
                (required && !consent)
              }
              onPress={() => void resolve(local)}
            />
          </View>
        );
      })}
      <SecondaryButton
        label="Relire la comparaison"
        disabled={busy || reading}
        onPress={() => {
          setReactivation(null);
          reload();
        }}
      />
    </>
  );
}
