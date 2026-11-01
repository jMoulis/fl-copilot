import { CommercialTranscriptionConflict } from "@/commercial/transcription-conflict";
import {
  readCommercialChoices,
  type LocalCommercialChoice,
} from "@/commercial/offer-choice-repository";
import { readCommercialVisualReadings } from "@/commercial/visual-repository";
import { CommercialVisualView } from "@/commercial/visual-view";
import type { SynchronizedCommercialVisualReading } from "@fl-copilot/sync-contracts";
import { CommercialOriginalButton } from "@/commercial/original-button";
import { CommercialSummaryView } from "@/commercial/summary-view";
import { captureScreenError } from "@/observability/sentry";
import { buildCommercialDocumentSummary } from "@fl-copilot/commercial-core";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Alert, Text, TextInput, View } from "react-native";
import {
  router,
  useFocusEffect,
  useLocalSearchParams,
  type Href,
} from "expo-router";
import { randomUUID } from "expo-crypto";
import type { CommercialReviewPage } from "@fl-copilot/sync-contracts";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import { CommercialReviewRepository } from "@/commercial/review-repository";
import {
  commercialFieldLabels,
  commercialKindLabels,
  commercialIssueMessage,
  commercialWarningMessage,
  commercialReviewItems,
  commercialMechanismLabel,
  commercialConflictLabels,
} from "@/commercial/review-presentation";
import {
  AppScreen,
  AppHeader,
  SectionCard,
  InlineAlert,
  PrimaryButton,
  SecondaryButton,
  EmptyState,
  BottomSheet,
} from "@/components/ui";
export default function CommercialReviewScreen() {
  const { id, weekStart } = useLocalSearchParams<{
      id: string;
      weekStart?: string;
    }>(),
    { session } = useAuth(),
    { deviceId } = useLocalDatabase(),
    store = session?.stores[0];
  if (!session || !store || typeof id !== "string")
    return (
      <AppScreen>
        <InlineAlert
          title="Document indisponible"
          message="Ouvrez ce document depuis votre magasin."
        />
      </AppScreen>
    );
  return (
    <CommercialReviewContent
      key={`${session.user.id}:${store.storeId}:${store.role}:${deviceId}:${id}`}
      id={id}
      weekStart={typeof weekStart === "string" ? weekStart : undefined}
      storeId={store.storeId}
      actorId={session.user.id}
      role={store.role}
    />
  );
}
function CommercialReviewContent({
  id,
  weekStart,
  storeId,
  actorId,
  role,
}: {
  id: string;
  weekStart?: string;
  storeId: string;
  actorId: string;
  role: string;
}) {
  const { sqlite, deviceId } = useLocalDatabase();
  const { syncNow, status: syncStatus } = useSync();
  const repository = useMemo(
    () => new CommercialReviewRepository(sqlite),
    [sqlite],
  );
  const scope = useMemo(
      () => ({ repository, storeId, id, actorId, role, deviceId }),
      [repository, storeId, id, actorId, role, deviceId],
    ),
    committedScope = useRef<object | null>(null),
    active = useRef(false),
    focus = useRef(0),
    reading = useRef(0),
    lock = useRef(false),
    selectedKey = useRef<string | null>(null);
  useLayoutEffect(() => {
    committedScope.current = scope;
    return () => {
      if (committedScope.current === scope) committedScope.current = null;
    };
  }, [scope]);
  useFocusEffect(
    useCallback(() => {
      if (committedScope.current !== scope) return;
      active.current = true;
      focus.current++;
      return () => {
        active.current = false;
        focus.current++;
        reading.current++;
      };
    }, [scope]),
  );
  function currentMutation(target?: string) {
    const version = focus.current;
    return () =>
      active.current &&
      committedScope.current === scope &&
      focus.current === version &&
      (target === undefined || selectedKey.current === target);
  }
  const [pages, setPages] = useState<CommercialReviewPage[]>([]);
  const [decisions, setDecisions] = useState<
    Awaited<ReturnType<CommercialReviewRepository["decisions"]>>
  >([]);
  const [viewSummary, setViewSummary] = useState(true);
  const [visuals, setVisuals] = useState<SynchronizedCommercialVisualReading[]>(
    [],
  );
  const [offerChoices, setOfferChoices] = useState<LocalCommercialChoice[]>([]);
  const [legacy, setLegacy] = useState(false);
  const [index, setIndex] = useState(0),
    [error, setError] = useState<string>(),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(false),
    [enlarged, setEnlarged] = useState(false);
  const [changes, setChanges] = useState<Record<string, string>>({});
  const refresh = useCallback(async () => {
    if (!active.current || committedScope.current !== scope) return;
    const request = ++reading.current,
      version = focus.current;
    const current = () =>
      active.current &&
      committedScope.current === scope &&
      focus.current === version &&
      reading.current === request;
    try {
      const [p, d, visuals, offerChoices] = await Promise.all([
        repository.pages(storeId, id),
        repository.decisions(storeId, id),
        readCommercialVisualReadings(sqlite, storeId, id),
        readCommercialChoices(sqlite, storeId, id),
      ]);
      return current()
        ? { p, d, visuals, offerChoices, request, version }
        : undefined;
    } catch (reason) {
      if (current()) throw reason;
    }
  }, [repository, storeId, id, sqlite, scope]);
  const apply = useCallback(
    (data: Awaited<ReturnType<typeof refresh>>) => {
      if (
        !active.current ||
        committedScope.current !== scope ||
        !data ||
        data.request !== reading.current ||
        data.version !== focus.current
      )
        return;
      setPages(data.p);
      setDecisions(data.d);
      setVisuals(data.visuals);
      setOfferChoices(data.offerChoices);
      setLoading(false);
    },
    [scope],
  );
  useFocusEffect(
    useCallback(() => {
      let active = true;
      const load = () => {
        void refresh()
          .then((data) => {
            if (active) apply(data);
          })
          .catch((reason: unknown) => {
            if (active) {
              captureScreenError(reason, "commercial-review");
              setError(
                "Les extraits ne peuvent pas être lus sur cet appareil. Réessayez.",
              );
              setLoading(false);
            }
          });
      };
      load();
      return () => {
        active = false;
      };
    }, [refresh, apply]),
  );
  const syncPhase = useRef(syncStatus);
  useEffect(() => {
    if (syncPhase.current === syncStatus) return;
    syncPhase.current = syncStatus;
    if (!active.current || committedScope.current !== scope) return;
    void refresh()
      .then(apply)
      .catch(() => {
        if (active.current && committedScope.current === scope)
          setError(
            "Les choix n’ont pas pu être relus après la synchronisation. Les informations affichées restent conservées.",
          );
      });
  }, [syncStatus, refresh, apply, scope]);
  const items = useMemo(() => commercialReviewItems(pages), [pages]);
  const item = items[index];
  useLayoutEffect(() => {
    selectedKey.current = item?.key ?? null;
  }, [item?.key]);
  const summary = useMemo(
    () => buildCommercialDocumentSummary(pages, decisions),
    [pages, decisions],
  );
  const groups = summary.offerGroups;
  const group = item
    ? groups.find((group) =>
        group.variants.some((variant) =>
          variant.occurrences.some(
            (o) =>
              o.pageNumber === item.page.pageNumber &&
              o.sourceBlockIndex === item.block.sourceBlockIndex,
          ),
        ),
      )
    : undefined;
  const proposal = group?.variants
    .flatMap((v) => v.occurrences)
    .find(
      (o) =>
        o.pageNumber === item?.page.pageNumber &&
        o.sourceBlockIndex === item?.block.sourceBlockIndex,
    );
  useEffect(() => {
    setChanges({});
    setEditing(false);
    setError(undefined);
  }, [item?.key]);
  const choices = item
    ? decisions.filter(
        (d) =>
          d.decision.pageId === item.page.id &&
          d.decision.sourceBlockIndex === item.block.sourceBlockIndex,
      )
    : [];
  const localConflict = choices.find((d) => d.state === "CONFLICT");
  const conflictIndex = items.findIndex((x) =>
    decisions.some(
      (d) =>
        d.state === "CONFLICT" &&
        d.decision.pageId === x.page.id &&
        d.decision.sourceBlockIndex === x.block.sourceBlockIndex,
    ),
  );
  function discardEdits(move: () => void) {
    if (Object.keys(changes).length && !choices.length)
      Alert.alert(
        "Corrections non enregistrées",
        "Confirmez la transcription pour les conserver, ou continuez pour les abandonner.",
        [
          { text: "Annuler", style: "cancel" },
          { text: "Continuer", onPress: move },
        ],
      );
    else move();
  }
  function navigate(next: number) {
    discardEdits(() => setIndex(next));
  }
  function openSummaryItem(key: string) {
    const target = items.findIndex((item) => item.key === key);
    if (target < 0) return;
    setChanges({});
    setEditing(false);
    setError(undefined);
    setIndex(target);
    setViewSummary(false);
  }
  function reviewResolved() {
    const current = currentMutation();
    if (!current()) return;
    const reread = () =>
      refresh()
        .then(apply)
        .catch(() => {
          if (current())
            setError(
              "Le choix est enregistré. La relecture locale a échoué ; rouvrez le document.",
            );
        });
    void reread();
    void Promise.resolve()
      .then(() => syncNow(storeId))
      .then(reread, () => undefined);
  }
  async function afterSaved(current: () => boolean) {
    if (!current()) return;
    try {
      apply(await refresh());
    } catch {
      if (current())
        setError(
          "Le choix est enregistré. La relecture locale a échoué ; rouvrez le document.",
        );
    }
    if (current())
      void Promise.resolve()
        .then(() => syncNow(storeId))
        .catch(() => undefined);
  }
  function confirmReadable() {
    const candidates = summary.bulkEligible.slice(0, 100);
    if (!storeId || busy || !candidates.length) return;
    const current = currentMutation();
    Alert.alert(
      `Confirmer ${candidates.length} transcriptions ?`,
      "Vous confirmez ensemble les transcriptions source lisibles. Les points à clarifier restent visibles ; aucune offre, application au magasin ou TG n’est validée.",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Confirmer cette série",
          onPress: () => {
            if (!current() || lock.current) return;
            lock.current = true;
            setBusy(true);
            setError(undefined);
            void repository
              .reviewReadableGroup(
                {
                  storeId,
                  sourceDocumentId: id,
                  deviceId,
                  reviewedAt: new Date().toISOString(),
                  entries: candidates.map((item) => ({
                    pageId: item.page.id,
                    sourceBlockIndex: item.block.sourceBlockIndex,
                    id: randomUUID(),
                    commandId: randomUUID(),
                  })),
                },
                { canResolve: current },
              )
              .then(() => afterSaved(current))
              .catch(async (reason) => {
                if (!current()) return;
                captureScreenError(reason, "commercial-review");
                setError(
                  reason instanceof Error &&
                    reason.message === "COMMERCIAL_GROUP_REVIEW_UNSAFE"
                    ? "Certains choix ont changé. Relisez la synthèse ; aucun nouvel élément de cette série n’a été confirmé."
                    : "La série n’a pas pu être confirmée. Les sources et vos choix restent conservés.",
                );
                try {
                  apply(await refresh());
                } catch {
                  /* The write error remains visible. */
                }
              })
              .finally(() => {
                lock.current = false;
                if (current()) setBusy(false);
              });
          },
        },
      ],
    );
  }
  async function submit(
    decision: "CONFIRMED_TRANSCRIPTION" | "DISMISSED",
    current: () => boolean,
  ) {
    if (!current() || !item || busy || lock.current || choices.length) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await repository.review(
        {
          id: randomUUID(),
          storeId,
          pageId: item.page.id,
          sourceDocumentId: item.page.sourceDocumentId,
          sourceBlockIndex: item.block.sourceBlockIndex,
          checksum: item.page.checksum,
          decision,
          corrections:
            decision === "DISMISSED"
              ? []
              : item.block.fields
                  .filter(
                    (f, i, fields) =>
                      fields.findIndex((other) => other.name === f.name) ===
                        i &&
                      changes[f.name] !== undefined &&
                      changes[f.name] !== (f.rawValue ?? ""),
                  )
                  .map((f) => ({
                    name: f.name,
                    value: changes[f.name]!.trim() || null,
                  })),
          reviewedAt: new Date().toISOString(),
        },
        deviceId,
        randomUUID(),
        { canResolve: current },
      );
      if (current()) setEditing(false);
      await afterSaved(current);
    } catch (reason) {
      if (current()) {
        captureScreenError(reason, "commercial-review");
        setError(
          "Votre choix n’a pas pu être enregistré. L’extrait et vos corrections restent conservés.",
        );
      }
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  }
  function confirm(decision: "CONFIRMED_TRANSCRIPTION" | "DISMISSED") {
    const current = currentMutation(item?.key);
    Alert.alert(
      decision === "DISMISSED"
        ? "Écarter cet élément ?"
        : "Confirmer cette transcription ?",
      decision === "DISMISSED"
        ? "La source reste conservée. Cet élément sera écarté de l’examen commercial."
        : "Vous confirmez les informations lues ou corrigées. Cela ne publie aucune offre et ne valide pas son application au magasin.",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: decision === "DISMISSED" ? "Écarter" : "Confirmer",
          onPress: () => void submit(decision, current),
        },
      ],
    );
  }
  return (
    <AppScreen key={viewSummary ? "summary" : (item?.key ?? "pending")}>
      <AppHeader
        title={viewSummary ? "Synthèse commerciale" : "Consulter un extrait"}
        subtitle={pages[0]?.originalFilename ?? "Communication commerciale"}
      />
      <SecondaryButton
        label="Retour aux documents"
        onPress={() =>
          discardEdits(() =>
            router.replace(
              weekStart
                ? { pathname: "/week", params: { weekStart } }
                : ("/week" as Href),
            ),
          )
        }
      />
      <CommercialOriginalButton sourceDocumentId={id} />
      {role === "MANAGER" ? (
        <SecondaryButton
          label="Recommencer à partir de ce PDF"
          onPress={() =>
            discardEdits(() =>
              router.push({
                pathname: "/commercial-restart",
                params: {
                  sourceDocumentId: id,
                  ...(weekStart ? { weekStart } : {}),
                },
              }),
            )
          }
        />
      ) : null}

      {error ? (
        <InlineAlert title="Examen indisponible" message={error} />
      ) : null}
      {loading ? (
        <InlineAlert
          title="Lecture locale…"
          message="Chargement des extraits enregistrés sur cet appareil."
        />
      ) : null}
      {!loading && !pages.length ? (
        <EmptyState
          title="Analyse en attente"
          message="Synchronisez après l’analyse du document. Les extraits seront ensuite disponibles hors connexion."
          icon="document-text-outline"
        />
      ) : null}
      {viewSummary && visuals.length && !legacy ? (
        <>
          <CommercialVisualView
            readings={visuals}
            choices={offerChoices}
            initialWeekStart={weekStart}
          />
          <SecondaryButton
            label="Consulter les extraits et choix précédents"
            onPress={() => setLegacy(true)}
          />
        </>
      ) : null}
      {viewSummary && legacy && visuals.length ? (
        <SecondaryButton
          label="Revenir à la lecture visuelle"
          onPress={() => setLegacy(false)}
        />
      ) : null}
      {pages.length && viewSummary && (!visuals.length || legacy) ? (
        <CommercialSummaryView
          summary={summary}
          busy={busy}
          decisions={decisions}
          onOpen={openSummaryItem}
          onConfirmReadable={confirmReadable}
        />
      ) : null}
      {!viewSummary ? (
        <SecondaryButton
          label="Retour à la synthèse"
          disabled={busy}
          onPress={() =>
            discardEdits(() => {
              setChanges({});
              setEditing(false);
              setViewSummary(true);
            })
          }
        />
      ) : null}
      {conflictIndex >= 0 ? (
        <SecondaryButton
          label="Examiner le choix en conflit"
          onPress={() => {
            setViewSummary(false);
            navigate(conflictIndex);
          }}
        />
      ) : null}
      {item && !viewSummary ? (
        <>
          <SectionCard
            title={`Extrait source · page ${item.page.pageNumber} sur ${item.page.pageCount}`}
            description="Texte cité dans le PDF. Consultez l’original si sa mise en page est nécessaire pour lever un doute."
          >
            {item.block.evidence.map((e, i) => (
              <Text key={i} selectable className="text-base leading-6 text-ink">
                Page {e.pageNumber} · {e.quote}
              </Text>
            ))}
            <SecondaryButton
              label="Agrandir l’extrait"
              onPress={() => setEnlarged(true)}
            />
          </SectionCard>
          <SectionCard
            title={item.block.label}
            description={`${commercialKindLabels[item.block.kind]} · élément ${index + 1} sur ${items.length}`}
          >
            {proposal?.mechanism ? (
              <InlineAlert
                title="Mécanisme proposé"
                message={commercialMechanismLabel(proposal.mechanism)}
              />
            ) : item.block.kind === "OFFER" ? (
              <InlineAlert
                title="Mécanisme à préciser"
                message="Les informations extraites ne suffisent pas à établir le mécanisme. Confirmer la transcription ne valide pas l’offre."
              />
            ) : null}
            {group?.conflicts.map((code) => (
              <InlineAlert
                key={code}
                title="Rapprochement à examiner"
                message={
                  commercialConflictLabels[code] ??
                  "Ces variantes restent à examiner."
                }
              />
            ))}
            {group?.variants.some((v) => v.occurrences.length > 1) ? (
              <Text className="text-sm text-muted">
                Cette proposition apparaît plusieurs fois dans le document. Ses
                références restent conservées ensemble.
              </Text>
            ) : null}
            {item.issues.map((issue, i) => (
              <InlineAlert
                key={i}
                title={
                  issue.fieldName
                    ? (commercialFieldLabels[issue.fieldName] ??
                      "Champ à vérifier")
                    : "À vérifier"
                }
                message={commercialIssueMessage(issue.code)}
              />
            ))}
            {item.page.warnings.map((warning, i) => (
              <InlineAlert
                key={i}
                title="Point à vérifier sur cette page"
                message={commercialWarningMessage(warning)}
              />
            ))}
            {item.block.fields.map((field, i) => {
              const correction = (
                localConflict ??
                choices.find((choice) => choice.state === "SYNCED") ??
                choices[0]
              )?.decision.corrections.find((c) => c.name === field.name);
              const multiple =
                item.block.fields.filter((f) => f.name === field.name).length >
                1;
              return (
                <View key={`${field.name}:${i}`} className="gap-2">
                  <Text className="font-semibold text-ink">
                    {commercialFieldLabels[field.name]}
                  </Text>
                  <Text selectable className="text-base text-muted">
                    {field.rawValue ?? "Non extrait"}
                  </Text>
                  {correction ? (
                    <Text className="text-base text-forest">
                      Correction saisie : {correction.value ?? "Valeur retirée"}
                    </Text>
                  ) : null}
                  {editing && !multiple ? (
                    <TextInput
                      accessibilityLabel={`Corriger ${commercialFieldLabels[field.name]}`}
                      value={changes[field.name] ?? field.rawValue ?? ""}
                      onChangeText={(value) =>
                        setChanges((old) => ({ ...old, [field.name]: value }))
                      }
                      multiline
                      maxLength={2000}
                      className="rounded-xl border border-line bg-canvas p-3 text-base text-ink"
                    />
                  ) : null}
                  {editing && multiple ? (
                    <Text className="text-sm text-muted">
                      Plusieurs identifiants sont présents. Ils restent
                      conservés séparément ; écartez l’élément si leur
                      transcription est incorrecte.
                    </Text>
                  ) : null}
                </View>
              );
            })}
            {!item.block.fields.length ? (
              <Text className="text-base text-muted">
                Aucun champ supplémentaire n’a été extrait. Examinez le libellé
                et son extrait source.
              </Text>
            ) : null}
            {!localConflict
              ? choices.map((choice) => (
                  <View key={choice.decision.id} className="gap-2">
                    <Text className="font-semibold text-ink">
                      {choice.state === "SYNCED"
                        ? "Choix synchronisé"
                        : "Votre choix local"}
                    </Text>
                    <InlineAlert
                      title={
                        choice.decision.decision === "DISMISSED"
                          ? "Élément écarté"
                          : "Transcription confirmée"
                      }
                      message={
                        choice.state === "SYNCED"
                          ? "Choix synchronisé. Aucune offre n’a été publiée."
                          : choice.state === "CONFLICT"
                            ? "Un autre choix existe sur le serveur. Comparez-les avant de résoudre le conflit."
                            : choice.state === "FAILED"
                              ? "L’enregistrement distant a échoué. Votre choix local reste conservé."
                              : "Choix enregistré sur cet appareil, à synchroniser."
                      }
                    />
                    {choice.decision.corrections.map((correction) => (
                      <Text
                        key={correction.name}
                        selectable
                        className="text-base text-ink"
                      >
                        {commercialFieldLabels[correction.name]} :{" "}
                        {correction.value ?? "Valeur retirée"}
                      </Text>
                    ))}
                  </View>
                ))
              : null}
            {localConflict ? (
              <CommercialTranscriptionConflict
                storeId={storeId}
                localId={localConflict.decision.id}
                onResolved={reviewResolved}
              />
            ) : null}
            {!choices.length ? (
              <>
                <SecondaryButton
                  label={
                    editing
                      ? "Masquer les corrections"
                      : "Corriger la transcription"
                  }
                  disabled={busy}
                  onPress={() => setEditing((value) => !value)}
                />
                <PrimaryButton
                  label={
                    busy ? "Enregistrement…" : "Confirmer la transcription"
                  }
                  loading={busy}
                  onPress={() => confirm("CONFIRMED_TRANSCRIPTION")}
                />
                <SecondaryButton
                  label="Écarter cet élément"
                  disabled={busy}
                  onPress={() => confirm("DISMISSED")}
                />
              </>
            ) : null}
          </SectionCard>
          <SecondaryButton
            label="Page précédente"
            disabled={
              busy ||
              !items.some((x) => x.page.pageNumber < item.page.pageNumber)
            }
            onPress={() => {
              const previous = items.findIndex(
                (x) =>
                  x.page.pageNumber ===
                  Math.max(
                    ...items
                      .filter((x) => x.page.pageNumber < item.page.pageNumber)
                      .map((x) => x.page.pageNumber),
                  ),
              );
              if (previous >= 0) navigate(previous);
            }}
          />
          <SecondaryButton
            label="Page suivante"
            disabled={
              busy ||
              !items.some((x) => x.page.pageNumber > item.page.pageNumber)
            }
            onPress={() => {
              const next = items.findIndex(
                (x) => x.page.pageNumber > item.page.pageNumber,
              );
              if (next >= 0) navigate(next);
            }}
          />
          <SecondaryButton
            label="Extrait précédent"
            disabled={index === 0 || busy}
            onPress={() => navigate(index - 1)}
          />
          <PrimaryButton
            label="Extrait suivant"
            disabled={index >= items.length - 1 || busy}
            onPress={() => navigate(index + 1)}
          />
        </>
      ) : null}
      {!loading && pages.length && !items.length ? (
        <EmptyState
          title="Aucun élément extrait"
          message="Le document ne contient aucun élément exploitable. L’original reste conservé."
          icon="document-text-outline"
        />
      ) : null}
      <BottomSheet
        visible={enlarged && !!item}
        title="Extrait source"
        onClose={() => setEnlarged(false)}
      >
        {item?.block.evidence.map((e, i) => (
          <Text key={i} selectable className="text-2xl leading-9 text-ink">
            Page {e.pageNumber} · {e.quote}
          </Text>
        ))}
      </BottomSheet>
    </AppScreen>
  );
}
