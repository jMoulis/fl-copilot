import { useMemo, useRef, useState, useCallback } from "react";
import { View, Text, Pressable, Switch, ActivityIndicator } from "react-native";
import { router, useFocusEffect } from "expo-router";
import {
  digestStringAsync,
  CryptoDigestAlgorithm,
  randomUUID,
} from "expo-crypto";
import { useAuth } from "../auth/auth-provider";
import { useLocalDatabase } from "../providers/database-provider";
import { useSync } from "../sync/sync-provider";
import type { SyncConflict } from "../sync/conflict-repository";
import { ProductMasterConflictRepository } from "./conflict-repository";
import { catalogueConflictSummary } from "./conflict-presentation";
import { colors } from "../design/tokens";
export function ProductMasterConflict({
  conflict,
}: {
  conflict: SyncConflict;
}) {
  const { session } = useAuth(),
    { sqlite, deviceId } = useLocalDatabase(),
    { syncNow } = useSync(),
    allowed =
      session?.stores.some(
        (s) => s.storeId === conflict.storeId && s.role === "MANAGER",
      ) ?? false;
  const authority = useRef(allowed);
  authority.current = allowed;
  const repository = useMemo(
    () =>
      new ProductMasterConflictRepository(sqlite, (s) =>
        digestStringAsync(CryptoDigestAlgorithm.SHA256, s),
      ),
    [sqlite],
  );
  const [review, setReview] =
      useState<
        Awaited<ReturnType<ProductMasterConflictRepository["review"]>>
      >(),
    [decision, setDecision] = useState<"KEEP_LOCAL" | "ADOPT_REMOTE" | null>(
      null,
    ),
    [compared, setCompared] = useState(false),
    [extra, setExtra] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const revision = useRef(0),
    locked = useRef(false),
    abort = useRef<AbortController | undefined>(undefined);
  useFocusEffect(
    useCallback(() => {
      const v = ++revision.current;
      setReview(undefined);
      setDecision(null);
      setCompared(false);
      setExtra(false);
      setError(undefined);
      setBusy(false);
      if (allowed)
        void repository
          .review(conflict.storeId, conflict.id)
          .then((r) => {
            if (revision.current === v) setReview(r);
          })
          .catch(() => {
            if (revision.current === v)
              setError(
                "Cette comparaison n’est plus disponible. Synchronisez puis rouvrez le conflit ; vos modifications restent conservées.",
              );
          });
      return () => {
        revision.current++;
        abort.current?.abort();
      };
    }, [repository, conflict.storeId, conflict.id, allowed]),
  );
  const reactivate =
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
    needsExtra = reactivate || activate;
  async function confirm() {
    if (
      locked.current ||
      !review ||
      !decision ||
      !compared ||
      (needsExtra && !extra) ||
      !authority.current
    )
      return;
    const v = revision.current,
      cancel = new AbortController();
    locked.current = true;
    abort.current = cancel;
    setBusy(true);
    setError(undefined);
    try {
      await repository.resolve(
        conflict.storeId,
        conflict.id,
        decision === "KEEP_LOCAL",
        {
          commandId: randomUUID(),
          deviceId,
          jobId: randomUUID(),
          reviewHash: review.hash,
          reactivateRejected: !!reactivate && extra,
          activateProduct: !!activate && extra,
          canResolve: () => authority.current,
          signal: cancel.signal,
        },
      );
      if (revision.current === v) {
        void syncNow(conflict.storeId).catch(() => undefined);
        router.back();
      }
    } catch {
      if (revision.current === v) {
        setCompared(false);
        setDecision(null);
        setExtra(false);
        setError(
          "La comparaison a changé ou la résolution n’a pas été enregistrée. Relisez les versions avant de confirmer.",
        );
        const next = await repository
          .review(conflict.storeId, conflict.id)
          .catch(() => undefined);
        if (revision.current === v) setReview(next);
      }
    } finally {
      locked.current = false;
      if (abort.current === cancel) abort.current = undefined;
      if (revision.current === v) setBusy(false);
    }
  }
  if (!allowed)
    return (
      <Text>
        La résolution du référentiel nécessite les droits de responsable du
        magasin.
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
        disabled: busy || !enabled,
      }}
      disabled={busy || !enabled}
      onPress={() => {
        setDecision(value);
        setCompared(false);
        setExtra(false);
      }}
      style={{
        minHeight: 44,
        padding: 12,
        borderWidth: 1,
        borderRadius: 12,
        borderColor: colors.forest,
        opacity: enabled ? 1 : 0.45,
        backgroundColor: decision === value ? colors.positiveSoft : "white",
      }}
    >
      <Text>{label}</Text>
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
      {!review && !error ? (
        <ActivityIndicator accessibilityLabel="Lecture des versions du référentiel" />
      ) : null}
      {review ? (
        <>
          <Text style={{ fontWeight: "700" }}>Votre version actuelle</Text>
          <Text>
            {catalogueConflictSummary(
              review.kind,
              review.current.entity,
              review.policy.products,
            )}
          </Text>
          <Text style={{ fontWeight: "700" }}>Version synchronisée</Text>
          <Text>
            {catalogueConflictSummary(
              review.kind,
              review.remote,
              review.policy.products,
            )}
          </Text>
          <Text>
            Les autres fiches, codes, associations et données historiques
            restent conservés. Pour un alias, la confiance synchronisée est
            préservée.
          </Text>
          {review.reason ? <Text>{review.reason}</Text> : null}
          {choice("KEEP_LOCAL", "Conserver ma version locale", review.canKeep)}
          {choice(
            "ADOPT_REMOTE",
            "Adopter la version synchronisée",
            review.canAdopt,
          )}
          {needsExtra ? (
            <View
              style={{ flexDirection: "row", gap: 8, alignItems: "center" }}
            >
              <Switch
                disabled={busy}
                accessibilityLabel={
                  activate
                    ? "Je confirme la remise en activité du produit"
                    : "Je confirme la réactivation de l’alias refusé"
                }
                value={extra}
                onValueChange={setExtra}
              />
              <Text style={{ flex: 1 }}>
                {activate
                  ? "Je confirme la remise en activité du produit."
                  : "Je confirme la réactivation de l’alias refusé."}
              </Text>
            </View>
          ) : null}
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Switch
              disabled={busy || !decision}
              accessibilityLabel="J’ai comparé les deux versions et je confirme mon choix"
              value={compared}
              onValueChange={setCompared}
            />
            <Text style={{ flex: 1 }}>
              J’ai comparé les deux versions et je confirme mon choix.
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{
              busy,
              disabled:
                busy || !decision || !compared || (!!needsExtra && !extra),
            }}
            disabled={
              busy || !decision || !compared || (!!needsExtra && !extra)
            }
            onPress={() => void confirm()}
            style={{
              minHeight: 44,
              padding: 12,
              borderRadius: 12,
              backgroundColor: colors.forest,
              opacity:
                busy || !decision || !compared || (needsExtra && !extra)
                  ? 0.45
                  : 1,
            }}
          >
            <Text style={{ color: "white", textAlign: "center" }}>
              {busy ? "Enregistrement…" : "Confirmer cette résolution"}
            </Text>
          </Pressable>
        </>
      ) : null}
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
