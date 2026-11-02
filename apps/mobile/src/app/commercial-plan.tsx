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
  SectionCard,
  SecondaryButton,
  PrimaryButton,
  InlineAlert,
  EmptyState,
} from "@/components/ui";
import { DetailsDisclosure } from "@/components/dashboard";
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
    params = useLocalSearchParams<{ weekStart?: string }>();
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
}: {
  storeId: string;
  weekStart: string;
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
  const navigate = (pathname: "/week-preparation" | "/week") =>
    router.push({ pathname, params: { weekStart } });
  return (
    <AppScreen>
      <AppHeader
        title={`Ma semaine ${week.number} · ${week.year}`}
        subtitle={`Du ${formatFrenchCalendarDate(week.start)} au ${formatFrenchCalendarDate(week.end)}`}
      />
      <SecondaryButton
        label="Retour"
        onPress={() =>
          router.canGoBack() ? router.back() : router.replace("/(tabs)/actions")
        }
      />
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
          <Text className="text-sm text-muted">
            Tes choix sont conservés. Confirme-les quand ils sont prêts pour le
            rayon.
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
          {draft.entity.placements.map((tg) => (
            <SectionCard key={tg.id} title={tg.label}>
              <Text selectable className="text-base text-ink">
                {tg.theme || "Thème à préciser"}
              </Text>
            </SectionCard>
          ))}
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
          <Text className="font-semibold text-forest">Choix confirmés</Text>
          <CommercialPlanContent plan={plan.entity} />
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
            onPress={() => navigate("/week")}
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
          <CommercialExecutionView plan={plan.entity} />
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
