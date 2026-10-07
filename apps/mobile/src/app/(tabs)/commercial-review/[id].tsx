import { captureScreenError } from "@/observability/sentry";
import { reconcileCommercialDraftPages } from "@fl-copilot/commercial-core";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  CommercialReviewRepository,
  reviewProgress,
} from "@/commercial/review-repository";
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
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const storeId = session?.stores[0]?.storeId;
  const { sqlite, deviceId } = useLocalDatabase();
  const { syncNow, status: syncStatus } = useSync();
  const repository = useMemo(
    () => new CommercialReviewRepository(sqlite),
    [sqlite],
  );
  const [pages, setPages] = useState<CommercialReviewPage[]>([]);
  const [decisions, setDecisions] = useState<
    Awaited<ReturnType<CommercialReviewRepository["decisions"]>>
  >([]);
  const [index, setIndex] = useState(0),
    [error, setError] = useState<string>(),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(false),
    [enlarged, setEnlarged] = useState(false);
  const [changes, setChanges] = useState<Record<string, string>>({});
  const refresh = useCallback(async () => {
    if (!storeId || typeof id !== "string") return;
    const [p, d] = await Promise.all([
      repository.pages(storeId, id),
      repository.decisions(storeId),
    ]);
    return { p, d };
  }, [repository, storeId, id]);
  const apply = useCallback((data: Awaited<ReturnType<typeof refresh>>) => {
    if (data) {
      setPages(data.p);
      setDecisions(data.d);
    }
    setLoading(false);
  }, []);
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
      // One local refresh may reveal an acknowledgement before a long sync cycle ends.
      const timer =
        syncStatus === "syncing" ? setTimeout(load, 1000) : undefined;
      return () => {
        active = false;
        if (timer) clearTimeout(timer);
      };
    }, [refresh, apply, syncStatus]),
  );
  const items = useMemo(() => commercialReviewItems(pages), [pages]);
  const item = items[index];
  const groups = useMemo(
    () =>
      storeId
        ? reconcileCommercialDraftPages({
            storeId,
            sourceDocumentId: id,
            pages: pages.map((page) => ({
              pageNumber: page.pageNumber,
              draft: {
                blocks: page.blocks,
                issues: page.issues,
                warnings: page.warnings,
              },
            })),
          })
        : [],
    [storeId, id, pages],
  );
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
  const progress = reviewProgress(pages, decisions);
  const choices = item
    ? decisions.filter(
        (d) =>
          d.decision.pageId === item.page.id &&
          d.decision.sourceBlockIndex === item.block.sourceBlockIndex,
      )
    : [];
  const localConflict = choices.find((d) => d.state === "CONFLICT");
  const remoteChoice = choices.find((d) => d.state === "SYNCED");
  const conflictIndex = items.findIndex((x) =>
    decisions.some(
      (d) =>
        d.state === "CONFLICT" &&
        d.decision.pageId === x.page.id &&
        d.decision.sourceBlockIndex === x.block.sourceBlockIndex,
    ),
  );
  function navigate(next: number) {
    const move = () => setIndex(next);
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
  async function submit(decision: "CONFIRMED_TRANSCRIPTION" | "DISMISSED") {
    if (!storeId || !item || busy || choices.length) return;
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
      );
      apply(await refresh());
      setEditing(false);
      void syncNow(storeId);
    } catch (reason) {
      captureScreenError(reason, "commercial-review");
      setError(
        "Votre choix n’a pas pu être enregistré. L’extrait reste à examiner. Réessayez.",
      );
    } finally {
      setBusy(false);
    }
  }
  function confirm(decision: "CONFIRMED_TRANSCRIPTION" | "DISMISSED") {
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
          onPress: () => void submit(decision),
        },
      ],
    );
  }
  return (
    <AppScreen key={item?.key ?? "pending"}>
      <AppHeader
        title="Examiner le document"
        subtitle={pages[0]?.originalFilename ?? "Communication commerciale"}
      />
      <SecondaryButton
        label="Retour à Ma semaine"
        onPress={() => router.replace("/week" as Href)}
      />
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
      {pages.length ? (
        <SectionCard
          title={`${progress.examined} sur ${progress.total} éléments examinés`}
          description={`${progress.remaining} à examiner. Les transcriptions confirmées restent distinctes des offres commerciales validées.`}
        />
      ) : null}
      {conflictIndex >= 0 ? (
        <SecondaryButton
          label="Examiner le choix en conflit"
          onPress={() => navigate(conflictIndex)}
        />
      ) : null}
      {item ? (
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
              const correction = choices[0]?.decision.corrections.find(
                (c) => c.name === field.name,
              );
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
            {choices.map((choice) => (
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
            ))}
            {localConflict && remoteChoice ? (
              <SecondaryButton
                label="Conserver le choix synchronisé"
                disabled={busy}
                onPress={() =>
                  Alert.alert(
                    "Conserver le choix synchronisé ?",
                    "Le choix local restera dans l’historique et ne sera plus actif.",
                    [
                      { text: "Annuler", style: "cancel" },
                      {
                        text: "Conserver",
                        onPress: () => {
                          if (!storeId) return;
                          setBusy(true);
                          void repository
                            .useRemoteDecision(
                              storeId,
                              localConflict.decision.id,
                              remoteChoice.decision.id,
                            )
                            .then(refresh)
                            .then(apply)
                            .catch(() =>
                              setError(
                                "Le conflit n’a pas pu être résolu. Vos deux choix restent conservés.",
                              ),
                            )
                            .finally(() => setBusy(false));
                        },
                      },
                    ],
                  )
                }
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
            label="Élément précédent"
            disabled={index === 0 || busy}
            onPress={() => navigate(index - 1)}
          />
          <PrimaryButton
            label="Élément suivant"
            disabled={index >= items.length - 1 || busy}
            onPress={() => navigate(index + 1)}
          />
          <SecondaryButton
            label="Prochain élément à examiner"
            disabled={
              busy ||
              !items.some(
                (x, i) =>
                  i > index &&
                  !decisions.some(
                    (d) =>
                      d.decision.pageId === x.page.id &&
                      d.decision.sourceBlockIndex === x.block.sourceBlockIndex,
                  ),
              )
            }
            onPress={() => {
              const next = items.findIndex(
                (x, i) =>
                  i > index &&
                  !decisions.some(
                    (d) =>
                      d.decision.pageId === x.page.id &&
                      d.decision.sourceBlockIndex === x.block.sourceBlockIndex,
                  ),
              );
              if (next >= 0) navigate(next);
            }}
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
