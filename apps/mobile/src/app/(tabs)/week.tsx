import { CommercialOriginalButton } from "../../commercial/original-button";
import { CommercialAnalysisRecoveryPanel } from "../../commercial/analysis-recovery-panel";
import { WeeklySubstitutesView } from "../../commercial/substitute-view";
import { currentCommercialWeek } from "@fl-copilot/commercial-core";
import { WeeklyContextView } from "../../store/weekly-context-view";
import { CommercialVersionDecisionList } from "../../commercial/version-decision-list";
import {
  commercialDocumentPage,
  commercialDocumentRows,
  type CommercialDocumentFilter,
} from "../../documents/commercial-document-list";
import { IconButton, SegmentedControl } from "../../components/dashboard";
import { CommercialReviewRepository } from "../../commercial/review-repository";
import type { CommercialReviewPage } from "@fl-copilot/sync-contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, TextInput, View, type ScrollView } from "react-native";
import { colors } from "../../design/tokens";
import { router, type Href, useIsFocused } from "expo-router";
import { requireOptionalNativeModule } from "expo-modules-core";
import { randomUUID } from "expo-crypto";
import type { LocalSourceDocument } from "@fl-copilot/domain";
import { useSync } from "../../sync/sync-provider";
import { useAuth } from "../../auth/auth-provider";
import { useLocalDatabase } from "../../providers/database-provider";
import { SourceDocumentRepository } from "../../documents/source-document-repository";
import { captureCommercialPdf } from "../../documents/commercial-pdf-capture";
import {
  AppScreen,
  AppHeader,
  EmptyState,
  InlineAlert,
  PrimaryButton,
  SectionCard,
  SecondaryButton,
} from "../../components/ui";

interface NativePdfPicker {
  getDocumentAsync(options: {
    type: string[];
    copyToCacheDirectory: boolean;
    multiple: boolean;
    base64: boolean;
  }): Promise<
    | { canceled: true }
    | {
        canceled: false;
        assets: Array<{ uri: string; name: string; mimeType?: string }>;
      }
  >;
}
const picker =
  requireOptionalNativeModule<NativePdfPicker>("ExpoDocumentPicker");

export default function WeekScreen() {
  const { session } = useAuth(),
    storeId = session?.stores[0]?.storeId,
    ownerId = session?.user.id;
  return storeId && ownerId ? (
    <StoreWeekScreen key={`${storeId}:${ownerId}`} />
  ) : (
    <AppScreen>
      <AppHeader title="Documents commerciaux" />
      <InlineAlert
        title="Aucun magasin actif"
        message="Reconnectez-vous pour retrouver les documents de votre magasin."
      />
    </AppScreen>
  );
}
function StoreWeekScreen() {
  const focused = useIsFocused();
  const { session } = useAuth();
  const sync = useSync();
  const { syncNow, status: syncStatus } = sync;
  const readRevision =
    syncStatus === "syncing"
      ? "syncing"
      : JSON.stringify([
          sync.pendingCommandCount ?? sync.pendingCount,
          sync.conflictCount,
          sync.failedCount,
          sync.lastSyncedAt,
          syncStatus,
        ]);
  const { sqlite } = useLocalDatabase();
  const storeId = session?.stores[0]?.storeId;
  const canRetryUpload = useRef({
      allowed: false,
      storeId,
      ownerId: session?.user.id,
    }),
    focusedForUpload = useRef(false);
  canRetryUpload.current = {
    allowed: session?.stores[0]?.role === "MANAGER",
    storeId,
    ownerId: session?.user.id,
  };
  const repository = useMemo(
    () => new SourceDocumentRepository(sqlite),
    [sqlite],
  );
  const reviews = useMemo(
    () => new CommercialReviewRepository(sqlite),
    [sqlite],
  );
  const [preparation, setPreparation] = useState(false);
  const [preparationLoaded, setPreparationLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CommercialDocumentFilter>("ALL");
  const [page, setPage] = useState(0);
  const scroll = useRef<ScrollView>(null),
    listTop = useRef(0),
    focusSource = useRef<string | undefined>(undefined);
  const changePage = useCallback((next: number) => {
    focusSource.current = undefined;
    setPage(next);
    scroll.current?.scrollTo({ y: listTop.current, animated: false });
  }, []);
  const readGeneration = useRef(0);
  const [readComplete, setReadComplete] = useState(false);
  const [readError, setReadError] = useState<string>();
  const [reviewPages, setReviewPages] = useState<CommercialReviewPage[]>([]);
  const [reviewDecisions, setReviewDecisions] = useState<
    Awaited<ReturnType<CommercialReviewRepository["decisions"]>>
  >([]);
  const [documents, setDocuments] = useState<LocalSourceDocument[]>([]);
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<
    Record<string, { status: string; last_error: string | null } | null>
  >({});
  const [sendingId, setSendingId] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const rows = useMemo(
    () => commercialDocumentRows(documents, reviewPages, reviewDecisions, jobs),
    [documents, reviewPages, reviewDecisions, jobs],
  );
  const visible = useMemo(
    () => commercialDocumentPage(rows, query, filter, page),
    [rows, query, filter, page],
  );
  const readDocuments = useCallback(async () => {
    if (!storeId) return { items: [], jobs: {}, pages: [], decisions: [] };
    const [items, jobs, pages, decisions] = await Promise.all([
      repository.listDocuments(storeId, "WEEKLY_COMMERCIAL_PDF"),
      repository.listCommercialPdfUploadJobs(storeId),
      reviews.pages(storeId),
      reviews.decisions(storeId),
    ]);
    return { items, jobs, pages, decisions };
  }, [repository, reviews, storeId]);
  const refreshDocuments = useCallback(async () => {
    if (!focusedForUpload.current) return;
    const version = ++readGeneration.current;
    try {
      const result = await readDocuments();
      if (version !== readGeneration.current || !focusedForUpload.current)
        return;
      setDocuments(result.items);
      setJobs(result.jobs);
      setReviewPages(result.pages);
      setReviewDecisions(result.decisions);
      setReadError(undefined);
      if (focusSource.current) {
        const index = result.items.findIndex(
          (item) => item.id === focusSource.current,
        );
        changePage(Math.max(0, Math.floor(index / 10)));
      }
    } catch {
      if (version === readGeneration.current && focusedForUpload.current)
        setReadError(
          "Les documents enregistrés ne peuvent pas être relus. Les données déjà affichées restent conservées.",
        );
    } finally {
      if (version === readGeneration.current && focusedForUpload.current)
        setReadComplete(true);
    }
  }, [readDocuments, changePage]);
  useEffect(() => {
    if (!focused) return;
    focusedForUpload.current = true;
    void refreshDocuments();
    return () => {
      focusedForUpload.current = false;
      readGeneration.current += 1;
    };
  }, [focused, refreshDocuments, readRevision]);

  async function importPdf() {
    if (!storeId || !picker || busy) return;
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const selection = await picker.getDocumentAsync({
        type: ["application/pdf"],
        copyToCacheDirectory: true,
        multiple: false,
        base64: false,
      });
      if (selection.canceled) return;
      const asset = selection.assets[0];
      if (!asset) throw new Error("COMMERCIAL_PDF_INVALID");
      const result = await captureCommercialPdf(
        {
          uri: asset.uri,
          originalFilename: asset.name,
          mimeType: asset.mimeType,
          storeId,
          documentId: randomUUID(),
          fileId: randomUUID(),
          capturedAt: new Date().toISOString(),
        },
        repository,
      );
      setMessage(
        result.duplicate
          ? "Ce PDF est déjà enregistré. Aucune nouvelle copie n’a été ajoutée."
          : "Document enregistré sur cet appareil, disponible hors connexion.",
      );
      setQuery("");
      setFilter("ALL");
      focusSource.current = result.document.id;
      await refreshDocuments();
      void syncNow(storeId);
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "";
      setError(
        code === "COMMERCIAL_PDF_INVALID"
          ? "Ce fichier n’est pas un PDF reconnu. Choisissez le document commercial au format PDF."
          : code === "COMMERCIAL_PDF_SIZE_INVALID"
            ? "Le PDF est vide ou dépasse 100 Mo. Choisissez un document plus petit."
            : "Le PDF n’a pas pu être enregistré. Le fichier original reste conservé. Réessayez l’import.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppScreen scrollRef={scroll} keyboardAware>
      <AppHeader
        title="Documents commerciaux"
        subtitle="Vos PDF et leurs analyses, disponibles après réception."
      />
      <View className="gap-2">
        <PrimaryButton
          label={busy ? "Enregistrement…" : "Importer un PDF"}
          loading={busy}
          disabled={!storeId || !picker}
          onPress={() => void importPdf()}
        />
        {!picker ? (
          <InlineAlert
            title="Mise à jour nécessaire"
            message="Installez le dernier build de l’application pour choisir un PDF."
          />
        ) : null}
        <Text className="text-sm leading-5 text-muted">
          L’original reste disponible hors connexion après l’import. L’envoi
          reprend dès que la connexion le permet.
        </Text>
      </View>
      {message ? (
        <InlineAlert title="Document enregistré" message={message} />
      ) : null}
      {error ? <InlineAlert title="Import impossible" message={error} /> : null}
      {readError ? (
        <>
          <InlineAlert title="Lecture interrompue" message={readError} />
          {!rows.length ? (
            <SecondaryButton
              label="Relire les documents"
              onPress={() => void refreshDocuments()}
            />
          ) : null}
        </>
      ) : null}
      {!readComplete ? (
        <Text className="text-muted">Lecture des documents enregistrés…</Text>
      ) : null}
      {rows.length ? (
        <View
          className="gap-3"
          onLayout={(event) => {
            listTop.current = event.nativeEvent.layout.y;
          }}
        >
          <View className="flex-row items-center justify-between gap-3">
            <Text
              accessibilityRole="header"
              className="flex-1 text-xl font-semibold text-ink"
            >
              Vos documents
            </Text>
            <IconButton
              label="Relire les documents"
              icon="refresh-outline"
              onPress={() => void refreshDocuments()}
            />
          </View>
          <TextInput
            accessibilityLabel="Rechercher un PDF par nom ou date d’import"
            placeholder="Nom du PDF ou date d’import"
            placeholderTextColor={colors.muted}
            value={query}
            onChangeText={(value) => {
              focusSource.current = undefined;
              setQuery(value);
              setPage(0);
            }}
            autoCorrect={false}
            className="min-h-12 rounded-2xl border border-line bg-surface px-4 py-3 text-ink"
          />
          <SegmentedControl
            label="Filtrer les documents"
            value={filter}
            options={
              [
                { value: "ALL", label: "Tous" },
                { value: "PENDING", label: "En attente" },
                { value: "RESULTS", label: "Résultats reçus" },
                { value: "ATTENTION", label: "À vérifier" },
              ] as const
            }
            onChange={(value) => {
              focusSource.current = undefined;
              setFilter(value);
              setPage(0);
            }}
          />
          <Text accessibilityLiveRegion="polite" className="text-sm text-muted">
            {visible.total
              ? `${visible.page * 10 + 1}–${visible.page * 10 + visible.items.length} sur ${visible.total} documents`
              : "Aucun document pour ces critères"}
          </Text>
          {!visible.total ? (
            <SecondaryButton
              label="Réinitialiser les filtres"
              onPress={() => {
                focusSource.current = undefined;
                setQuery("");
                setFilter("ALL");
                setPage(0);
              }}
            />
          ) : null}
          {visible.items.map(
            ({
              id: sourceId,
              title,
              document,
              pages,
              summary,
              upload: state,
              attention,
            }) => (
              <SectionCard key={sourceId} title={title}>
                <View className="gap-2">
                  <Text className="text-sm text-muted">
                    {document
                      ? `Enregistré le ${new Date(document.createdAt).toLocaleDateString("fr-FR")}`
                      : "Analyse issue de la synchronisation"}
                  </Text>
                  <Text
                    className={`font-semibold ${attention ? "text-warning" : "text-forest"}`}
                  >
                    {pages.length ? "Résultats reçus" : state?.title}
                  </Text>
                  <Text className="text-sm text-muted">
                    {pages.length
                      ? `${summary.offerCount} offres à consulter · ${summary.questions.length} points regroupés à clarifier`
                      : state?.message}
                  </Text>
                  {attention && pages.length ? (
                    <Text className="text-sm text-warning">
                      Une étape reste à vérifier. Les résultats reçus sont
                      conservés.
                    </Text>
                  ) : null}
                  <CommercialOriginalButton sourceDocumentId={sourceId} />
                  {pages.length ? (
                    <PrimaryButton
                      label="Voir la synthèse commerciale"
                      onPress={() =>
                        router.push(`/commercial-review/${sourceId}` as Href)
                      }
                    />
                  ) : null}
                  {document?.remoteUploadStatus === "CONFIRMED" ? (
                    <CommercialAnalysisRecoveryPanel
                      sourceDocumentId={sourceId}
                    />
                  ) : null}
                  {document && state?.canRetry ? (
                    <SecondaryButton
                      label={
                        sendingId === sourceId
                          ? "Envoi…"
                          : jobs[sourceId]?.status === "RETRY"
                            ? "Réessayer l’envoi"
                            : "Envoyer le PDF"
                      }
                      disabled={
                        !!sendingId ||
                        syncStatus === "syncing" ||
                        !canRetryUpload.current.allowed
                      }
                      onPress={() => {
                        if (!storeId) return;
                        setSendingId(sourceId);
                        setError(undefined);
                        void repository
                          .retryCommercialPdfUpload(
                            sourceId,
                            storeId,
                            () =>
                              canRetryUpload.current.allowed &&
                              canRetryUpload.current.storeId === storeId &&
                              canRetryUpload.current.ownerId ===
                                session?.user.id &&
                              focusedForUpload.current,
                          )
                          .then(() => syncNow(storeId))
                          .then(() => refreshDocuments())
                          .catch(() =>
                            setError(
                              "L’envoi n’a pas pu reprendre. Le PDF reste conservé sur cet appareil.",
                            ),
                          )
                          .finally(() => setSendingId(undefined));
                      }}
                    />
                  ) : null}
                </View>
              </SectionCard>
            ),
          )}
          {visible.count > 1 ? (
            <View className="gap-2">
              <Text className="text-center text-sm text-muted">
                Page {visible.page + 1} sur {visible.count}
              </Text>
              <SecondaryButton
                label="Documents précédents"
                disabled={visible.page === 0}
                onPress={() => changePage(visible.page - 1)}
              />
              <SecondaryButton
                label="Documents suivants"
                disabled={visible.page === visible.count - 1}
                onPress={() => changePage(visible.page + 1)}
              />
            </View>
          ) : null}
        </View>
      ) : null}
      {readComplete &&
      !readError &&
      !documents.length &&
      !reviewPages.length ? (
        <EmptyState
          title="Aucun document commercial"
          message="Importez le PDF pour conserver l’original et retrouver son analyse dès qu’elle est reçue."
          icon="document-text-outline"
        />
      ) : null}
      <SecondaryButton
        expanded={preparation}
        label={
          preparation
            ? "Masquer le contexte et la préparation"
            : "Contexte et préparation de la semaine"
        }
        onPress={() => {
          setPreparationLoaded(true);
          setPreparation(!preparation);
        }}
      />
      {preparationLoaded ? (
        <View
          style={{ display: preparation ? "flex" : "none" }}
          accessibilityElementsHidden={!preparation}
          importantForAccessibility={
            preparation ? "auto" : "no-hide-descendants"
          }
          className="gap-6"
        >
          <SecondaryButton
            label="Préparer mon plan de semaine et mes TG"
            onPress={() => router.push("/week-preparation")}
          />
          <SecondaryButton
            label="Voir mon plan de semaine validé"
            onPress={() => router.push("/commercial-plan")}
          />
          <SecondaryButton
            label="Comparer un PDF corrigé"
            onPress={() => router.push("/commercial-comparison")}
          />
          {storeId ? <CommercialVersionDecisionList storeId={storeId} /> : null}
          {storeId ? <WeeklyContextView storeId={storeId} /> : null}
          {storeId ? (
            <WeeklySubstitutesView
              storeId={storeId}
              weekStart={currentCommercialWeek().start}
            />
          ) : null}
        </View>
      ) : null}
    </AppScreen>
  );
}
