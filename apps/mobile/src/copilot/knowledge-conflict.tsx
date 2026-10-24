import { useMemo, useCallback, useState } from "react";
import { Text, View, Switch } from "react-native";
import {
  randomUUID,
  digestStringAsync,
  CryptoDigestAlgorithm,
} from "expo-crypto";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import { SectionCard, SecondaryButton, InlineAlert } from "@/components/ui";
import { useReviewedConflict } from "../components/use-reviewed-conflict";
import { CopilotKnowledgeRepository } from "./knowledge-repository";
import type { CopilotKnowledge } from "@fl-copilot/domain";
const digest = (s: string) =>
  digestStringAsync(CryptoDigestAlgorithm.SHA256, s);
export function KnowledgeConflict({
  knowledgeId,
  onResolved,
}: {
  knowledgeId: string;
  onResolved: () => void | Promise<void>;
}) {
  const { session } = useAuth(),
    { deviceId } = useLocalDatabase(),
    store = session?.stores[0];
  return session && store ? (
    <KnowledgeConflictReview
      key={`${session.user.id}:${store.storeId}:${store.role}:${deviceId}:${knowledgeId}`}
      knowledgeId={knowledgeId}
      ownerId={session.user.id}
      storeId={store.storeId}
      onResolved={onResolved}
    />
  ) : (
    <InlineAlert
      title="Mémoire privée"
      message="Reconnectez-vous au compte et au magasin de cette pratique pour comparer les versions."
    />
  );
}
function KnowledgeConflictReview({
  knowledgeId,
  ownerId,
  storeId,
  onResolved,
}: {
  knowledgeId: string;
  ownerId: string;
  storeId: string;
  onResolved: () => void | Promise<void>;
}) {
  const { sqlite, deviceId } = useLocalDatabase(),
    { syncNow } = useSync(),
    repo = useMemo(
      () =>
        new CopilotKnowledgeRepository(sqlite, { storeId, ownerId }, digest),
      [sqlite, storeId, ownerId],
    ),
    scope = useMemo(
      () => ({ repo, deviceId, storeId, ownerId, knowledgeId }),
      [repo, deviceId, storeId, ownerId, knowledgeId],
    ),
    read = useCallback(() => repo.review(knowledgeId), [repo, knowledgeId]),
    [reactivation, setReactivation] = useState<{
      hash: string;
      local: boolean;
    } | null>(null),
    [completion, setCompletion] = useState<object | null>(null),
    completed = completion === scope;
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
      !completed &&
      (local ? r.canKeepLocal : r.canAdoptRemote) &&
      (!(local ? r.reactivateLocal : r.reactivateRemote) ||
        (reactivation?.hash === r.hash && reactivation.local === local)),
    choose: (r, local, lifetime) => {
      const consent =
        reactivation?.hash === r.hash && reactivation.local === local;
      setReactivation(null);
      return repo.resolve(knowledgeId, local, {
        storeId,
        ownerId,
        deviceId,
        commandId: randomUUID(),
        reviewCaptureId: randomUUID(),
        reviewHash: r.hash,
        reactivateForgotten: consent,
        ...lifetime,
      });
    },
    errorText: () =>
      "La comparaison a changé ou votre accès n’est plus disponible. Vos versions sont conservées. Relisez-les avant de décider.",
    onSuccess: () => {
      setCompletion(scope);
      // Refresh failures never turn the committed choice into a failed write.
      // The parent fences its read lifetime, including after this row unmounts.
      const refresh = () => {
        try {
          void Promise.resolve(onResolved()).catch(() => undefined);
        } catch {
          /* A later focus can read the committed state. */
        }
      };
      refresh();
      void syncNow(storeId)
        .then(refresh)
        .catch(() => undefined);
    },
  });
  const canChoose = !!review && (review.canKeepLocal || review.canAdoptRemote),
    summary = (e: CopilotKnowledge) =>
      `${e.status === "FORGOTTEN" ? "Pratique oubliée" : "Pratique confirmée"} · version ${e.version}\n${e.statement}\n${e.sourceMessageId ? "Issue d’un de vos messages confirmés" : "Saisie confirmée"}`;
  return (
    <>
      {reading ? (
        <Text className="text-sm text-muted" accessibilityLiveRegion="polite">
          Lecture de la comparaison…
        </Text>
      ) : null}
      <SectionCard title="Votre version locale">
        <Text selectable className="text-ink">
          {review
            ? summary(review.current.entity)
            : "Lecture de la version locale…"}
        </Text>
      </SectionCard>
      <SectionCard title="Version synchronisée">
        <Text selectable className="text-ink">
          {review?.group.remote
            ? summary(review.group.remote)
            : "Version distante non vérifiée."}
        </Text>
      </SectionCard>
      {(review?.group.conflicts.length ?? 0) > 1 ? (
        <Text className="text-sm text-muted">
          {review!.group.conflicts.length} conflits concernent cette même
          pratique. Le choix porte sur votre version actuelle et la version
          synchronisée v{review?.group.remote?.version}. Les versions
          précédentes restent conservées dans la comparaison privée.
        </Text>
      ) : null}
      <Text className="text-muted">
        Cette mémoire reste privée à votre compte et au magasin, partagée entre
        vos conversations. Une pratique confirmée ne constitue ni un chiffre
        officiel ni une instruction du modèle.
      </Text>
      {completed ? (
        <InlineAlert
          title="Comparaison enregistrée"
          message="Votre choix est conservé sur cet appareil. Un envoi éventuel peut rester à synchroniser."
        />
      ) : (
        <>
          {review?.reason ? (
            <InlineAlert title="Comparaison à revoir" message={review.reason} />
          ) : null}
          {error ? (
            <InlineAlert title="Résolution impossible" message={error} />
          ) : null}
          <View className="flex-row items-center gap-3">
            <Switch
              accessibilityLabel="J’ai comparé les pratiques locale et synchronisée"
              value={compared}
              disabled={busy || reading || !!error || !canChoose}
              onValueChange={(v) => {
                setCompared(v);
                if (!v) setReactivation(null);
              }}
            />
            <Text className="flex-1 text-ink">
              J’ai comparé les pratiques locale et synchronisée.
            </Text>
          </View>
          {([true, false] as const).map((local) => {
            const allowed =
                !!review &&
                (local ? review.canKeepLocal : review.canAdoptRemote),
              required =
                !!review &&
                (local ? review.reactivateLocal : review.reactivateRemote),
              consent =
                reactivation?.hash === review?.hash &&
                reactivation?.local === local;
            return (
              <View key={String(local)} className="gap-3">
                {allowed && required ? (
                  <View className="flex-row items-center gap-3">
                    <Switch
                      accessibilityLabel={`Je confirme de réutiliser la pratique oubliée dans la version ${local ? "locale" : "synchronisée"}`}
                      value={!!consent}
                      disabled={busy || reading || !!error || !compared}
                      onValueChange={(v) =>
                        setReactivation(
                          v && review ? { hash: review.hash, local } : null,
                        )
                      }
                    />
                    <Text className="flex-1 text-ink">
                      Je confirme de réutiliser la pratique oubliée dans la
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
      )}
    </>
  );
}
