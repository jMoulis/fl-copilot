import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import {
  digestStringAsync,
  CryptoDigestAlgorithm,
  randomUUID,
} from "expo-crypto";
import {
  buildCommercialWeekPlan,
  commercialPlanIssues,
  type CommercialPlanContext,
} from "@fl-copilot/commercial-core";
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
import { readWeekPlanContext } from "./week-plan-context";
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
  const { sqlite, deviceId } = useLocalDatabase(),
    { syncNow } = useSync(),
    repo = useMemo(
      () => new CommercialPlanRepository(sqlite, digest),
      [sqlite],
    );
  const [context, setContext] = useState<CommercialPlanContext>(),
    [candidate, setCandidate] = useState<CommercialWeekPlan>(),
    [current, setCurrent] = useState<LocalCommercialPlan | null>(),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const refresh = useCallback(async () => {
    const [ctx, record] = await Promise.all([
      readWeekPlanContext(sqlite, preparation),
      repo.get(preparation.storeId, preparation.weekStart),
    ]);
    const now = new Date().toISOString();
    const preview = commercialPlanIssues(preparation, ctx).length
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
          ctx,
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
            setContext(r.ctx);
            setCurrent(r.record);
            setCandidate(r.preview);
            setConfirmed(false);
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
      setContext(r.ctx);
      setCurrent(r.record);
      setCandidate(r.preview);
      setConfirmed(false);
    } catch {
      setError("La vérification du plan ne peut pas être actualisée.");
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    if (busy || unsavedChanges || !candidate || !context || !confirmed) return;
    setBusy(true);
    setError(undefined);
    try {
      const plan = await buildCommercialWeekPlan(
        {
          preparation,
          version: candidate.version,
          createdAt: candidate.createdAt,
          validatedAt: new Date().toISOString(),
        },
        context,
        digest,
      );
      await repo.save(plan, { commandId: randomUUID(), deviceId });
      void syncNow(plan.storeId).catch(() => undefined);
      setConfirmed(false);
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
      setBusy(false);
    }
  }
  const issues = context ? commercialPlanIssues(preparation, context) : [];
  return (
    <SectionCard
      title={
        current
          ? "Valider une nouvelle version du plan"
          : "Finaliser mon plan de semaine"
      }
      description="Confirmez les opérations regroupées et les TG choisies. Le brouillon reste conservé ; une nouvelle validation ne confirme aucune action exécutée."
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
              ? `${context?.choices.find((c) => c.id === i.choiceId)?.rawProductLabel ?? "Offre"} : `
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
          <CommercialPlanContent plan={candidate} />
          <SecondaryButton
            label={`${confirmed ? "✓ " : ""}Je confirme ces regroupements, les offres et les affectations TG pour mon magasin`}
            disabled={
              busy || unsavedChanges || current?.syncState === "CONFLICT"
            }
            onPress={() => setConfirmed((v) => !v)}
          />
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
              unsavedChanges ||
              !confirmed ||
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
