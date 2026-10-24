import { useAuth } from "@/auth/auth-provider";
import { useMemo, useRef, useState, useCallback, useLayoutEffect } from "react";
import { Text, View, Switch } from "react-native";
import { router, useFocusEffect } from "expo-router";
import {
  randomUUID,
  digestStringAsync,
  CryptoDigestAlgorithm,
} from "expo-crypto";
import type { SyncConflict } from "@/sync/conflict-repository";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import { SectionCard, SecondaryButton, InlineAlert } from "@/components/ui";
import { StoreContextRepository } from "./context-repository";
import { storeContextSummary, storeContextError } from "./context-presentation";

const digest = (s: string) =>
  digestStringAsync(CryptoDigestAlgorithm.SHA256, s);
export function StoreContextConflict({ conflict }: { conflict: SyncConflict }) {
  const { session } = useAuth(),
    { deviceId } = useLocalDatabase(),
    store = session?.stores[0];
  return session && store?.storeId === conflict.storeId ? (
    <StoreContextConflictReview
      key={`${session.user.id}:${store.storeId}:${conflict.id}:${deviceId}`}
      conflict={conflict}
    />
  ) : (
    <InlineAlert
      title="Magasin différent"
      message="Ouvrez ce conflit depuis le magasin auquel ce réglage appartient."
    />
  );
}
function StoreContextConflictReview({ conflict }: { conflict: SyncConflict }) {
  const { sqlite, deviceId } = useLocalDatabase(),
    { syncNow } = useSync(),
    repository = useMemo(
      () => new StoreContextRepository(sqlite, digest),
      [sqlite],
    );
  const scope = useMemo(
      () => ({
        repository,
        deviceId,
        storeId: conflict.storeId,
        conflictId: conflict.id,
      }),
      [repository, deviceId, conflict.storeId, conflict.id],
    ),
    activeScope = useRef<typeof scope | null>(null);
  useLayoutEffect(() => {
    activeScope.current = scope;
    return () => {
      if (activeScope.current === scope) activeScope.current = null;
    };
  }, [scope]);
  const [review, setReview] =
      useState<Awaited<ReturnType<StoreContextRepository["review"]>>>(),
    [compared, setCompared] = useState(false),
    [busy, setBusy] = useState(false),
    [reading, setReading] = useState(true),
    [error, setError] = useState<string>();
  const revision = useRef(0),
    live = useRef(false),
    locked = useRef(false),
    abort = useRef<AbortController | undefined>(undefined);
  useFocusEffect(
    useCallback(() => {
      const v = ++revision.current;
      live.current = true;
      locked.current = false;
      abort.current = undefined;
      setReview(undefined);
      setReading(true);
      setCompared(false);
      setBusy(false);
      setError(undefined);
      void repository
        .review(conflict.storeId, conflict.id)
        .then((next) => {
          if (live.current && revision.current === v) {
            setReview(next);
            setReading(false);
          }
        })
        .catch(() => {
          if (live.current && revision.current === v) {
            setReading(false);
            setError(
              "La comparaison ne peut pas être lue. Les réglages et modifications restent conservés ; réessayez la lecture.",
            );
          }
        });
      return () => {
        live.current = false;
        revision.current++;
        abort.current?.abort();
      };
    }, [repository, conflict.storeId, conflict.id]),
  );
  const renderedRevision = revision.current;
  async function resolve(useLocal: boolean) {
    if (
      activeScope.current !== scope ||
      renderedRevision !== revision.current ||
      locked.current ||
      !live.current ||
      reading ||
      !!error ||
      !review?.canResolve ||
      !compared
    )
      return;
    const v = revision.current,
      cancel = new AbortController();
    locked.current = true;
    abort.current = cancel;
    setBusy(true);
    setError(undefined);
    const current = () =>
      activeScope.current === scope && live.current && revision.current === v;
    try {
      await repository.resolve(conflict.id, useLocal, {
        storeId: conflict.storeId,
        commandId: randomUUID(),
        remoteHistoryId: randomUUID(),
        deviceId,
        reviewHash: review.hash,
        canResolve: current,
        signal: cancel.signal,
      });
      if (current()) {
        void syncNow(conflict.storeId).catch(() => undefined);
        router.back();
      }
    } catch (reason) {
      if (current()) {
        setCompared(false);
        setError(
          storeContextError(
            reason instanceof Error ? reason.message : undefined,
          ),
        );
        const next = await repository
          .review(conflict.storeId, conflict.id)
          .catch(() => undefined);
        if (current()) setReview(next);
      }
    } finally {
      if (abort.current === cancel) {
        abort.current = undefined;
        locked.current = false;
        if (current()) setBusy(false);
      }
    }
  }
  return (
    <>
      {reading ? (
        <Text className="text-sm text-muted" accessibilityLiveRegion="polite">
          Lecture de la comparaison…
        </Text>
      ) : null}
      <SectionCard title="Mes réglages locaux">
        <Text className="text-base text-ink">
          {review
            ? storeContextSummary(review.current.entity)
            : "Lecture des réglages locaux…"}
        </Text>
      </SectionCard>
      <SectionCard title="Réglages synchronisés">
        <Text className="text-base text-ink">
          {review?.group.remote
            ? storeContextSummary(review.group.remote)
            : "Version distante non vérifiée."}
        </Text>
      </SectionCard>
      {(review?.group.conflicts.length ?? 0) > 1 ? (
        <Text className="text-sm text-muted">
          {review!.group.conflicts.length} conflits concernent ces mêmes
          réglages. Votre choix porte sur les réglages locaux actuels et la
          version synchronisée v{review?.group.remote?.version}. Les versions
          précédentes restent conservées.
        </Text>
      ) : null}
      <Text className="text-sm text-muted">
        Les versions et les modifications locales restent dans l’historique.
        Aucune n’est retenue automatiquement.
      </Text>
      {review?.reason ? (
        <InlineAlert title="Comparaison à revoir" message={review.reason} />
      ) : null}
      {error ? (
        <InlineAlert title="Résolution impossible" message={error} />
      ) : null}
      <View className="flex-row items-center gap-3">
        <Switch
          accessibilityLabel="J’ai comparé les réglages locaux et synchronisés"
          value={compared}
          disabled={busy || reading || !!error || !review?.canResolve}
          onValueChange={setCompared}
        />
        <Text className="flex-1 text-base text-ink">
          J’ai comparé les réglages locaux et synchronisés.
        </Text>
      </View>
      <SecondaryButton
        label="Conserver mes réglages locaux"
        disabled={
          busy || reading || !!error || !review?.canResolve || !compared
        }
        onPress={() => void resolve(true)}
      />
      <SecondaryButton
        label="Adopter les réglages synchronisés"
        disabled={
          busy || reading || !!error || !review?.canResolve || !compared
        }
        onPress={() => void resolve(false)}
      />
      <SecondaryButton
        label="Relire la comparaison"
        disabled={busy || reading}
        onPress={() => {
          const v = ++revision.current;
          setReading(true);
          setCompared(false);
          setError(undefined);
          void repository
            .review(conflict.storeId, conflict.id)
            .then((next) => {
              if (live.current && revision.current === v) {
                setReview(next);
                setReading(false);
              }
            })
            .catch(() => {
              if (live.current && revision.current === v) {
                setReading(false);
                setError(
                  "La comparaison ne peut pas être relue. Vos réglages sont conservés.",
                );
              }
            });
        }}
      />
    </>
  );
}
