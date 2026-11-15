import { TgPresentationView } from "./tg-presentation-view";
import { commercialExecutionActualsNotFuture } from "@fl-copilot/domain";
import {
  ExecutionActualsEditor,
  executionActualsDraft,
  parseExecutionActualsDraft,
  type ExecutionActualsDraft,
} from "./execution-actuals-editor";
import { useCallback, useMemo, useState, useRef, type ReactNode } from "react";
import {
  Text,
  TextInput,
  View,
  Alert,
  Pressable,
  Platform,
} from "react-native";
import { useFocusEffect, router } from "expo-router";
import {
  ExecutionChecklistView,
  type ExecutionFilter,
} from "./execution-checklist-view";
import { DetailsDisclosure } from "../components/dashboard";
import { colors } from "../design/tokens";
import { useVisualLibrary } from "../products/use-visual-library";
import {
  digestStringAsync,
  CryptoDigestAlgorithm,
  randomUUID,
} from "expo-crypto";
import {
  commercialExecutionChecklist,
  commercialExecutionProgress,
  commercialExecutionSameTarget,
  type CommercialExecutionProposal,
} from "@fl-copilot/commercial-core";
import {
  commercialExecutionTaskSchema,
  type CommercialExecutionTask,
  type CommercialWeekPlan,
} from "@fl-copilot/sync-contracts";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import {
  BottomSheet,
  SectionCard,
  SecondaryButton,
  PrimaryButton,
  InlineAlert,
} from "@/components/ui";
import {
  CommercialExecutionRepository,
  readCommercialExecutionPlan,
  type LocalCommercialExecution,
} from "./execution-repository";
import {
  executionStatusLabels,
  commercialExecutionError,
  executionTaskContext,
} from "./execution-presentation";
const digest = (s: string) =>
  digestStringAsync(CryptoDigestAlgorithm.SHA256, s);
type Editor = {
  proposal: CommercialExecutionProposal;
  record: LocalCommercialExecution | null;
  status: CommercialExecutionTask["status"];
  note: string;
  actuals: ExecutionActualsDraft;
  plan: CommercialWeekPlan;
  installationConfirmation?: boolean;
};
export function CommercialExecutionView({
  plan,
  compact = false,
  initialTaskId,
  filter: controlledFilter,
  onFilter,
  presentation = "default",
  placementId,
  onOpenPlacement,
  renderDetail,
}: {
  plan: CommercialWeekPlan;
  compact?: boolean;
  initialTaskId?: string;
  filter?: ExecutionFilter;
  onFilter?(filter: ExecutionFilter): void;
  presentation?: "default" | "week" | "placement";
  placementId?: string;
  onOpenPlacement?(placementId: string): void;
  renderDetail?(content: ReactNode, action: ReactNode): ReactNode;
}) {
  const visuals = useVisualLibrary();
  const { sqlite, deviceId } = useLocalDatabase(),
    { syncNow, status: syncStatus } = useSync(),
    repo = useMemo(
      () => new CommercialExecutionRepository(sqlite, digest),
      [sqlite],
    );
  const autoOpened = useRef<string | undefined>(undefined);
  const saveLock = useRef(false);
  const [loadedRevision, setLoadedRevision] = useState<string>();
  const [localFilter, setLocalFilter] = useState<ExecutionFilter>("TODO");
  const filter = controlledFilter ?? localFilter;
  const setFilter = onFilter ?? setLocalFilter;
  const [proposals, setProposals] = useState<CommercialExecutionProposal[]>([]),
    [records, setRecords] = useState<LocalCommercialExecution[]>([]),
    [editor, setEditor] = useState<Editor | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [notice, setNotice] = useState<string>(),
    [noteError, setNoteError] = useState<string>(),
    [actualsError, setActualsError] = useState<string>(),
    [actualsOpen, setActualsOpen] = useState(false);
  const refresh = useCallback(async () => {
    const [p, r] = await Promise.all([
      commercialExecutionChecklist(plan, digest),
      repo.list(plan.storeId, plan.revisionId),
    ]);
    return { p, r };
  }, [plan, repo]);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void refresh()
        .then((d) => {
          if (active) {
            setProposals(d.p);
            setRecords(d.r);
            setLoadedRevision(plan.revisionId);
            if (
              initialTaskId &&
              autoOpened.current !== `${plan.revisionId}:${initialTaskId}`
            ) {
              autoOpened.current = `${plan.revisionId}:${initialTaskId}`;
              const proposal = d.p.find((p) => p.id === initialTaskId),
                record = proposal
                  ? (d.r.find((r) =>
                      commercialExecutionSameTarget(r.entity, proposal),
                    ) ?? null)
                  : null;
              if (proposal)
                setEditor({
                  proposal,
                  record,
                  status: record?.entity.status ?? "TODO",
                  note: record?.entity.note ?? "",
                  actuals: executionActualsDraft(record?.entity.actuals),
                  plan,
                });
              else
                setError(
                  "Cette tâche ne figure plus dans la version actuelle du plan. Consulte le plan avant de choisir.",
                );
            }
          }
        })
        .catch(() => {
          if (active && syncStatus !== "syncing")
            setError(
              "Le suivi enregistré ne peut pas être lu. Rouvrez le plan.",
            );
        });
      return () => {
        active = false;
      };
    }, [refresh, syncStatus, plan, initialTaskId]),
  );
  async function edit(
    p: CommercialExecutionProposal,
    r: LocalCommercialExecution | null,
    sourcePlan: CommercialWeekPlan,
    installationConfirmation = false,
  ) {
    setNoteError(undefined);
    setActualsError(undefined);
    setActualsOpen(false);
    setError(undefined);
    setEditor({
      proposal: p,
      record: r,
      status: installationConfirmation ? "DONE" : (r?.entity.status ?? "TODO"),
      note: r?.entity.note ?? "",
      actuals: executionActualsDraft(r?.entity.actuals),
      plan: sourcePlan,
      installationConfirmation,
    });
  }
  async function editOther(r: LocalCommercialExecution) {
    setBusy(true);
    try {
      const source = await readCommercialExecutionPlan(
        sqlite,
        r.entity.storeId,
        r.entity.planId,
        r.entity.planRevisionId,
        r.entity.planChecksum,
        digest,
      );
      if (!source) throw Error("COMMERCIAL_EXECUTION_PLAN_CHANGED");
      await edit(r.entity, r, source);
    } catch (e) {
      setError(
        commercialExecutionError(e instanceof Error ? e.message : undefined),
      );
    } finally {
      setBusy(false);
    }
  }
  async function save(value: Editor | null = editor) {
    if (!value || busy || saveLock.current) return;
    setError(undefined);
    setNoteError(undefined);
    setActualsError(undefined);
    const now = new Date().toISOString(),
      old = value.record?.entity;
    let actuals;
    try {
      actuals = parseExecutionActualsDraft(value.actuals);
    } catch {
      setActualsOpen(true);
      setActualsError(
        "Vérifiez les dates réelles, le prix (jusqu’à deux décimales) et son unité.",
      );
      return;
    }
    if (!commercialExecutionActualsNotFuture(actuals, now)) {
      setActualsOpen(true);
      setActualsError("Une date réelle ne peut pas être future.");
      return;
    }
    const parsed = commercialExecutionTaskSchema.safeParse({
      ...value.proposal,
      ...(actuals === null && old?.actuals === undefined ? {} : { actuals }),
      status: value.status,
      note: value.note,
      completedAt:
        value.status === "DONE"
          ? old?.status === "DONE"
            ? old.completedAt
            : now
          : null,
      version:
        (value.record?.syncState === "ERROR"
          ? (value.record.remoteVersion ?? 0)
          : (old?.version ?? 0)) + 1,
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
    });
    if (!parsed.success) {
      setNoteError(
        parsed.error.issues.find((i) => i.path[0] === "note")?.message ??
          "Vérifiez le statut de la tâche.",
      );
      return;
    }
    saveLock.current = true;
    setBusy(true);
    try {
      await repo.save(parsed.data, { commandId: randomUUID(), deviceId });
      setEditor(null);
      setNotice(
        `Déclaration enregistrée pour le plan version ${parsed.data.planVersion}.`,
      );
      const d = await refresh();
      setProposals(d.p);
      setRecords(d.r);
      setLoadedRevision(plan.revisionId);
      void syncNow(plan.storeId).catch(() => undefined);
    } catch (e) {
      setError(
        commercialExecutionError(e instanceof Error ? e.message : undefined),
      );
    } finally {
      saveLock.current = false;
      setBusy(false);
    }
  }
  function closeEditor() {
    if (busy) return;
    const changed =
      editor &&
      (editor.status !==
        (editor.installationConfirmation
          ? "DONE"
          : (editor.record?.entity.status ?? "TODO")) ||
        editor.note !== (editor.record?.entity.note ?? "") ||
        JSON.stringify(editor.actuals) !==
          JSON.stringify(executionActualsDraft(editor.record?.entity.actuals)));
    if (changed && Platform.OS === "web") {
      if (
        window.confirm(
          "Fermer sans enregistrer ? Les modifications de cette déclaration ne sont pas encore enregistrées.",
        )
      )
        setEditor(null);
      return;
    }
    if (changed)
      Alert.alert(
        "Fermer sans enregistrer ?",
        "Les modifications de cette déclaration ne sont pas encore enregistrées.",
        [
          { text: "Continuer la saisie", style: "cancel" },
          {
            text: "Fermer",
            style: "destructive",
            onPress: () => setEditor(null),
          },
        ],
      );
    else setEditor(null);
  }
  const loaded = loadedRevision === plan.revisionId;
  const visibleProposals = loaded ? proposals : [];
  const visibleRecords = loaded ? records : [];
  const others = visibleRecords.filter(
    (r) =>
      !visibleProposals.some((p) => commercialExecutionSameTarget(r.entity, p)),
  );
  const installationProposals = visibleProposals.filter(
    (p) => p.kind === "INSTALL_TG",
  );
  const progress = commercialExecutionProgress(
    installationProposals,
    visibleRecords.map((r) => r.entity),
  );
  function target(placement: string) {
    const proposal = installationProposals.find(
      (p) => p.targetId === placement,
    );
    const record = proposal
      ? (visibleRecords.find((r) =>
          commercialExecutionSameTarget(r.entity, proposal),
        ) ?? null)
      : null;
    return { proposal, record };
  }
  function installationLabel(record: LocalCommercialExecution | null) {
    const label =
      record?.entity.status === "DONE"
        ? "Installation déclarée"
        : record?.entity.status === "SKIPPED"
          ? "Installation ignorée"
          : record?.entity.status === "NOT_APPLICABLE"
            ? "Non applicable"
            : "Préparée";
    const synchronization = (
      {
        PENDING: "À synchroniser",
        CONFLICT: "À comparer",
        ERROR: "À reprendre",
      } as Record<string, string>
    )[record?.syncState ?? ""];
    return synchronization ? `${label} · ${synchronization}` : label;
  }
  const activePlacement = plan.preparation.placements.find(
    (p) =>
      p.id ===
      (placementId ??
        (initialTaskId
          ? installationProposals.find((p) => p.id === initialTaskId)?.targetId
          : plan.preparation.placements[0]?.id)),
  );
  const checklist = (
    <ExecutionChecklistView
      plan={plan}
      proposals={visibleProposals}
      records={visibleRecords}
      filter={compact ? filter : undefined}
      onFilter={setFilter}
      disabled={busy}
      visuals={visuals}
      onOpen={(proposal, record) =>
        record?.syncState === "CONFLICT"
          ? router.push("/sync-center")
          : void edit(proposal, record, plan)
      }
    />
  );
  const activeTarget = activePlacement ? target(activePlacement.id) : null;
  const detailAction = activeTarget?.proposal ? (
    <PrimaryButton
      disabled={busy}
      label={
        activeTarget.record?.syncState === "CONFLICT"
          ? "Comparer dans Synchronisation"
          : activeTarget.record && activeTarget.record.entity.status !== "TODO"
            ? "Revoir la déclaration"
            : "Déclarer l’installation"
      }
      onPress={() =>
        activeTarget.record?.syncState === "CONFLICT"
          ? router.push("/sync-center")
          : void edit(
              activeTarget.proposal!,
              activeTarget.record,
              plan,
              !activeTarget.record ||
                activeTarget.record.entity.status === "TODO",
            )
      }
    />
  ) : null;
  const content = (
    <>
      {!loaded ? (
        <Text className="text-muted">Lecture des tâches enregistrées…</Text>
      ) : null}
      {notice ? <InlineAlert title="Enregistré" message={notice} /> : null}
      {error ? (
        <InlineAlert title="Déclaration à vérifier" message={error} />
      ) : null}
      {compact &&
      visibleRecords.some(
        (r) => r.syncState === "CONFLICT" || r.syncState === "ERROR",
      ) ? (
        <>
          <InlineAlert
            title="Des déclarations sont à vérifier"
            message="Consultez toutes les tâches et leurs autres déclarations pour examiner les conflits ou les envois refusés."
          />
          <SecondaryButton
            label="Voir toutes les déclarations"
            onPress={() => setFilter("ALL")}
          />
        </>
      ) : null}
      {loaded && presentation === "week" ? (
        <>
          <View className="flex-row items-center gap-3 border-b border-line pb-4">
            <View className="flex-row gap-1" accessible={false}>
              {plan.preparation.placements.map((p, i) => (
                <View
                  key={p.id}
                  style={{
                    height: 5,
                    width: 22,
                    borderRadius: 3,
                    backgroundColor:
                      i < progress.DONE ? colors.forest : colors.line,
                  }}
                />
              ))}
            </View>
            <Text className="flex-1 text-right text-sm text-muted">
              {progress.DONE} sur {progress.total} installations déclarées
            </Text>
          </View>
          <TgPresentationView
            placements={plan.preparation.placements}
            layout="cards"
            onOpenPlacement={onOpenPlacement}
            renderFooter={(p) => {
              const { record } = target(p.id);
              return (
                <View className="flex-row items-center justify-between gap-3 border-t border-line pt-3">
                  <Text className="flex-1 text-sm text-forest">
                    {installationLabel(record)}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Voir la TG : ${p.label}`}
                    onPress={() => onOpenPlacement?.(p.id)}
                    className="min-h-12 justify-center"
                  >
                    <Text className="text-sm font-semibold text-forest">
                      Voir la TG ›
                    </Text>
                  </Pressable>
                </View>
              );
            }}
          />
          <DetailsDisclosure title="Toutes les tâches et déclarations">
            {checklist}
          </DetailsDisclosure>
        </>
      ) : loaded && presentation === "placement" ? (
        activePlacement ? (
          <TgPresentationView
            placements={[activePlacement]}
            layout="detail"
            renderFooter={(p) => {
              const { record } = target(p.id);
              return (
                <View className="gap-4">
                  <Text className="text-sm font-semibold text-forest">
                    {installationLabel(record)}
                  </Text>
                  {record?.entity.completedAt ? (
                    <Text className="text-sm text-muted">
                      Déclaration du{" "}
                      {new Date(record.entity.completedAt).toLocaleString(
                        "fr-FR",
                      )}
                    </Text>
                  ) : null}
                  {record?.entity.note ? (
                    <Text className="text-sm text-ink">
                      {record.entity.note}
                    </Text>
                  ) : null}
                  {record?.syncState === "ERROR" ? (
                    <InlineAlert
                      title="Déclaration à reprendre"
                      message={commercialExecutionError(
                        record.lastErrorCode ?? undefined,
                      )}
                    />
                  ) : null}
                  {!renderDetail ? detailAction : null}
                </View>
              );
            }}
          />
        ) : (
          <InlineAlert
            title="TG introuvable"
            message="Cette TG ne figure plus dans le plan actuel. Reviens à ta semaine pour retrouver tes choix."
          />
        )
      ) : loaded ? (
        checklist
      ) : null}
      <DetailsDisclosure title="À propos de ce suivi">
        <Text className="text-sm leading-5 text-muted">
          Chaque version du plan possède son propre suivi. Une proposition à
          faire ne crée aucune déclaration tant que vous ne l’enregistrez pas.
          Marquer Fait ne confirme ni un prix en caisse, ni un résultat de
          vente.
        </Text>
      </DetailsDisclosure>
      {others.length ? (
        <SectionCard title="Autres déclarations conservées pour cette version">
          <Text className="text-sm text-muted">
            Elles concernent une autre copie du plan et ne valident pas les
            tâches affichées ci-dessus.
          </Text>
          {others.map((r) => (
            <View key={r.entity.id} className="gap-2">
              <Text className="text-ink">
                {r.entity.label} · {executionStatusLabels[r.entity.status]}
              </Text>
              <Text className="text-muted">{r.entity.note}</Text>
              <SecondaryButton
                label="Revoir cette déclaration conservée"
                disabled={busy}
                onPress={() => void editOther(r)}
              />
            </View>
          ))}
        </SectionCard>
      ) : null}
      {editor ? (
        <ExecutionDeclarationSheet
          editor={editor}
          busy={busy}
          error={error}
          noteError={noteError}
          actualsError={actualsError}
          actualsOpen={actualsOpen}
          onToggleActuals={() => setActualsOpen((value) => !value)}
          onChange={(patch) =>
            setEditor((e) => (e ? { ...e, ...patch } : null))
          }
          onClose={closeEditor}
          onSave={() => void save()}
        />
      ) : null}
    </>
  );
  if (presentation === "placement" && renderDetail)
    return renderDetail(content, loaded ? detailAction : null);
  return presentation === "default" ? (
    <SectionCard
      title={
        compact ? "Vos tâches" : `Suivi d’exécution · version ${plan.version}`
      }
      description="Affiches et TG du plan validé. Ouvre une tâche pour déclarer sa réalisation."
    >
      {content}
    </SectionCard>
  ) : (
    <View className="gap-5">{content}</View>
  );
}

/** The canonical controller owns drafts, validation and saving; this sheet only renders them. */
export function ExecutionDeclarationSheet({
  editor,
  busy,
  error,
  noteError,
  actualsError,
  actualsOpen,
  onToggleActuals,
  onChange,
  onClose,
  onSave,
}: {
  editor: Pick<
    Editor,
    | "proposal"
    | "status"
    | "note"
    | "actuals"
    | "plan"
    | "installationConfirmation"
  > & {
    record?: LocalCommercialExecution | null;
  };
  busy: boolean;
  error?: string;
  noteError?: string;
  actualsError?: string;
  actualsOpen: boolean;
  onToggleActuals(): void;
  onChange(patch: Partial<Pick<Editor, "status" | "note" | "actuals">>): void;
  onClose(): void;
  onSave(): void;
}) {
  const installation =
    editor.installationConfirmation && editor.proposal.kind === "INSTALL_TG";
  const placement = editor.plan.preparation.placements.find(
    (p) => p.id === editor.proposal.targetId,
  );
  const note = (
    <TextInput
      accessibilityLabel="Note ou motif de la déclaration"
      value={editor.note}
      editable={!busy}
      multiline
      maxLength={1200}
      placeholder={
        installation
          ? "Une précision, si tu le souhaites"
          : "Note ; motif requis pour Ignoré ou Non applicable"
      }
      placeholderTextColor={colors.muted}
      onChangeText={(value) => onChange({ note: value })}
      className={`min-h-20 rounded-xl border p-3 text-ink ${noteError ? "border-danger" : "border-line"}`}
    />
  );
  return (
    <BottomSheet
      visible
      title={installation ? "Déclarer l’installation" : "Revoir la déclaration"}
      onClose={onClose}
      swipeToClose
      avoidKeyboard
      footer={
        <PrimaryButton
          label={
            installation
              ? "Confirmer la déclaration"
              : "Enregistrer la déclaration"
          }
          disabled={busy}
          loading={busy}
          onPress={onSave}
        />
      }
    >
      <Text className="font-semibold text-ink">
        {installation
          ? (placement?.label ?? editor.proposal.label)
          : editor.proposal.label}
      </Text>
      {installation ? (
        <Text className="text-sm leading-6 text-muted">
          Confirme sa mise en place. Tu peux ajouter des précisions si tu les
          connais.
        </Text>
      ) : (
        <>
          <Text className="text-sm leading-5 text-muted">
            {executionTaskContext(editor.plan, editor.proposal.targetId)}
          </Text>
          {editor.record?.entity.completedAt ? (
            <Text className="text-sm text-muted">
              Déclaration du{" "}
              {new Date(editor.record.entity.completedAt).toLocaleString(
                "fr-FR",
              )}
            </Text>
          ) : null}
          <View
            className="flex-row flex-wrap gap-2"
            accessibilityRole="radiogroup"
            accessibilityLabel="Statut déclaré de la tâche"
          >
            {(
              Object.keys(
                executionStatusLabels,
              ) as CommercialExecutionTask["status"][]
            ).map((status) => (
              <Pressable
                key={status}
                accessibilityRole="radio"
                accessibilityLabel={`Statut déclaré : ${executionStatusLabels[status]}`}
                aria-checked={editor.status === status}
                accessibilityState={{
                  checked: editor.status === status,
                  disabled: busy,
                }}
                disabled={busy}
                onPress={() => onChange({ status })}
                className={`min-h-12 justify-center rounded-full border px-4 py-3 ${editor.status === status ? "border-accent bg-accent" : "border-line bg-surface"}`}
              >
                <Text
                  className={
                    editor.status === status
                      ? "font-semibold text-on-accent"
                      : "text-ink"
                  }
                >
                  {executionStatusLabels[status]}
                </Text>
              </Pressable>
            ))}
          </View>
          {note}
        </>
      )}
      {error ? (
        <InlineAlert title="Déclaration non enregistrée" message={error} />
      ) : null}
      <View
        className={`gap-3 rounded-2xl border p-4 ${actualsError ? "border-danger" : "border-line"}`}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ajouter des précisions (facultatif)"
          aria-expanded={actualsOpen}
          accessibilityState={{ expanded: actualsOpen, disabled: busy }}
          disabled={busy}
          onPress={onToggleActuals}
          className="min-h-12 flex-row items-center justify-between gap-2"
        >
          <View className="flex-1 gap-1">
            <Text className="text-sm font-semibold text-forest">
              {Object.values(editor.actuals).some((value) => value.trim())
                ? "Voir les précisions"
                : "Ajouter des précisions"}
            </Text>
            <Text className="text-xs text-muted">Facultatif</Text>
          </View>
          <Text className="text-lg text-forest">{actualsOpen ? "−" : "+"}</Text>
        </Pressable>
        {actualsOpen ? (
          <>
            <ExecutionActualsEditor
              value={editor.actuals}
              disabled={busy}
              onChange={(actuals) => onChange({ actuals })}
            />
            {installation ? note : null}
          </>
        ) : null}
        {actualsError ? (
          <Text accessibilityRole="alert" className="text-danger">
            {actualsError}
          </Text>
        ) : null}
      </View>
      {noteError ? (
        <Text accessibilityRole="alert" className="text-danger">
          {noteError}
        </Text>
      ) : null}
    </BottomSheet>
  );
}
