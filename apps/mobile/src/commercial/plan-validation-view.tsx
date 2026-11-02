import { useAuth } from "@/auth/auth-provider";
import { useCallback, useMemo, useState, useRef, useEffect } from "react";
import { Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import {
  digestStringAsync,
  CryptoDigestAlgorithm,
  randomUUID,
} from "expo-crypto";
import { buildCommercialWeekPlan } from "@fl-copilot/commercial-core";
import type {
  CommercialWeekPreparation,
  CommercialWeekPlan,
} from "@fl-copilot/sync-contracts";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import {
  SectionCard,
  SecondaryButton,
  PrimaryButton,
  InlineAlert,
} from "@/components/ui";
import {
  CommercialPlanRepository,
  type LocalCommercialPlan,
} from "./week-plan-repository";
import {
  readCommercialPlanReview,
  saveReviewedCommercialPlan,
} from "./plan-review";
import { CommercialPlanContent } from "./plan-content";
import { commercialPlanError } from "./plan-presentation";
const digest = (s: string) =>
  digestStringAsync(CryptoDigestAlgorithm.SHA256, s);
export function CommercialPlanValidationView({
  preparation,
  unsavedChanges,
}: {
  preparation: CommercialWeekPreparation;
  unsavedChanges: boolean;
}) {
  const { session } = useAuth();
  const canConfirm =
    session?.stores.find((s) => s.storeId === preparation.storeId)?.role ===
    "MANAGER";
  const live = useRef({
    canConfirm,
    storeId: preparation.storeId,
    ownerId: session?.user.id,
  });
  live.current = {
    canConfirm,
    storeId: preparation.storeId,
    ownerId: session?.user.id,
  };
  const locked = useRef(false);
  useEffect(
    () => () => {
      live.current.canConfirm = false;
    },
    [],
  );
  const { sqlite, deviceId } = useLocalDatabase(),
    { syncNow } = useSync(),
    repo = useMemo(
      () => new CommercialPlanRepository(sqlite, digest),
      [sqlite],
    );
  const [review, setReview] =
      useState<Awaited<ReturnType<typeof readCommercialPlanReview>>>(),
    [candidate, setCandidate] = useState<CommercialWeekPlan>(),
    [current, setCurrent] = useState<LocalCommercialPlan | null>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const refresh = useCallback(async () => {
    const [ctx, record] = await Promise.all([
      readCommercialPlanReview(
        sqlite,
        preparation,
        digest,
        new Date().toISOString(),
      ),
      repo.get(preparation.storeId, preparation.weekStart),
    ]);
    const now = new Date().toISOString();
    const preview = ctx.issues.length
      ? undefined
      : await buildCommercialWeekPlan(
          {
            preparation,
            version:
              (record?.syncState === "ERROR"
                ? (record.remoteVersion ?? 0)
                : (record?.entity.version ?? 0)) + 1,
            createdAt: record?.entity.createdAt ?? now,
            validatedAt: now,
          },
          ctx.context,
          digest,
        );
    return { ctx, record, preview };
  }, [sqlite, repo, preparation]);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void refresh()
        .then((r) => {
          if (active) {
            setReview(r.ctx);
            setCurrent(r.record);
            setCandidate(r.preview);
          }
        })
        .catch(() => {
          if (active)
            setError(
              "La vérification du plan ne peut pas être lue. Réessayez en actualisant cet écran.",
            );
        });
      return () => {
        active = false;
      };
    }, [refresh]),
  );
  async function reload() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await refresh();
      setReview(r.ctx);
      setCurrent(r.record);
      setCandidate(r.preview);
    } catch {
      setError("La vérification du plan ne peut pas être actualisée.");
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    if (
      locked.current ||
      busy ||
      !canConfirm ||
      unsavedChanges ||
      !candidate ||
      !review
    )
      return;
    locked.current = true;
    const ownerId = session?.user.id;
    setBusy(true);
    setError(undefined);
    try {
      const plan = await saveReviewedCommercialPlan(
        sqlite,
        candidate,
        review.basis,
        {
          commandId: randomUUID(),
          deviceId,
          generateId: randomUUID,
          appliedAt: new Date().toISOString(),
          canConfirm: () =>
            live.current.canConfirm &&
            live.current.storeId === candidate.storeId &&
            live.current.ownerId === ownerId,
        },
        digest,
      );
      void syncNow(plan.storeId).catch(() => undefined);
      router.push({
        pathname: "/commercial-plan",
        params: { weekStart: plan.weekStart },
      });
    } catch (reason) {
      setError(
        commercialPlanError(
          reason instanceof Error ? reason.message : undefined,
        ),
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  const issues = review?.issues ?? [];
  return (
    <SectionCard
      title={
        current
          ? "Valider une nouvelle version du plan"
          : "Finaliser mon plan de semaine"
      }
      description="Un seul récapitulatif pour confirmer les offres sélectionnées et les TG. La mise en rayon sera déclarée séparément."
    >
      {unsavedChanges ? (
        <InlineAlert
          title="Modifications à enregistrer"
          message="Enregistrez d’abord le brouillon pour vérifier et valider sa sélection actuelle."
        />
      ) : null}
      {current ? (
        <>
          <Text className="text-base text-ink">
            Plan conservé : version {current.entity.version}
            {current.syncState === "SYNCED"
              ? " · synchronisé"
              : current.syncState === "CONFLICT"
                ? " · conflit"
                : current.syncState === "ERROR"
                  ? " · envoi refusé"
                  : " · à synchroniser"}
          </Text>
          <SecondaryButton
            label="Voir mon plan conservé et son historique"
            onPress={() =>
              router.push({
                pathname: "/commercial-plan",
                params: { weekStart: preparation.weekStart },
              })
            }
          />
        </>
      ) : null}
      {issues.map((i, n) => (
        <View
          key={`${i.code}:${i.choiceId ?? i.placementId ?? n}`}
          className="gap-1"
        >
          <Text accessibilityRole="alert" className="text-base text-danger">
            {i.choiceId
              ? `${review?.context.choices.find((c) => c.id === i.choiceId)?.rawProductLabel ?? "Offre"} : `
              : ""}
            {i.messageFr}
          </Text>
        </View>
      ))}
      {error ? <InlineAlert title="Plan à vérifier" message={error} /> : null}
      {current?.syncState === "CONFLICT" ? (
        <SecondaryButton
          label="Comparer les deux plans dans Synchronisation"
          onPress={() => router.push("/sync-center")}
        />
      ) : null}
      <SecondaryButton
        label={busy ? "Vérification…" : "Actualiser la vérification du plan"}
        disabled={busy}
        onPress={() => void reload()}
      />
      {candidate ? (
        <>
          <CommercialPlanContent plan={candidate} review />
          <Text className="text-sm text-muted">
            En confirmant, tu valides ensemble les produits, dates et conditions
            affichés, puis tu enregistres ce plan.
          </Text>
          <PrimaryButton
            label={
              busy
                ? "Enregistrement…"
                : current
                  ? "Valider cette nouvelle version du plan"
                  : "Valider mon plan de semaine"
            }
            disabled={
              busy ||
              !canConfirm ||
              unsavedChanges ||
              current?.syncState === "CONFLICT"
            }
            onPress={() => void publish()}
          />
        </>
      ) : (
        <Text className="text-sm text-muted">
          La validation sera proposée lorsque le brouillon enregistré et ses
          offres auront passé les contrôles.
        </Text>
      )}
    </SectionCard>
  );
}
