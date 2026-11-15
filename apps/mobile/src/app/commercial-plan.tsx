import { TgPresentationView } from "@/commercial/tg-presentation-view";
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { digestStringAsync, CryptoDigestAlgorithm } from "expo-crypto";
import { contextWeekQuerySchema } from "@fl-copilot/domain";
import {
  commercialPlanNeedsReview,
  currentCommercialWeek,
  type CommercialPlanContext,
} from "@fl-copilot/commercial-core";
import type { CommercialWeekPlan } from "@fl-copilot/sync-contracts";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import {
  AppScreen,
  AppHeader,
  SecondaryButton,
  PrimaryButton,
  InlineAlert,
  EmptyState,
} from "@/components/ui";
import { DetailsDisclosure, IconButton } from "@/components/dashboard";
import { colors } from "@/design/tokens";
import { formatFrenchCalendarDate } from "@/dates/calendar";
import {
  CommercialPlanRepository,
  readCommercialPlanRevisions,
  type LocalCommercialPlan,
} from "@/commercial/week-plan-repository";
import {
  CommercialPreparationRepository,
  type LocalCommercialPreparation,
} from "@/commercial/week-preparation-repository";
import { readWeekPlanContext } from "@/commercial/week-plan-context";
import { CommercialPlanContent } from "@/commercial/plan-content";
import { CommercialPlanValidationView } from "@/commercial/plan-validation-view";
import { CommercialExecutionView } from "@/commercial/execution-view";
import { WeeklySubstitutesView } from "@/commercial/substitute-view";
import { commercialPlanError } from "@/commercial/plan-presentation";
import { commercialPreparationError } from "@/commercial/preparation-presentation";
const digest = (s: string) =>
  digestStringAsync(CryptoDigestAlgorithm.SHA256, s);

export default function CommercialPlanScreen() {
  const { session } = useAuth(),
    params = useLocalSearchParams<{
      weekStart?: string;
      mode?: string;
      taskId?: string;
      placementId?: string;
      draft?: string;
    }>();
  const explicit = contextWeekQuerySchema.safeParse({
    weekStart: params.weekStart,
  });
  const weekStart = explicit.success
    ? explicit.data.weekStart
    : currentCommercialWeek().start;
  const storeId = session?.stores[0]?.storeId;
  return storeId ? (
    <StoreWeek
      key={`${storeId}:${session?.user.id}:${weekStart}`}
      storeId={storeId}
      weekStart={weekStart}
      initialTaskId={params.taskId}
      installationOnly={params.mode === "installation"}
      placementId={params.placementId}
      draftDetail={params.draft === "1"}
    />
  ) : (
    <AppScreen>
      <AppHeader title="Ma semaine" />
      <InlineAlert
        title="Aucun magasin actif"
        message="Reconnecte-toi pour retrouver tes choix."
      />
    </AppScreen>
  );
}
function StoreWeek({
  storeId,
  weekStart,
  initialTaskId,
  installationOnly = false,
  placementId,
  draftDetail = false,
}: {
  storeId: string;
  weekStart: string;
  initialTaskId?: string;
  installationOnly?: boolean;
  placementId?: string;
  draftDetail?: boolean;
}) {
  const { sqlite } = useLocalDatabase(),
    { status, lastSyncedAt } = useSync();
  const week = useMemo(
    () => currentCommercialWeek(new Date(`${weekStart}T12:00:00Z`)),
    [weekStart],
  );
  const plans = useMemo(
    () => new CommercialPlanRepository(sqlite, digest),
    [sqlite],
  );
  const preparations = useMemo(
    () => new CommercialPreparationRepository(sqlite, digest),
    [sqlite],
  );
  const [snapshot, setSnapshot] = useState<{
    plan: LocalCommercialPlan | null;
    draft: LocalCommercialPreparation | null;
    context?: CommercialPlanContext;
  }>();
  const [error, setError] = useState<string>(),
    [retry, setRetry] = useState(0),
    [review, setReview] = useState(false);
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) return;
    let active = true;
    void (async () => {
      const [plan, draft] = await Promise.all([
        plans.get(storeId, weekStart),
        preparations.get(storeId, weekStart),
      ]);
      const context = plan
        ? await readWeekPlanContext(sqlite, plan.entity.preparation)
        : undefined;
      if (active) {
        setSnapshot({ plan, draft, context });
        setError(undefined);
      }
    })().catch(() => {
      if (active)
        setError(
          "Les choix de la semaine n’ont pas pu être relus. Réessaie sans modifier tes données.",
        );
    });
    return () => {
      active = false;
    };
  }, [
    plans,
    preparations,
    sqlite,
    storeId,
    weekStart,
    status,
    lastSyncedAt,
    retry,
    focused,
  ]);

  const plan = snapshot?.plan,
    draft = snapshot?.draft;
  const draftAhead =
    !!draft &&
    (!plan || draft.entity.version > plan.entity.preparation.version);
  const issues =
    plan && snapshot?.context
      ? commercialPlanNeedsReview(plan.entity, snapshot.context)
      : [];
  const navigate = (
    pathname:
      "/week-preparation" | "/commercial-documents" | "/commercial-plan",
  ) => router.push({ pathname, params: { weekStart } });
  const openPlacement = (id: string, draft = false) =>
    router.push({
      pathname: "/commercial-plan",
      params: { weekStart, placementId: id, ...(draft ? { draft: "1" } : {}) },
    });
  const returnToWeek = () =>
    router.canGoBack()
      ? router.back()
      : router.replace({ pathname: "/commercial-plan", params: { weekStart } });
  const detail = Boolean(placementId || installationOnly);
  const header = (
    <View className="flex-row items-center gap-3 border-b border-line px-4 py-2">
      <IconButton
        label={detail ? "Retour à ma semaine" : "Retour"}
        icon="chevron-back"
        onPress={
          detail
            ? returnToWeek
            : () =>
                router.canGoBack()
                  ? router.back()
                  : router.replace("/(tabs)/today")
        }
      />
      <Text className="flex-1 text-base font-semibold text-ink">
        {detail ? "Ma semaine" : `Semaine ${week.number}`}
      </Text>
    </View>
  );
  if (placementId && draftDetail) {
    const selected = draft?.entity.placements.find((p) => p.id === placementId);
    return (
      <AppScreen header={header}>
        {!snapshot ? (
          <Text className="text-muted">Lecture de ton brouillon…</Text>
        ) : selected ? (
          <>
            <Text className="text-sm font-semibold text-muted">
              Aperçu du brouillon
            </Text>
            <TgPresentationView placements={[selected]} layout="detail" />
            <SecondaryButton
              label="Modifier les choix"
              onPress={() => navigate("/week-preparation")}
            />
          </>
        ) : (
          <InlineAlert
            title="TG introuvable"
            message="Cette TG ne figure plus dans ton brouillon. Reviens à ta semaine pour retrouver tes choix."
          />
        )}
        {error ? (
          <InlineAlert title="Lecture interrompue" message={error} />
        ) : null}
      </AppScreen>
    );
  }
  if (detail && plan)
    return (
      <CommercialExecutionView
        key={plan.entity.revisionId}
        plan={plan.entity}
        initialTaskId={initialTaskId}
        placementId={placementId}
        presentation="placement"
        renderDetail={(content, action) => (
          <AppScreen header={header} footer={action}>
            {content}
            <DetailsDisclosure title="Sources et repères de la semaine">
              <CommercialPlanContent plan={plan.entity} />
            </DetailsDisclosure>
          </AppScreen>
        )}
      />
    );
  return (
    <AppScreen header={header}>
      <View className="flex-row items-center gap-4 py-2">
        <View className="flex-1 gap-2">
          <Text className="text-xs uppercase tracking-widest text-muted">
            Semaine {week.number} · {week.year}
          </Text>
          <Text
            accessibilityRole="header"
            style={{
              color: colors.ink,
              fontSize: 34,
              fontWeight: "600",
              letterSpacing: -1.2,
            }}
          >
            Ma semaine.
          </Text>
          <Text className="text-sm text-muted">
            {formatFrenchCalendarDate(week.start)} au{" "}
            {formatFrenchCalendarDate(week.end)}
          </Text>
        </View>
        <View
          className="items-center gap-1 rounded-2xl border border-line bg-surface px-4 py-3"
          style={{ transform: [{ rotate: "5deg" }] }}
        >
          <Text style={{ fontSize: 24, color: colors.ink, fontWeight: "600" }}>
            {week.number}
          </Text>
          <Text className="text-xs text-muted">SEM.</Text>
        </View>
      </View>
      {error ? (
        <>
          <InlineAlert title="Lecture interrompue" message={error} />
          <SecondaryButton
            label="Réessayer la lecture"
            onPress={() => setRetry((n) => n + 1)}
          />
        </>
      ) : null}
      {!snapshot ? (
        <Text className="text-muted">Lecture de ta semaine…</Text>
      ) : draftAhead && draft ? (
        <>
          <Text className="text-sm font-semibold text-forest">
            Brouillon enregistré{plan ? " · Nouveaux choix à confirmer" : ""}
          </Text>
          {draft.syncState === "CONFLICT" || draft.syncState === "ERROR" ? (
            <InlineAlert
              title="Brouillon à vérifier"
              message={
                draft.syncState === "CONFLICT"
                  ? "Deux versions doivent être comparées dans Synchronisation."
                  : commercialPreparationError(draft.lastErrorCode ?? undefined)
              }
            />
          ) : null}
          <TgPresentationView
            placements={draft.entity.placements}
            layout="cards"
            onOpenPlacement={(id) => openPlacement(id, true)}
            renderFooter={() => (
              <Text className="text-sm text-muted">Choix à confirmer</Text>
            )}
          />
          {draft.entity.note ? (
            <DetailsDisclosure title="Consignes de la semaine">
              <Text selectable className="text-base text-ink">
                {draft.entity.note}
              </Text>
            </DetailsDisclosure>
          ) : null}
          {draft.entity.offerRefs.length ? (
            <Text className="text-sm text-muted">
              {draft.entity.offerRefs.length} offres sélectionnées · détails
              dans la modification ou le récapitulatif de confirmation.
            </Text>
          ) : null}
          <SecondaryButton
            label="Modifier les choix"
            onPress={() => navigate("/week-preparation")}
          />
          {draft.syncState === "CONFLICT" ? (
            <SecondaryButton
              label="Comparer dans Synchronisation"
              onPress={() => router.push("/sync-center")}
            />
          ) : review ? (
            <CommercialPlanValidationView
              preparation={draft.entity}
              unsavedChanges={false}
              onConfirmed={() => {
                setReview(false);
                setRetry((n) => n + 1);
              }}
            />
          ) : (
            <PrimaryButton
              label="Confirmer ces choix"
              onPress={() => setReview(true)}
            />
          )}
          {plan ? (
            <DetailsDisclosure title="Voir les choix déjà confirmés">
              <CommercialPlanContent plan={plan.entity} />
            </DetailsDisclosure>
          ) : null}
        </>
      ) : plan ? (
        <>
          <CommercialExecutionView
            plan={plan.entity}
            initialTaskId={initialTaskId}
            presentation="week"
            onOpenPlacement={(id) => openPlacement(id)}
          />
          <DetailsDisclosure title="Sources, offres et consignes">
            <CommercialPlanContent plan={plan.entity} />
          </DetailsDisclosure>
          <SecondaryButton
            label={
              plan.syncState === "CONFLICT"
                ? "Comparer dans Synchronisation"
                : "Modifier les choix"
            }
            onPress={() =>
              plan.syncState === "CONFLICT"
                ? router.push("/sync-center")
                : navigate("/week-preparation")
            }
          />
        </>
      ) : (
        <>
          <EmptyState
            title="Ta semaine reste à préparer"
            message="Discute de ton pense-bête avec le copilote. Les choix que tu enregistres apparaîtront ici, même avant leur confirmation."
          />
          <PrimaryButton
            label="Choisir mon pense-bête"
            onPress={() => navigate("/commercial-documents")}
          />
          <SecondaryButton
            label="Préparer manuellement"
            onPress={() => navigate("/week-preparation")}
          />
        </>
      )}
      {plan ? (
        <>
          {plan.syncState === "ERROR" ? (
            <InlineAlert
              title="Synchronisation à reprendre"
              message={commercialPlanError(plan.lastErrorCode ?? undefined)}
            />
          ) : null}
          {issues.map((issue, i) => (
            <Text key={i} accessibilityRole="alert" className="text-danger">
              {issue.messageFr}
            </Text>
          ))}
        </>
      ) : null}
      {plan ? (
        <>
          {draftAhead && initialTaskId ? (
            <CommercialExecutionView
              plan={plan.entity}
              initialTaskId={initialTaskId}
              presentation="week"
              onOpenPlacement={(id) => openPlacement(id)}
            />
          ) : draftAhead ? (
            <DetailsDisclosure title="Suivre le plan déjà confirmé">
              <CommercialExecutionView
                plan={plan.entity}
                initialTaskId={initialTaskId}
                presentation="week"
                onOpenPlacement={(id) => openPlacement(id)}
              />
            </DetailsDisclosure>
          ) : null}
          <DetailsDisclosure title="Alternatives et contre-promos">
            <WeeklySubstitutesView
              storeId={storeId}
              weekStart={weekStart}
              plan={plan.entity}
            />
          </DetailsDisclosure>
          <DetailsDisclosure title="Historique des choix">
            <PlanHistory plan={plan.entity} />
          </DetailsDisclosure>
        </>
      ) : null}
    </AppScreen>
  );
}
/** Mounted only when requested: archived versions never replace current execution. */
function PlanHistory({ plan }: { plan: CommercialWeekPlan }) {
  const { sqlite } = useLocalDatabase();
  const [revisions, setRevisions] =
    useState<Awaited<ReturnType<typeof readCommercialPlanRevisions>>>();
  const [archive, setArchive] = useState<CommercialWeekPlan>(),
    [failed, setFailed] = useState(false);
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) return;
    let active = true;
    void readCommercialPlanRevisions(sqlite, plan.storeId, plan.id)
      .then((rows) => {
        if (active) {
          setRevisions(rows);
          setFailed(false);
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [sqlite, plan.storeId, plan.id, plan.version, focused]);
  return (
    <View className="gap-3">
      {failed ? (
        <Text className="text-danger">L’historique ne peut pas être relu.</Text>
      ) : !revisions ? (
        <Text className="text-muted">Lecture de l’historique…</Text>
      ) : !revisions.length ? (
        <Text className="text-muted">
          L’historique sera disponible après synchronisation.
        </Text>
      ) : (
        revisions.map((r) => (
          <SecondaryButton
            key={r.id}
            label={`Version ${r.plan.version} · ${new Date(r.plan.validatedAt).toLocaleString("fr-FR")}`}
            onPress={() => setArchive(r.plan)}
          />
        ))
      )}
      {archive ? (
        <>
          <Text className="text-muted">
            Version {archive.version} · consultation uniquement
          </Text>
          <CommercialPlanContent plan={archive} review />
          <SecondaryButton
            label="Fermer cette version"
            onPress={() => setArchive(undefined)}
          />
        </>
      ) : null}
    </View>
  );
}
