import { commercialExecutionActualsNotFuture } from "@fl-copilot/domain";
import {
  ExecutionActualsEditor,
  executionActualsDraft,
  parseExecutionActualsDraft,
  type ExecutionActualsDraft,
} from "./execution-actuals-editor";
import { useCallback, useMemo, useState } from "react";
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
};
export function CommercialExecutionView({
  plan,
  compact = false,
}: {
  plan: CommercialWeekPlan;
  compact?: boolean;
}) {
  const visuals = useVisualLibrary();
  const { sqlite, deviceId } = useLocalDatabase(),
    { syncNow, status: syncStatus } = useSync(),
    repo = useMemo(
      () => new CommercialExecutionRepository(sqlite, digest),
      [sqlite],
    );
  const [loadedRevision, setLoadedRevision] = useState<string>();
  const [filter, setFilter] = useState<ExecutionFilter>("TODO");
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
    }, [refresh, syncStatus, plan.revisionId]),
  );
  async function edit(
    p: CommercialExecutionProposal,
    r: LocalCommercialExecution | null,
    sourcePlan: CommercialWeekPlan,
  ) {
    setNoteError(undefined);
    setActualsError(undefined);
    setActualsOpen(false);
    setError(undefined);
    setEditor({
      proposal: p,
      record: r,
      status: r?.entity.status ?? "TODO",
      note: r?.entity.note ?? "",
      actuals: executionActualsDraft(r?.entity.actuals),
      plan: sourcePlan,
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
  async function save() {
    if (!editor || busy) return;
    setError(undefined);
    setNoteError(undefined);
    setActualsError(undefined);
    const now = new Date().toISOString(),
      old = editor.record?.entity;
    let actuals;
    try {
      actuals = parseExecutionActualsDraft(editor.actuals);
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
      ...editor.proposal,
      ...(actuals === null && old?.actuals === undefined ? {} : { actuals }),
      status: editor.status,
      note: editor.note,
      completedAt:
        editor.status === "DONE"
          ? old?.status === "DONE"
            ? old.completedAt
            : now
          : null,
      version:
        (editor.record?.syncState === "ERROR"
          ? (editor.record.remoteVersion ?? 0)
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
      setBusy(false);
    }
  }
  function closeEditor() {
    if (busy) return;
    const changed =
      editor &&
      (editor.status !== (editor.record?.entity.status ?? "TODO") ||
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
  return (
    <SectionCard
      title={
        compact ? "Vos tâches" : `Suivi d’exécution · version ${plan.version}`
      }
      description="Affiches et TG du plan validé. Ouvrez une tâche pour déclarer sa réalisation."
    >
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
      {loaded ? (
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
    </SectionCard>
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
  editor: Pick<Editor, "proposal" | "status" | "note" | "actuals" | "plan"> & {
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
  return (
    <BottomSheet
      visible
      title="Déclarer la tâche"
      onClose={onClose}
      swipeToClose
      avoidKeyboard
    >
      <View className="gap-4">
        <Text className="font-semibold text-ink">{editor.proposal.label}</Text>
        <Text className="text-sm text-muted">
          Plan version {editor.proposal.planVersion} · Choisissez le statut
          constaté. La date de déclaration est distincte des dates réelles
          facultatives.
        </Text>
        <Text className="text-sm leading-5 text-muted">
          {executionTaskContext(editor.plan, editor.proposal.targetId)}
        </Text>
        {editor.record?.entity.completedAt ? (
          <Text className="text-sm text-muted">
            Déclaré fait le{" "}
            {new Date(editor.record.entity.completedAt).toLocaleString("fr-FR")}
          </Text>
        ) : null}
        {error ? (
          <InlineAlert title="Déclaration non enregistrée" message={error} />
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
              className={`min-h-12 justify-center rounded-2xl border px-4 py-3 ${editor.status === status ? "border-forest bg-forest-soft" : "border-line bg-surface"}`}
            >
              <Text
                className={
                  editor.status === status
                    ? "font-semibold text-forest"
                    : "text-ink"
                }
              >
                {editor.status === status ? "✓ " : ""}
                {executionStatusLabels[status]}
              </Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          accessibilityLabel="Note ou motif de la déclaration"
          value={editor.note}
          editable={!busy}
          multiline
          maxLength={1200}
          placeholder="Note ; motif requis pour Ignoré ou Non applicable"
          placeholderTextColor={colors.muted}
          onChangeText={(note) => onChange({ note })}
          className={`min-h-20 rounded-xl border p-3 text-ink ${noteError ? "border-danger" : "border-line"}`}
        />
        {Object.values(editor.actuals).some((value) => value.trim()) ? (
          <Text className="text-sm text-muted">
            Détails de réalisation renseignés. Vous pouvez les consulter ou les
            modifier ci-dessous.
          </Text>
        ) : null}
        <View
          className={`gap-3 rounded-2xl ${actualsError ? "border border-danger p-3" : ""}`}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dates, prix et emplacement réels (facultatif)"
            aria-expanded={actualsOpen}
            accessibilityState={{ expanded: actualsOpen }}
            onPress={onToggleActuals}
            className="min-h-12 flex-row items-center justify-between gap-2"
          >
            <Text className="flex-1 text-sm text-muted">
              Dates, prix et emplacement réels (facultatif)
            </Text>
            <Text className="text-lg text-muted">
              {actualsOpen ? "−" : "+"}
            </Text>
          </Pressable>
          {actualsOpen ? (
            <ExecutionActualsEditor
              value={editor.actuals}
              disabled={busy}
              onChange={(actuals) => onChange({ actuals })}
            />
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
        <PrimaryButton
          label={busy ? "Enregistrement…" : "Enregistrer la déclaration"}
          disabled={busy}
          onPress={onSave}
        />
      </View>
    </BottomSheet>
  );
}
