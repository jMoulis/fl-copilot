import { Stack, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { BackHandler, Text, View } from "react-native";
import {
  storeLayoutSchema,
  type StoreLayoutContent,
  type StoreLayout,
  isLayoutDraft,
} from "@fl-copilot/domain";
import {
  AppHeader,
  BottomSheet,
  EmptyState,
  InlineAlert,
  PrimaryButton,
  SecondaryButton,
  SectionCard,
  StatusBadge,
} from "../components/ui";
import type { SyncConflict } from "../sync/conflict-repository";
import type { StoreLayoutRepository } from "./layout-repository";
import { StoreLayoutMap } from "./layout-map";
import { StoreLayoutElementSheet } from "./layout-element-sheet";
import {
  initialLayoutViewport,
  layoutChanges,
  layoutError,
  layoutMeasurementLabel,
  patchLayoutEdit,
  undoLayoutEdit,
  visibleLayout,
  type LayoutEdit,
} from "./layout-view-model";
export type LayoutSnapshot = {
  head: Awaited<ReturnType<StoreLayoutRepository["get"]>>;
  reference: StoreLayout | null;
  conflicts: SyncConflict[];
};
export type LayoutAction = {
  action:
    "SAVE_DRAFT" | "ADOPT_REFERENCE" | "DISCARD_DRAFT" | "RESTORE_AS_DRAFT";
  expectedRevisionId: string | null;
  content?: StoreLayoutContent;
  restoredFromRevisionId?: string;
};
type RevisionPage = Awaited<ReturnType<StoreLayoutRepository["history"]>>;
type Review = {
  kind: "ADOPT" | "RESTORE" | "REBASE";
  expectedRevisionId: string;
  before: StoreLayoutContent | null;
  after: StoreLayoutContent;
  sourceId?: string;
};
export function LayoutComparison({
  before,
  after,
}: {
  before: StoreLayoutContent | null;
  after: StoreLayoutContent;
}) {
  const changes = layoutChanges(before, after),
    [expanded, setExpanded] = useState(false),
    shown = expanded ? changes : changes.slice(0, 12);
  return (
    <View style={{ gap: 14 }}>
      <Text className="text-base text-ink">
        {changes.length
          ? `${changes.length} modification${changes.length > 1 ? "s" : ""}`
          : "Aucune différence de contenu"}
      </Text>
      {shown.map((c) => (
        <View key={c.key} className="gap-1 rounded-xl bg-canvas p-3">
          <Text className="font-semibold text-ink">{c.label}</Text>
          <Text className="text-muted">Avant : {c.before}</Text>
          <Text className="text-ink">Après : {c.after}</Text>
        </View>
      ))}
      {!expanded && changes.length > 12 ? (
        <SecondaryButton
          label={`Afficher les ${changes.length - 12} autres modifications`}
          onPress={() => setExpanded(true)}
        />
      ) : null}
    </View>
  );
}
export function StoreLayoutPanel({
  snapshot,
  loaded,
  busy,
  allowed,
  error,
  notice,
  onBack,
  onInitialize,
  onAction,
  onResolve,
  onHistory,
  onSync,
}: {
  snapshot: LayoutSnapshot;
  loaded: boolean;
  busy: boolean;
  allowed: boolean;
  error?: string;
  notice?: string;
  onBack: () => void;
  onInitialize: () => Promise<void>;
  onAction: (a: LayoutAction) => Promise<void>;
  onResolve: (
    id: string,
    localRevisionId: string,
    remoteRevisionId: string,
    useLocal: boolean,
  ) => Promise<void>;
  onHistory: (before?: {
    version: number;
    id: string;
  }) => Promise<RevisionPage>;
  onSync: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null),
    [showElement, setShowElement] = useState(false),
    [viewport, setViewport] = useState(initialLayoutViewport),
    [showList, setShowList] = useState(false),
    [edit, setEdit] = useState<LayoutEdit | null>(null),
    [review, setReview] = useState<Review | null>(null),
    [history, setHistory] = useState<RevisionPage | null>(null),
    [moreHistory, setMoreHistory] = useState(false),
    [historyBusy, setHistoryBusy] = useState(false),
    [comparison, setComparison] = useState<{
      conflict: SyncConflict;
      local: StoreLayout;
      remote: StoreLayout;
    } | null>(null),
    [panelError, setPanelError] = useState<string>();
  const lock = useRef(false),
    historyRequest = useRef(0);
  const head = snapshot.head?.entity ?? null,
    visible = visibleLayout(head, snapshot.reference),
    content = edit?.content ?? visible?.content,
    stale = !!edit && edit.baseRevisionId !== head?.revisionId,
    blocked =
      snapshot.head?.syncState === "CONFLICT" ||
      snapshot.head?.syncState === "ERROR",
    canEdit = allowed && !blocked && !busy;
  const editing = !!edit;
  const screenOptions = useMemo(
    () => ({ gestureEnabled: !editing }),
    [editing],
  );
  useFocusEffect(
    useCallback(() => {
      if (!editing) return;
      const subscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          setPanelError(
            "Enregistrez le brouillon ou annulez vos modifications avant de quitter le plan.",
          );
          return true;
        },
      );
      return () => subscription.remove();
    }, [editing]),
  );
  async function run(action: () => Promise<void>, clearEdit = false) {
    if (lock.current || busy || !allowed) return;
    lock.current = true;
    setPanelError(undefined);
    try {
      await action();
      if (clearEdit) setEdit(null);
      setReview(null);
      setComparison(null);
    } catch (e) {
      setPanelError(layoutError(e));
    } finally {
      lock.current = false;
    }
  }
  function select(id: string) {
    setSelectedId(id);
    setShowElement(true);
  }
  async function openHistory() {
    const request = ++historyRequest.current;
    setHistory([]);
    setHistoryBusy(true);
    setPanelError(undefined);
    try {
      const rows = await onHistory();
      if (request === historyRequest.current) {
        setHistory(rows);
        setMoreHistory(rows.length === 20);
      }
    } catch {
      setPanelError(
        "L’historique local ne peut pas être lu. Le plan reste affiché.",
      );
    } finally {
      if (request === historyRequest.current) setHistoryBusy(false);
    }
  }
  async function nextHistory() {
    if (!history?.length || historyBusy) return;
    const request = historyRequest.current,
      last = history.at(-1)!.revision;
    setHistoryBusy(true);
    try {
      const rows = await onHistory({ version: last.plan.version, id: last.id });
      if (request === historyRequest.current) {
        setHistory((old) => (old ? [...old, ...rows] : old));
        setMoreHistory(rows.length === 20);
      }
    } catch {
      setPanelError("La suite de l’historique n’a pas pu être lue.");
    } finally {
      if (request === historyRequest.current) setHistoryBusy(false);
    }
  }
  const errorMessage = panelError ?? error;
  return (
    <>
      <Stack.Screen options={screenOptions} />
      <AppHeader
        title="Plan et mobilier"
        subtitle="Le repère partagé de votre rayon, disponible hors connexion."
      />
      <SecondaryButton
        label="Retour au magasin"
        disabled={busy || !!edit}
        onPress={onBack}
      />
      {errorMessage ? (
        <InlineAlert title="Plan à vérifier" message={errorMessage} />
      ) : null}
      {notice ? <InlineAlert title="Plan magasin" message={notice} /> : null}
      {!loaded ? (
        <Text className="text-muted">Lecture du plan enregistré…</Text>
      ) : !content ? (
        <EmptyState
          title="Votre plan de rayon"
          message="Commencez avec le repère du magasin pilote : deux îlots de huit éléments et trois TG. Les mesures issues du plan de référence resteront à confirmer."
        >
          {allowed ? (
            <PrimaryButton
              label="Créer un brouillon à partir du plan pilote"
              loading={busy}
              onPress={() => void run(onInitialize)}
            />
          ) : (
            <Text className="text-muted">
              Le responsable du magasin peut initialiser le plan.
            </Text>
          )}
        </EmptyState>
      ) : (
        <>
          <View className="flex-row flex-wrap items-center gap-3">
            <StatusBadge
              status={
                snapshot.head?.syncState === "SYNCED"
                  ? "synced"
                  : snapshot.head?.syncState === "CONFLICT"
                    ? "conflict"
                    : snapshot.head?.syncState === "ERROR"
                      ? "error"
                      : "pending"
              }
            />
            <Text className="text-muted">
              {edit
                ? "Mesures en cours de modification"
                : head && isLayoutDraft(head)
                  ? "Brouillon enregistré"
                  : "Plan de référence"}
            </Text>
          </View>
          {snapshot.head?.syncState === "ERROR" ? (
            <InlineAlert
              title="Envoi refusé"
              message="Le plan local est conservé. Examinez le refus dans Synchronisation avant de reprendre une modification."
            />
          ) : null}
          {snapshot.conflicts.length ? (
            <SectionCard title="Deux versions à comparer">
              <Text className="text-muted">
                Votre version est conservée. Aucun choix n’est fait
                automatiquement.
              </Text>
              <SecondaryButton
                label="Comparer les versions du plan"
                disabled={busy || !!edit}
                onPress={() => {
                  const conflict = snapshot.conflicts[0]!,
                    remote = storeLayoutSchema.safeParse(
                      conflict.remotePayload,
                    );
                  if (
                    !head ||
                    !remote.success ||
                    remote.data.storeId !== head.storeId
                  ) {
                    setPanelError(
                      "La version synchronisée n’est pas disponible. Synchronisez avant de reprendre la comparaison.",
                    );
                    return;
                  }
                  setComparison({ conflict, local: head, remote: remote.data });
                }}
              />
            </SectionCard>
          ) : null}
          {blocked ? (
            <SecondaryButton
              label="Ouvrir la synchronisation"
              disabled={!!edit}
              onPress={onSync}
            />
          ) : null}
          {stale ? (
            <SectionCard title="Une nouvelle version est disponible">
              <Text className="text-muted">
                Vos mesures restent affichées. Comparez les versions avant de
                les conserver.
              </Text>
              <SecondaryButton
                label="Comparer avec mes modifications"
                disabled={!canEdit || !head}
                onPress={() => {
                  if (head && edit)
                    setReview({
                      kind: "REBASE",
                      expectedRevisionId: head.revisionId,
                      before: head.content,
                      after: edit.content,
                    });
                }}
              />
            </SectionCard>
          ) : null}
          <SectionCard title="Vue du dessus">
            <Text className="text-sm text-muted">
              Largeur du rayon : {layoutMeasurementLabel(content.room.width)}
              {`\n`}Profondeur : {layoutMeasurementLabel(content.room.depth)}
            </Text>
            <StoreLayoutMap
              content={content}
              selectedId={selectedId}
              viewport={viewport}
              onViewport={setViewport}
              onSelect={select}
            />
            <Text className="text-sm text-muted">
              A et B repèrent les faces de chaque îlot. Leur orientation et les
              dimensions de référence restent à confirmer au magasin.
            </Text>
          </SectionCard>
          {edit ? (
            <SectionCard title="Modifier les mesures">
              <Text className="text-muted">
                Touchez un meuble puis sa surface pour compléter uniquement les
                mesures utiles. Aucun déplacement de mobilier n’est effectué.
              </Text>
              <PrimaryButton
                label="Enregistrer le brouillon"
                loading={busy}
                disabled={!canEdit || stale || !edit.undo.length}
                onPress={() =>
                  void run(
                    () =>
                      onAction({
                        action: "SAVE_DRAFT",
                        expectedRevisionId: edit.baseRevisionId,
                        content: edit.content,
                      }),
                    true,
                  )
                }
              />
              <SecondaryButton
                label="Annuler la dernière modification"
                disabled={busy || !edit.undo.length}
                onPress={() => setEdit(undoLayoutEdit(edit))}
              />
              <SecondaryButton
                label="Annuler mes modifications non enregistrées"
                disabled={busy}
                onPress={() => {
                  setEdit(null);
                  setPanelError(undefined);
                }}
              />
            </SectionCard>
          ) : (
            <>
              {allowed ? (
                <SecondaryButton
                  label="Modifier les mesures"
                  disabled={!canEdit || !head}
                  onPress={() => {
                    if (head)
                      setEdit({
                        baseRevisionId: head.revisionId,
                        content,
                        undo: [],
                      });
                  }}
                />
              ) : null}
              {head && isLayoutDraft(head) && allowed ? (
                <SectionCard title="Brouillon du plan">
                  <Text className="text-muted">
                    Il est conservé sur cet appareil. Vous pouvez encore le
                    modifier avant de le choisir comme référence du magasin.
                  </Text>
                  <PrimaryButton
                    label="Examiner avant de choisir ce plan"
                    disabled={!canEdit}
                    onPress={() =>
                      setReview({
                        kind: "ADOPT",
                        expectedRevisionId: head.revisionId,
                        before: snapshot.reference?.content ?? null,
                        after: head.content,
                      })
                    }
                  />
                  <SecondaryButton
                    label="Abandonner ce brouillon"
                    disabled={!canEdit}
                    onPress={() =>
                      void run(() =>
                        onAction({
                          action: "DISCARD_DRAFT",
                          expectedRevisionId: head.revisionId,
                        }),
                      )
                    }
                  />
                </SectionCard>
              ) : null}
            </>
          )}
          <SecondaryButton
            label={`${showList ? "Masquer" : "Voir"} la liste des ${content.furniture.length} éléments`}
            onPress={() => setShowList((v) => !v)}
          />
          {showList ? (
            <SectionCard title="Éléments du rayon">
              {content.furniture.map((f) => (
                <SecondaryButton
                  key={f.id}
                  label={f.label}
                  onPress={() => select(f.id)}
                />
              ))}
            </SectionCard>
          ) : null}
        </>
      )}
      {loaded && head ? (
        <SecondaryButton
          label="Historique du plan"
          disabled={busy || !!edit}
          onPress={() => void openHistory()}
        />
      ) : null}
      {content && showElement && selectedId ? (
        <StoreLayoutElementSheet
          content={content}
          id={selectedId}
          editing={!!edit}
          busy={busy || !allowed || blocked}
          blockedReason={
            blocked
              ? "Le plan nécessite un examen dans Synchronisation. Votre saisie reste affichée ; fermez la fiche pour comparer les versions."
              : !allowed && edit
                ? "Vos droits permettent uniquement la consultation. Les mesures déjà appliquées restent dans votre brouillon."
                : undefined
          }
          onClose={() => setShowElement(false)}
          onSelect={select}
          onApply={(next) => {
            if (edit && canEdit) setEdit(patchLayoutEdit(edit, next));
          }}
        />
      ) : null}
      <BottomSheet
        visible={!!review || history !== null || !!comparison}
        title={
          review
            ? review.kind === "ADOPT"
              ? "Choisir le plan de référence"
              : review.kind === "RESTORE"
                ? "Reprendre cette ancienne version"
                : "Conserver mes modifications"
            : history !== null
              ? "Historique du plan"
              : "Comparer les plans"
        }
        onClose={() => {
          if (busy) return;
          historyRequest.current++;
          setReview(null);
          setHistory(null);
          setComparison(null);
          setHistoryBusy(false);
        }}
        swipeToClose
      >
        {errorMessage ? (
          <InlineAlert title="Action à vérifier" message={errorMessage} />
        ) : null}
        {review ? (
          <>
            <LayoutComparison
              key={review.expectedRevisionId + (review.sourceId ?? review.kind)}
              before={review.before}
              after={review.after}
            />
            <Text className="text-muted">
              Les anciennes versions sont conservées. Les mesures à confirmer
              restent à confirmer ; ce choix ne valide pas la faisabilité d’une
              implantation.
            </Text>
            {head?.revisionId !== review.expectedRevisionId ? (
              <InlineAlert
                title="Le plan a changé"
                message="Fermez cette comparaison puis rouvrez-la pour examiner la version actuelle."
              />
            ) : null}
            <PrimaryButton
              label={
                review.kind === "ADOPT"
                  ? "Utiliser ce plan comme référence"
                  : "Enregistrer cette version comme brouillon"
              }
              loading={busy}
              disabled={
                !canEdit || head?.revisionId !== review.expectedRevisionId
              }
              onPress={() =>
                void run(
                  () =>
                    onAction({
                      expectedRevisionId: review.expectedRevisionId,
                      action:
                        review.kind === "ADOPT"
                          ? "ADOPT_REFERENCE"
                          : review.kind === "RESTORE"
                            ? "RESTORE_AS_DRAFT"
                            : "SAVE_DRAFT",
                      ...(review.kind === "RESTORE"
                        ? { restoredFromRevisionId: review.sourceId }
                        : review.kind === "REBASE"
                          ? { content: review.after }
                          : {}),
                    }),
                  true,
                )
              }
            />
          </>
        ) : history !== null ? (
          <>
            <Text className="text-muted">
              Une ancienne version peut être reprise dans un nouveau brouillon,
              sans réécrire l’historique.
            </Text>
            {!history.length ? (
              <Text className="text-muted">
                {historyBusy
                  ? "Lecture des versions…"
                  : "Aucune version disponible sur cet appareil."}
              </Text>
            ) : null}
            {history.map(({ revision, synced }) => (
              <View
                className="gap-2 rounded-xl bg-canvas p-3"
                key={revision.id}
              >
                <Text className="font-semibold text-ink">
                  Version {revision.plan.version} ·{" "}
                  {new Date(revision.plan.updatedAt).toLocaleString("fr-FR")}
                </Text>
                <Text className="text-muted">
                  {
                    {
                      SAVE_DRAFT: "Brouillon",
                      ADOPT_REFERENCE: "Référence adoptée",
                      DISCARD_DRAFT: "Brouillon abandonné",
                      RESTORE_AS_DRAFT: "Version reprise",
                    }[revision.plan.action]
                  }{" "}
                  · {synced ? "Synchronisée" : "Conservée sur cet appareil"}
                </Text>
                {head && revision.id !== head.revisionId ? (
                  <SecondaryButton
                    label={`Examiner la version ${revision.plan.version}`}
                    disabled={busy}
                    onPress={() => {
                      setHistory(null);
                      setReview({
                        kind: "RESTORE",
                        expectedRevisionId: head.revisionId,
                        before: visible?.content ?? null,
                        after: revision.plan.content,
                        sourceId: revision.id,
                      });
                    }}
                  />
                ) : null}
              </View>
            ))}
            {moreHistory ? (
              <SecondaryButton
                label="Afficher les versions précédentes"
                loading={historyBusy}
                onPress={() => void nextHistory()}
              />
            ) : null}
          </>
        ) : comparison ? (
          <>
            <Text className="text-muted">
              Avant : votre version locale. Après : la version synchronisée.
            </Text>
            <LayoutComparison
              before={comparison.local.content}
              after={comparison.remote.content}
            />
            <Text className="text-muted">
              Conserver votre version crée un nouveau brouillon à examiner. Les
              deux versions restent dans l’historique.
            </Text>
            <PrimaryButton
              label="Reprendre ma version comme brouillon"
              loading={busy}
              disabled={
                !allowed || head?.revisionId !== comparison.local.revisionId
              }
              onPress={() =>
                void run(
                  () =>
                    onResolve(
                      comparison.conflict.id,
                      comparison.local.revisionId,
                      comparison.remote.revisionId,
                      true,
                    ),
                  true,
                )
              }
            />
            <SecondaryButton
              label="Utiliser la version synchronisée"
              disabled={
                busy ||
                !allowed ||
                head?.revisionId !== comparison.local.revisionId
              }
              onPress={() =>
                void run(
                  () =>
                    onResolve(
                      comparison.conflict.id,
                      comparison.local.revisionId,
                      comparison.remote.revisionId,
                      false,
                    ),
                  true,
                )
              }
            />
          </>
        ) : null}
      </BottomSheet>
    </>
  );
}
