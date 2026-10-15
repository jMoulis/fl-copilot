import {
  confirmKnowledgeSuggestion,
  loadKnowledgeSuggestion,
} from "@/copilot/knowledge-suggestion";
import { useCallback, useMemo, useRef, useState } from "react";
import { Text, TextInput, View, Alert } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { randomUUID } from "expo-crypto";
import type { CopilotKnowledge } from "@fl-copilot/domain";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import {
  AppScreen,
  AppHeader,
  SectionCard,
  PrimaryButton,
  SecondaryButton,
  InlineAlert,
} from "@/components/ui";
import { CopilotKnowledgeRepository } from "@/copilot/knowledge-repository";
import { colors } from "@/design/tokens";
type Entry = Awaited<ReturnType<CopilotKnowledgeRepository["list"]>>[number];
export default function CopilotMemoryScreen() {
  const { session } = useAuth();
  return (
    <CopilotMemoryScreenContent
      key={`${session?.user.id}/${session?.stores[0]?.storeId}`}
    />
  );
}
function CopilotMemoryScreenContent() {
  const { session } = useAuth(),
    { sqlite, deviceId } = useLocalDatabase(),
    { syncNow } = useSync();
  const storeId = session?.stores[0]?.storeId,
    ownerId = session?.user.id;
  const writeLock = useRef(false);
  const params = useLocalSearchParams<{ source?: string; proposal?: string }>();
  const repo = useMemo(
    () =>
      storeId && ownerId
        ? new CopilotKnowledgeRepository(sqlite, { storeId, ownerId })
        : null,
    [sqlite, storeId, ownerId],
  );
  const [entries, setEntries] = useState<Entry[]>([]),
    [selected, setSelected] = useState<CopilotKnowledge>(),
    [statement, setStatement] = useState(""),
    [sourceId, setSourceId] = useState<string | null>(null),
    [proposalId, setProposalId] = useState<string>(),
    [proposalCompleted, setProposalCompleted] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [notice, setNotice] = useState<string>();
  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (repo)
        void (async () => {
          const rows = await repo.list();
          const proposal =
            params.proposal && storeId && ownerId
              ? await loadKnowledgeSuggestion(
                  sqlite,
                  { storeId, ownerId },
                  params.proposal,
                )
              : null;
          const source =
            params.source && !proposal
              ? await repo.source(params.source)
              : null;
          if (active) {
            setEntries(rows);
            if (proposal) {
              const existing = rows.find(
                (e) => e.entity.id === proposal.content.knowledgeId,
              );
              setProposalId(proposal.content.knowledgeId);
              setProposalCompleted(!!existing);
              setSelected(undefined);
              setSourceId(proposal.message.replyToMessageId);
              setStatement(proposal.content.suggestion.statement);
              if (existing)
                setNotice(
                  existing.entity.status === "FORGOTTEN"
                    ? "Cette proposition a déjà été traitée puis oubliée. Elle ne sera pas réactivée."
                    : "Cette proposition a déjà été mémorisée. Retrouvez-la dans la liste pour la modifier.",
                );
            } else if (source) {
              const existing = rows.find(
                (e) =>
                  e.entity.status === "ACTIVE" &&
                  e.entity.sourceMessageId === source.id,
              );
              setStatement(
                existing?.entity.statement ?? source.text.slice(0, 800),
              );
              setSourceId(source.id);
              setSelected(existing?.entity);
            }
          }
        })().catch(() => {
          if (active)
            setError(
              params.proposal
                ? "Cette proposition ne peut pas être ouverte : synchronisez le chat et vérifiez si un message a été corrigé."
                : "La mémoire ne peut pas être lue sur cet appareil.",
            );
        });
      return () => {
        active = false;
      };
    }, [repo, params.source, params.proposal, sqlite, storeId, ownerId]),
  );
  async function commit(forget = false, target = selected) {
    if (!repo || !storeId || !ownerId || writeLock.current) return;
    writeLock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const now = new Date().toISOString();
      let alreadyApplied = false;
      if (!target && proposalId && params.proposal) {
        const result = await confirmKnowledgeSuggestion(
          sqlite,
          { storeId, ownerId },
          params.proposal,
          statement,
          { commandId: randomUUID(), deviceId, now },
        );
        alreadyApplied = result.alreadyApplied;
      } else
        await repo.save(
          {
            id: target?.id ?? proposalId ?? randomUUID(),
            storeId,
            ownerId,
            scope: "USER_STORE",
            kind: "OPERATING_PRACTICE",
            statement: forget ? "Oublié" : statement,
            status: forget ? "FORGOTTEN" : "ACTIVE",
            sourceMessageId: target ? target.sourceMessageId : sourceId,
            confirmedBy: ownerId,
            version: (target?.version ?? 0) + 1,
            createdAt: target?.createdAt ?? now,
            updatedAt: now,
          },
          { commandId: randomUUID(), deviceId },
        );
      setEntries(await repo.list());
      setStatement("");
      setSelected(undefined);
      setSourceId(null);
      if (!target && proposalId) setProposalCompleted(true);
      setNotice(
        alreadyApplied
          ? "Cette proposition a déjà été traitée. La mémoire existante n’a pas été remplacée."
          : forget
            ? "Cette pratique ne sera plus utilisée après synchronisation. Le message d’origine reste dans son historique."
            : "Pratique confirmée sur cet appareil. Elle sera disponible dans vos autres conversations après synchronisation.",
      );
      void syncNow(storeId)
        .then(async () => setEntries(await repo.list()))
        .catch(() => undefined);
    } catch {
      setError(
        "Enregistrement impossible. Vérifiez la saisie et les éventuels conflits avant de réessayer.",
      );
    } finally {
      writeLock.current = false;
      setBusy(false);
    }
  }
  async function resolve(entry: Entry, local: boolean) {
    if (!repo || !storeId || writeLock.current) return;
    writeLock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await repo.resolve(entry.entity.id, local, {
        commandId: randomUUID(),
        deviceId,
      });
      setEntries(await repo.list());
      void syncNow(storeId)
        .then(async () => setEntries(await repo.list()))
        .catch(() => undefined);
    } catch {
      setError(
        "La version a changé. Rouvrez la mémoire avant de choisir une résolution.",
      );
    } finally {
      writeLock.current = false;
      setBusy(false);
    }
  }
  function edit(e: CopilotKnowledge) {
    setSelected(e);
    setProposalId(undefined);
    setProposalCompleted(false);
    setStatement(e.statement);
    setSourceId(e.sourceMessageId);
    setNotice(undefined);
  }
  return (
    <AppScreen>
      <AppHeader
        title="Mémoire du copilote"
        subtitle="Vos pratiques confirmées, privées à votre compte pour ce magasin. Réutilisées entre vos conversations après synchronisation."
      />
      <SecondaryButton label="Retour" onPress={() => router.back()} />
      {error ? (
        <InlineAlert title="Mémoire à vérifier" message={error} />
      ) : null}
      {notice ? <InlineAlert title="Enregistré" message={notice} /> : null}
      <SectionCard
        title={selected ? "Modifier une pratique" : "Retenir une pratique"}
        description="Ne saisissez pas de mot de passe, de secret ou de donnée personnelle sur un salarié. Une pratique ne remplace pas les chiffres ni leurs dates."
      >
        <TextInput
          accessibilityLabel="Pratique du magasin à mémoriser"
          multiline
          maxLength={800}
          value={statement}
          onChangeText={setStatement}
          editable={
            !busy &&
            !proposalCompleted &&
            !(params.proposal && !proposalId && !selected)
          }
          placeholder="Ex. La casse est scannée chaque jour et comptabilisée à la date de saisie, plusieurs fois par semaine."
          style={{
            minHeight: 120,
            color: colors.ink,
            borderColor: colors.line,
            borderWidth: 1,
            borderRadius: 12,
            padding: 12,
            fontSize: 16,
          }}
        />
        <PrimaryButton
          label={
            selected ? "Confirmer la modification" : "Confirmer et mémoriser"
          }
          disabled={
            busy ||
            proposalCompleted ||
            (!!params.proposal && !proposalId && !selected) ||
            !statement.trim()
          }
          onPress={() => {
            void commit();
          }}
        />
        {selected ? (
          <SecondaryButton
            label="Annuler la modification"
            disabled={busy}
            onPress={() => {
              setSelected(undefined);
              setStatement("");
              setSourceId(null);
            }}
          />
        ) : null}
      </SectionCard>
      {entries
        .filter((e) => e.entity.status === "ACTIVE" || e.syncState !== "SYNCED")
        .map((entry) => (
          <SectionCard
            key={entry.entity.id}
            title={
              entry.entity.status === "FORGOTTEN"
                ? "Oubli à synchroniser"
                : "Pratique confirmée"
            }
          >
            <Text
              selectable
              style={{ color: colors.ink, fontSize: 16, lineHeight: 24 }}
            >
              {entry.entity.statement}
            </Text>
            <Text style={{ color: colors.muted }}>
              {entry.syncState === "SYNCED"
                ? "Synchronisée"
                : entry.syncState === "PENDING"
                  ? "À synchroniser"
                  : entry.syncState === "CONFLICT"
                    ? "Conflit à résoudre"
                    : "Synchronisation à vérifier"}{" "}
              · {new Date(entry.entity.updatedAt).toLocaleDateString("fr-FR")}
              {entry.entity.sourceMessageId
                ? " · Issue d’un de vos messages"
                : " · Saisie confirmée"}
            </Text>
            {["CONFLICT", "ERROR"].includes(entry.syncState) ? (
              <View>
                {entry.remote ? (
                  <Text selectable style={{ color: colors.ink }}>
                    Version synchronisée : {entry.remote.statement}
                  </Text>
                ) : null}
                <SecondaryButton
                  label="Conserver ma version locale"
                  disabled={busy}
                  onPress={() => {
                    void resolve(entry, true);
                  }}
                />
                {entry.remote ? (
                  <SecondaryButton
                    label="Utiliser la version synchronisée"
                    disabled={busy}
                    onPress={() => {
                      void resolve(entry, false);
                    }}
                  />
                ) : null}
              </View>
            ) : entry.entity.status === "ACTIVE" ? (
              <View>
                <SecondaryButton
                  label="Modifier"
                  disabled={busy}
                  onPress={() => edit(entry.entity)}
                />
                <SecondaryButton
                  label="Oublier cette pratique"
                  disabled={busy}
                  onPress={() =>
                    Alert.alert(
                      "Oublier cette pratique ?",
                      "Elle ne sera plus transmise au copilote après synchronisation. Le message d’origine restera dans son historique.",
                      [
                        { text: "Annuler", style: "cancel" },
                        {
                          text: "Oublier",
                          style: "destructive",
                          onPress: () => {
                            void commit(true, entry.entity);
                          },
                        },
                      ],
                    )
                  }
                />
              </View>
            ) : null}
          </SectionCard>
        ))}
    </AppScreen>
  );
}
