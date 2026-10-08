import { CommercialVersionDecisionList } from "@/commercial/version-decision-list";
import { buildCommercialDocumentSummary } from "@fl-copilot/commercial-core";
import { CommercialReviewRepository } from "@/commercial/review-repository";
import type { CommercialReviewPage } from "@fl-copilot/sync-contracts";
import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { router, type Href, useFocusEffect } from "expo-router";
import { requireOptionalNativeModule } from "expo-modules-core";
import { randomUUID } from "expo-crypto";
import type { LocalSourceDocument } from "@fl-copilot/domain";
import { useSync } from "@/sync/sync-provider";
import { commercialPdfUploadPresentation } from "@/documents/commercial-pdf-upload";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { SourceDocumentRepository } from "@/documents/source-document-repository";
import { captureCommercialPdf } from "@/documents/commercial-pdf-capture";
import {
  AppScreen,
  AppHeader,
  EmptyState,
  InlineAlert,
  PrimaryButton,
  SectionCard,
  SecondaryButton,
} from "@/components/ui";

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
  const { session } = useAuth();
  const { syncNow, status: syncStatus } = useSync();
  const { sqlite } = useLocalDatabase();
  const storeId = session?.stores[0]?.storeId;
  const repository = useMemo(
    () => new SourceDocumentRepository(sqlite),
    [sqlite],
  );
  const reviews = useMemo(
    () => new CommercialReviewRepository(sqlite),
    [sqlite],
  );
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
  const readDocuments = useCallback(async () => {
    if (!storeId) return { items: [], jobs: {} };
    const items = await repository.listDocuments(
      storeId,
      "WEEKLY_COMMERCIAL_PDF",
    );
    const entries = await Promise.all(
      items.map(
        async (item) =>
          [
            item.id,
            await repository.commercialPdfUploadJob(item.id, storeId),
          ] as const,
      ),
    );
    return {
      items,
      jobs: Object.fromEntries(entries),
      pages: await reviews.pages(storeId),
      decisions: await reviews.decisions(storeId),
    };
  }, [repository, reviews, storeId]);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      const refresh = () => {
        void readDocuments()
          .then((result) => {
            if (active) {
              setDocuments(result.items);
              setJobs(result.jobs);
              setReviewPages(result.pages ?? []);
              setReviewDecisions(result.decisions ?? []);
            }
          })
          .catch(() => {
            if (active)
              setError(
                "Les documents enregistrés ne peuvent pas être lus. Réouvrez cet écran pour réessayer.",
              );
          });
      };
      refresh();
      const interval = setInterval(refresh, 2000);
      return () => {
        active = false;
        clearInterval(interval);
      };
    }, [readDocuments]),
  );

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
      const refreshed = await readDocuments();
      setDocuments(refreshed.items);
      setJobs(refreshed.jobs);
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
    <AppScreen>
      <AppHeader
        title="Ma semaine"
        subtitle="Préparer les temps forts du rayon."
      />
      <SecondaryButton
        label="Préparer mon plan de semaine et mes TG"
        onPress={() => router.push("/week-preparation")}
      />
      <SecondaryButton
        label="Comparer un PDF corrigé"
        onPress={() => router.push("/commercial-comparison")}
      />
      {storeId ? <CommercialVersionDecisionList storeId={storeId} /> : null}
      <SectionCard
        title="Documents commerciaux"
        description="Conservez les PDF du rayon sur cet appareil, même hors connexion."
      >
        <PrimaryButton
          label={busy ? "Enregistrement…" : "Importer le PDF hebdo"}
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
          Le PDF sera envoyé dès que la connexion le permet. Consultez ensuite
          la synthèse commerciale, même hors connexion.
        </Text>
      </SectionCard>
      {message ? (
        <InlineAlert title="Document enregistré" message={message} />
      ) : null}
      {error ? <InlineAlert title="Import impossible" message={error} /> : null}
      {documents.map((document) => {
        const state = commercialPdfUploadPresentation(
          document,
          jobs[document.id] ?? null,
        );
        const pages = reviewPages.filter(
          (page) => page.sourceDocumentId === document.id,
        );
        const summary = buildCommercialDocumentSummary(pages, reviewDecisions);
        return (
          <SectionCard
            key={document.id}
            title={document.originalFilename ?? "Document commercial"}
          >
            <View className="gap-2">
              <Text className="text-sm text-muted">
                Enregistré le{" "}
                {new Date(document.createdAt).toLocaleDateString("fr-FR")}
              </Text>
              <Text className="font-semibold text-forest">
                {pages.length ? "Analyse reçue" : state.title}
              </Text>
              <Text className="text-sm text-muted">
                {pages.length
                  ? `${summary.offerCount} offres à consulter · ${summary.questions.length} points regroupés à clarifier`
                  : state.message}
              </Text>
              {pages.length ? (
                <PrimaryButton
                  label="Voir la synthèse commerciale"
                  onPress={() =>
                    router.push(`/commercial-review/${document.id}` as Href)
                  }
                />
              ) : null}
              {state.canRetry ? (
                <SecondaryButton
                  label={
                    sendingId === document.id
                      ? "Envoi…"
                      : jobs[document.id]?.status === "RETRY"
                        ? "Réessayer l’envoi"
                        : "Envoyer le PDF"
                  }
                  disabled={!!sendingId || syncStatus === "syncing"}
                  onPress={() => {
                    if (!storeId) return;
                    setSendingId(document.id);
                    setError(undefined);
                    void repository
                      .retryCommercialPdfUpload(document.id, storeId)
                      .then(() => syncNow(storeId))
                      .then(readDocuments)
                      .then((result) => {
                        setDocuments(result.items);
                        setJobs(result.jobs);
                        setReviewPages(result.pages ?? []);
                        setReviewDecisions(result.decisions ?? []);
                      })
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
        );
      })}
      {[...new Set(reviewPages.map((page) => page.sourceDocumentId))]
        .filter(
          (sourceId) => !documents.some((document) => document.id === sourceId),
        )
        .map((sourceId) => {
          const pages = reviewPages.filter(
            (page) => page.sourceDocumentId === sourceId,
          );
          const summary = buildCommercialDocumentSummary(
            pages,
            reviewDecisions,
          );
          return (
            <SectionCard
              key={`review:${sourceId}`}
              title={pages[0]?.originalFilename ?? "Communication commerciale"}
              description={`${summary.offerCount} offres à consulter · ${summary.questions.length} points regroupés à clarifier`}
            >
              <Text className="text-sm text-muted">
                Les offres et consignes sont regroupées pour préparer la
                semaine. Aucune offre n’est publiée automatiquement.
              </Text>
              <PrimaryButton
                label="Voir la synthèse commerciale"
                onPress={() =>
                  router.push(`/commercial-review/${sourceId}` as Href)
                }
              />
            </SectionCard>
          );
        })}
      <EmptyState
        title="Aucune opération publiée"
        message="Les extraits examinés restent séparés des opérations à préparer. Aucune offre n’est publiée automatiquement."
        icon="calendar-outline"
      />
    </AppScreen>
  );
}
