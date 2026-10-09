import { useCallback, useMemo, useState } from "react";
import { Text, TextInput, View, Modal, Alert } from "react-native";
import { useFocusEffect, router } from "expo-router";
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
  AppScreen,
  AppHeader,
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
} from "./execution-presentation";
import { commercialMechanismDescription } from "./choice-presentation";
const digest = (s: string) =>
  digestStringAsync(CryptoDigestAlgorithm.SHA256, s);
type Editor = {
  proposal: CommercialExecutionProposal;
  record: LocalCommercialExecution | null;
  status: CommercialExecutionTask["status"];
  note: string;
  plan: CommercialWeekPlan;
};
export function CommercialExecutionView({
  plan,
}: {
  plan: CommercialWeekPlan;
}) {
  const { sqlite, deviceId } = useLocalDatabase(),
    { syncNow, status: syncStatus } = useSync(),
    repo = useMemo(
      () => new CommercialExecutionRepository(sqlite, digest),
      [sqlite],
    );
  const [proposals, setProposals] = useState<CommercialExecutionProposal[]>([]),
    [records, setRecords] = useState<LocalCommercialExecution[]>([]),
    [editor, setEditor] = useState<Editor | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [notice, setNotice] = useState<string>(),
    [noteError, setNoteError] = useState<string>();
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
    }, [refresh, syncStatus]),
  );
  async function edit(
    p: CommercialExecutionProposal,
    r: LocalCommercialExecution | null,
    sourcePlan: CommercialWeekPlan,
  ) {
    setNoteError(undefined);
    setError(undefined);
    setEditor({
      proposal: p,
      record: r,
      status: r?.entity.status ?? "TODO",
      note: r?.entity.note ?? "",
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
    const now = new Date().toISOString(),
      old = editor.record?.entity;
    const parsed = commercialExecutionTaskSchema.safeParse({
      ...editor.proposal,
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
        editor.note !== (editor.record?.entity.note ?? ""));
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
  const progress = commercialExecutionProgress(
      proposals,
      records.map((r) => r.entity),
    ),
    others = records.filter(
      (r) => !proposals.some((p) => commercialExecutionSameTarget(r.entity, p)),
    );
  return (
    <SectionCard
      title={`Suivi d’exécution · version ${plan.version}`}
      description="Notez séparément les affiches imprimées et les TG installées. Marquer Fait ne confirme ni toute la promotion, ni un prix appliqué en caisse, ni un résultat de vente."
    >
      <Text className="text-base text-ink">
        {progress.DONE}/{progress.total} tâches faites · {progress.TODO} à faire
        · {progress.SKIPPED} ignorées · {progress.NOT_APPLICABLE} non
        applicables
      </Text>
      <Text className="text-sm text-muted">
        Chaque version du plan possède son propre suivi. Les propositions À
        faire ne créent aucun événement tant que vous n’enregistrez pas une
        déclaration.
      </Text>
      {notice ? <InlineAlert title="Enregistré" message={notice} /> : null}
      {error ? (
        <InlineAlert title="Déclaration à vérifier" message={error} />
      ) : null}
      {proposals.map((p) => {
        const r = records.find((r) =>
            commercialExecutionSameTarget(r.entity, p),
          ),
          offer = plan.offers.find((o) => o.id === p.targetId),
          tg = plan.preparation.placements.find((t) => t.id === p.targetId);
        return (
          <SectionCard key={p.id} title={p.label}>
            <Text className="font-semibold text-ink">
              {executionStatusLabels[r?.entity.status ?? "TODO"]}
            </Text>
            {offer ? (
              <Text className="text-sm text-muted">
                Cadre de prix prévu :{" "}
                {commercialMechanismDescription(offer.customerMechanism)}.
                Vérifiez l’affiche avant impression.
              </Text>
            ) : null}
            {tg ? (
              <Text className="text-sm text-muted">
                {plan.offers
                  .filter((o) => tg.offerIds.includes(o.choiceId))
                  .map((o) => o.rawProductLabel)
                  .join(" · ")}
              </Text>
            ) : null}
            {r?.entity.note ? (
              <Text selectable className="text-base text-ink">
                {r.entity.note}
              </Text>
            ) : null}
            {r?.entity.completedAt ? (
              <Text className="text-sm text-muted">
                Déclaré fait le{" "}
                {new Date(r.entity.completedAt).toLocaleString("fr-FR")}
              </Text>
            ) : null}
            {r ? (
              <Text className="text-sm text-muted">
                {(
                  {
                    PENDING: "À synchroniser",
                    SYNCED: "Synchronisé",
                    CONFLICT: "Conflit à résoudre",
                    ERROR: "Envoi refusé : déclaration locale conservée",
                  } as Record<string, string>
                )[r.syncState] ?? r.syncState}
              </Text>
            ) : null}
            {r?.syncState === "ERROR" ? (
              <InlineAlert
                title="Envoi refusé"
                message={commercialExecutionError(r.lastErrorCode ?? undefined)}
              />
            ) : null}
            <SecondaryButton
              label={
                r?.syncState === "CONFLICT"
                  ? "Comparer dans Synchronisation"
                  : "Mettre à jour cette tâche"
              }
              disabled={busy}
              onPress={() =>
                r?.syncState === "CONFLICT"
                  ? router.push("/sync-center")
                  : void edit(p, r ?? null, plan)
              }
            />
          </SectionCard>
        );
      })}
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
        <Modal
          visible
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={closeEditor}
        >
          <AppScreen>
            <AppHeader
              title="Mettre à jour la tâche"
              subtitle={`Plan version ${editor.proposal.planVersion}`}
            />
            <SectionCard
              title={`Modifier la déclaration · version ${editor.proposal.planVersion}`}
            >
              <Text className="font-semibold text-ink">
                {editor.proposal.label}
              </Text>
              <Text className="text-sm text-muted">
                Cette modification reste liée à la copie du plan choisie à
                l’ouverture. La date indique le moment où vous déclarez la tâche
                faite.
              </Text>
              {(
                Object.keys(
                  executionStatusLabels,
                ) as CommercialExecutionTask["status"][]
              ).map((status) => (
                <SecondaryButton
                  key={status}
                  label={`${editor.status === status ? "✓ " : ""}${executionStatusLabels[status]}`}
                  disabled={busy}
                  onPress={() =>
                    setEditor((e) => (e ? { ...e, status } : null))
                  }
                />
              ))}
              <TextInput
                accessibilityLabel="Note ou motif de la déclaration"
                value={editor.note}
                editable={!busy}
                multiline
                maxLength={1200}
                placeholder="Note ; motif requis pour Ignoré ou Non applicable"
                onChangeText={(note) =>
                  setEditor((e) => (e ? { ...e, note } : null))
                }
                className={`rounded-xl border p-3 text-ink ${noteError ? "border-danger" : "border-line"}`}
              />
              {noteError ? (
                <Text accessibilityRole="alert" className="text-danger">
                  {noteError}
                </Text>
              ) : null}
              <PrimaryButton
                label={busy ? "Enregistrement…" : "Enregistrer le statut"}
                disabled={busy}
                onPress={() => void save()}
              />
              <SecondaryButton
                label="Fermer sans enregistrer"
                disabled={busy}
                onPress={closeEditor}
              />
            </SectionCard>
          </AppScreen>
        </Modal>
      ) : null}
    </SectionCard>
  );
}
