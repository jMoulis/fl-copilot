import { formatFrenchCalendarDate } from "@/dates/calendar";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Alert, Switch, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import {
  CryptoDigestAlgorithm,
  digestStringAsync,
  randomUUID,
} from "expo-crypto";
import { ApiClient } from "@fl-copilot/api-client";
import { contextWeekQuerySchema } from "@fl-copilot/domain";
import { currentCommercialWeek } from "@fl-copilot/commercial-core";
import type {
  CommercialProcessingReview,
  CommercialWeekPreparation,
} from "@fl-copilot/sync-contracts";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import { getApiBaseUrl } from "@/config/environment";
import { CommercialPreparationRepository } from "@/commercial/week-preparation-repository";
import { CommercialAnalysisRecoveryRepository } from "@/documents/commercial-analysis-recovery";
import {
  restartCommercialPreparation,
  restoreResetPreparation,
  canRestoreResetPreparation,
} from "@/commercial/restart-preparation";
import {
  AppScreen,
  AppHeader,
  SectionCard,
  PrimaryButton,
  SecondaryButton,
  InlineAlert,
} from "@/components/ui";
const digest = (text: string) =>
  digestStringAsync(CryptoDigestAlgorithm.SHA256, text);
type Source = { id: string; original_filename: string | null };
export default function CommercialRestartScreen() {
  const { session, withAccessToken } = useAuth(),
    { sqlite, deviceId } = useLocalDatabase(),
    { syncNow } = useSync();
  const params = useLocalSearchParams<{
    sourceDocumentId?: string;
    weekStart?: string;
  }>();
  const store = session?.stores[0];
  if (!store || !session)
    return (
      <AppScreen>
        <InlineAlert
          title="Préparation indisponible"
          message="Reconnectez-vous à votre magasin."
        />
      </AppScreen>
    );
  return (
    <RestartForm
      key={`${session.user.id}/${store.storeId}/${store.role}/${deviceId}/${params.weekStart ?? ""}/${params.sourceDocumentId ?? ""}`}
      db={sqlite}
      deviceId={deviceId}
      storeId={store.storeId}
      ownerId={session.user.id}
      canChange={store.role === "MANAGER"}
      initialWeek={
        typeof params.weekStart === "string" ? params.weekStart : undefined
      }
      sourceId={
        typeof params.sourceDocumentId === "string"
          ? params.sourceDocumentId
          : undefined
      }
      read={(id) =>
        withAccessToken((token) =>
          new ApiClient(getApiBaseUrl()).commercialProcessing(
            token,
            store.storeId,
            id,
          ),
        )
      }
      sync={() => syncNow(store.storeId)}
    />
  );
}
export function RestartForm({
  db,
  deviceId,
  storeId,
  ownerId,
  canChange,
  initialWeek,
  sourceId,
  read,
  sync,
}: {
  db: ConstructorParameters<typeof CommercialPreparationRepository>[0];
  deviceId: string;
  storeId: string;
  ownerId: string;
  canChange: boolean;
  initialWeek?: string;
  sourceId?: string;
  read(id: string): Promise<CommercialProcessingReview>;
  sync(): Promise<unknown>;
}) {
  const [weekStart, setWeekStart] = useState(() => {
    const checked = contextWeekQuerySchema.safeParse({
      weekStart: initialWeek,
    });
    return checked.success
      ? checked.data.weekStart
      : currentCommercialWeek().start;
  });
  const week = currentCommercialWeek(new Date(`${weekStart}T12:00:00Z`));
  const repo = useMemo(
    () => new CommercialPreparationRepository(db, digest),
    [db],
  );
  const [sources, setSources] = useState<Source[]>([]),
    [selected, setSelected] = useState(sourceId ?? ""),
    [previous, setPrevious] = useState<CommercialWeekPreparation | null>(null),
    [resetDraft, setResetDraft] = useState(true),
    [choosingSource, setChoosingSource] = useState(!sourceId),
    [sourceQuery, setSourceQuery] = useState(""),
    [sourcePage, setSourcePage] = useState(0),
    [undo, setUndo] = useState<CommercialWeekPreparation | null>(null),
    [reanalyze, setReanalyze] = useState(true),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [notice, setNotice] = useState<string>();
  const live = useRef(true),
    allowed = useRef(canChange),
    locked = useRef(false),
    cancellation = useRef<AbortController | undefined>(undefined);
  const scope = useMemo(
    () => ({ db, storeId, ownerId, deviceId }),
    [db, storeId, ownerId, deviceId],
  );
  const currentScope = useRef(scope);
  const current = () => live.current && currentScope.current === scope;
  allowed.current = canChange;
  useLayoutEffect(() => {
    currentScope.current = scope;
    live.current = true;
    return () => {
      live.current = false;
      cancellation.current?.abort();
    };
  }, [scope]);
  useEffect(() => {
    let active = true;
    setLoaded(false);
    setNotice(undefined);
    setError(undefined);
    setUndo(null);
    void Promise.all([
      repo.get(storeId, weekStart),
      db.getAllAsync<Source>(
        "SELECT id, original_filename FROM source_documents WHERE store_id=? AND source_type='WEEKLY_COMMERCIAL_PDF' AND deleted_at IS NULL ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END,created_at DESC,id LIMIT 100",
        storeId,
        sourceId ?? "",
      ),
    ])
      .then(async ([record, docs]) => {
        const restorable =
          record && (await canRestoreResetPreparation(db, record.entity));
        if (!active) return;
        setUndo(restorable ? record.entity : null);
        setPrevious(record?.entity ?? null);
        setSources(docs);
        setLoaded(true);
      })
      .catch(() => {
        if (active)
          setError(
            "La préparation ne peut pas être lue. Revenez à la semaine puis réessayez.",
          );
      });
    return () => {
      active = false;
    };
  }, [db, repo, storeId, weekStart, sourceId]);
  const confirmationKey = useRef("");
  confirmationKey.current = JSON.stringify([
    weekStart,
    selected,
    resetDraft,
    reanalyze,
  ]);
  const source = sources.find((s) => s.id === selected);
  function moveWeek(offset: number) {
    const date = new Date(`${weekStart}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    setWeekStart(date.toISOString().slice(0, 10));
  }
  async function review() {
    if (
      !current() ||
      locked.current ||
      !allowed.current ||
      !loaded ||
      (!resetDraft && !reanalyze)
    )
      return;
    if (reanalyze && !source) {
      setError("Choisissez le PDF à analyser à nouveau.");
      return;
    }
    locked.current = true;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const reviewedKey = confirmationKey.current;
      let analysis: CommercialProcessingReview | undefined;
      if (reanalyze) {
        analysis = await read(selected);
        if (!current() || confirmationKey.current !== reviewedKey) return;
        if (analysis.sourceDocumentId !== selected || !analysis.canRestart)
          throw Error("ANALYSIS_UNAVAILABLE");
        await new CommercialAnalysisRecoveryRepository(db, randomUUID).save(
          storeId,
          selected,
          analysis,
        );
      }
      if (
        !current() ||
        !allowed.current ||
        confirmationKey.current !== reviewedKey
      )
        return;
      const snapshot = previous,
        reset = resetDraft,
        controller = new AbortController();
      cancellation.current = controller;
      Alert.alert(
        "Recommencer cette préparation ?",
        `Semaine ${week.number} · ${week.year}, du ${formatFrenchCalendarDate(week.start)} au ${formatFrenchCalendarDate(week.end)}.\n\n` +
          (reset
            ? `Le brouillon sera vidé : ${snapshot?.offerRefs.length ?? 0} choix, ${snapshot?.placements.length ?? 0} TG, notes et implantation. Sa version précédente restera dans l’historique.\n\n`
            : "") +
          (analysis
            ? `Nouvelle analyse de « ${source!.original_filename ?? "PDF sélectionné"} ». Elle consomme des crédits IA. Les résultats précédents restent disponibles pendant le traitement.\n\n`
            : "") +
          "L’original, les plans validés et les réalisations sont conservés.",
        [
          { text: "Annuler", style: "cancel" },
          {
            text: "Confirmer",
            style: "destructive",
            onPress: () =>
              void confirm(snapshot, reset, analysis, controller, reviewedKey),
          },
        ],
      );
    } catch {
      if (current())
        setError(
          "Cette analyse ne peut pas être relancée maintenant : vérifiez l’envoi du PDF, la connexion et l’état de son analyse. Aucun brouillon n’a été modifié.",
        );
    } finally {
      locked.current = false;
      if (current()) setBusy(false);
    }
  }
  async function confirm(
    snapshot: CommercialWeekPreparation | null,
    reset: boolean,
    analysis: CommercialProcessingReview | undefined,
    controller: AbortController,
    reviewedKey: string,
  ) {
    if (
      !current() ||
      locked.current ||
      !allowed.current ||
      confirmationKey.current !== reviewedKey
    )
      return;
    locked.current = true;
    setBusy(true);
    try {
      const cleared = await restartCommercialPreparation(
        db,
        digest,
        randomUUID,
        {
          context: {
            storeId,
            ownerId,
            deviceId,
            weekStart,
            canChange: () =>
              current() &&
              allowed.current &&
              confirmationKey.current === reviewedKey &&
              !controller.signal.aborted,
            signal: controller.signal,
          },
          previous: snapshot,
          resetDraft: reset,
          analysis,
        },
      );
      if (!current()) return;
      if (reset) {
        setPrevious(cleared);
        setUndo(cleared);
      }
      setNotice(
        `${reset ? "Le brouillon est vide ; sa version précédente est conservée. " : ""}${analysis ? "La demande de nouvelle analyse est enregistrée sur cet appareil, en attente de transmission et d’acceptation par le service." : ""}`,
      );
      void sync()
        .then(async () => {
          if (!analysis) return;
          const latest = await new CommercialAnalysisRecoveryRepository(
            db,
            randomUUID,
          ).latest(storeId, ownerId, analysis.sourceDocumentId);
          if (!current() || confirmationKey.current !== reviewedKey || !latest)
            return;
          const payload: unknown = JSON.parse(latest.payload_json);
          if (
            !payload ||
            typeof payload !== "object" ||
            !("basisHash" in payload) ||
            payload.basisHash !== analysis.basisHash
          )
            return;
          if (latest.status === "COMPLETED")
            setNotice(
              `${reset ? "Le brouillon est vide et sa version précédente est conservée. " : ""}La demande d’analyse a été transmise au service. Le traitement peut encore être en attente ; consulte le suivi du PDF pour voir les résultats.`,
            );
          else if (latest.status === "FAILED") {
            setNotice(undefined);
            setError(
              `La nouvelle analyse n’a pas été acceptée. Actualise le suivi du PDF avant de réessayer.${reset ? " Le brouillon a été vidé ; tu peux restaurer sa version précédente ci-dessous." : " Le brouillon est conservé."}`,
            );
          }
        })
        .catch(() => undefined);
    } catch {
      if (current())
        setError(
          "La préparation ou l’état de l’analyse a changé. Revenez à la semaine puis recommencez ; aucune remise à zéro partielle n’a été appliquée.",
        );
    } finally {
      locked.current = false;
      if (current()) setBusy(false);
    }
  }
  async function restore(
    expected: CommercialWeekPreparation,
    reviewedKey: string,
  ) {
    if (
      !current() ||
      locked.current ||
      !allowed.current ||
      confirmationKey.current !== reviewedKey
    )
      return;
    locked.current = true;
    setBusy(true);
    try {
      const restored = await restoreResetPreparation(
        db,
        digest,
        randomUUID,
        {
          storeId,
          ownerId,
          deviceId,
          weekStart,
          canChange: () =>
            current() &&
            allowed.current &&
            confirmationKey.current === reviewedKey,
        },
        expected,
      );
      if (!current()) return;
      setPrevious(restored);
      setUndo(null);
      setNotice(
        "Le brouillon précédent a été restauré. Une analyse déjà demandée continue séparément.",
      );
      void sync().catch(() => undefined);
    } catch {
      if (current())
        setError(
          "Le brouillon a changé depuis la remise à zéro. Relisez la préparation avant de la modifier.",
        );
    } finally {
      locked.current = false;
      if (current()) setBusy(false);
    }
  }
  const matchingSources = sources.filter((doc) =>
    (doc.original_filename ?? "")
      .toLocaleLowerCase("fr-FR")
      .includes(sourceQuery.trim().toLocaleLowerCase("fr-FR")),
  );
  const visibleSources = matchingSources.slice(
    sourcePage * 8,
    sourcePage * 8 + 8,
  );
  return (
    <AppScreen>
      <AppHeader
        title="Recommencer la préparation"
        subtitle="Choisis ce que tu souhaites reprendre. Le PDF original et l’historique restent conservés."
      />
      <SecondaryButton
        label="Retour"
        disabled={busy}
        onPress={() => router.back()}
      />
      <SectionCard title={`Semaine ${week.number} · ${week.year}`}>
        <Text className="text-base text-ink">
          {formatFrenchCalendarDate(week.start)} —{" "}
          {formatFrenchCalendarDate(week.end)}
        </Text>
        <SecondaryButton
          label="Semaine précédente"
          disabled={busy}
          onPress={() => moveWeek(-7)}
        />
        <SecondaryButton
          label="Semaine suivante"
          disabled={busy}
          onPress={() => moveWeek(7)}
        />
      </SectionCard>
      <SectionCard title="Que veux-tu recommencer ?">
        <View>
          <Text className="text-base text-ink">
            Repartir d’un brouillon vide
          </Text>
          <Switch
            accessibilityLabel="Repartir d’un brouillon vide"
            value={resetDraft}
            disabled={busy || !canChange}
            onValueChange={setResetDraft}
          />
        </View>
        <Text className="text-base text-ink">
          {previous
            ? `${previous.offerRefs.length} choix · ${previous.placements.length} TG enregistrés`
            : "Aucun brouillon enregistré pour cette semaine."}
        </Text>
        <View>
          <Text className="text-base text-ink">Relancer l’analyse du PDF</Text>
          <Switch
            accessibilityLabel="Relancer l’analyse du PDF"
            value={reanalyze}
            disabled={busy || !canChange}
            onValueChange={setReanalyze}
          />
        </View>
        {reanalyze ? (
          <>
            <Text className="text-base text-ink">
              Cette action consomme des crédits IA, après confirmation.
            </Text>
            {source ? (
              <Text className="text-base text-ink">
                PDF sélectionné :{" "}
                {source.original_filename ?? "Document commercial"}
              </Text>
            ) : null}
            <SecondaryButton
              label={
                choosingSource
                  ? "Fermer le choix du PDF"
                  : "Choisir un autre PDF"
              }
              disabled={busy}
              onPress={() => setChoosingSource((v) => !v)}
            />
            {choosingSource ? (
              <>
                <TextInput
                  className="rounded-xl border border-line p-3 text-ink"
                  accessibilityLabel="Rechercher un PDF"
                  value={sourceQuery}
                  editable={!busy}
                  onChangeText={(value) => {
                    setSourceQuery(value);
                    setSourcePage(0);
                  }}
                />
                {visibleSources.map((doc) => (
                  <SecondaryButton
                    key={doc.id}
                    label={`${selected === doc.id ? "✓ " : ""}${doc.original_filename ?? "Document commercial"}`}
                    disabled={busy}
                    onPress={() => {
                      setSelected(doc.id);
                      setChoosingSource(false);
                    }}
                  />
                ))}
                <Text className="text-base text-ink">
                  {matchingSources.length} PDF parmi les 100 derniers documents.
                  Les autres restent accessibles depuis leur détail.
                </Text>
                {sourcePage > 0 ? (
                  <SecondaryButton
                    label="PDF précédents"
                    disabled={busy}
                    onPress={() => setSourcePage((p) => p - 1)}
                  />
                ) : null}
                {(sourcePage + 1) * 8 < matchingSources.length ? (
                  <SecondaryButton
                    label="PDF suivants"
                    disabled={busy}
                    onPress={() => setSourcePage((p) => p + 1)}
                  />
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
      </SectionCard>
      {error ? (
        <InlineAlert title="Reprise à vérifier" message={error} />
      ) : null}
      {notice ? (
        <Text className="text-base text-ink" accessibilityLiveRegion="polite">
          {notice}
        </Text>
      ) : null}
      {undo ? (
        <SecondaryButton
          label="Restaurer le brouillon précédent"
          disabled={busy || !canChange}
          onPress={() => {
            const reviewedKey = confirmationKey.current;
            Alert.alert(
              "Restaurer le brouillon ?",
              "La version antérieure sera rétablie si personne ne l’a modifiée depuis. Une analyse déjà demandée continuera.",
              [
                { text: "Annuler", style: "cancel" },
                {
                  text: "Restaurer",
                  onPress: () => void restore(undo, reviewedKey),
                },
              ],
            );
          }}
        />
      ) : null}
      <PrimaryButton
        label="Vérifier avant de recommencer"
        disabled={!loaded || busy || !canChange || (!resetDraft && !reanalyze)}
        onPress={() => void review()}
      />
    </AppScreen>
  );
}
