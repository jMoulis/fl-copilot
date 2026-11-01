import { useIsFocused } from "expo-router";
import { SourceOriginalButton } from "./source-original-button";
import { SourceUploadRecoveryPanel } from "./source-upload-recovery-panel";
import { MercalysBatchPanel } from "./mercalys-batch-panel";
import { MercalysReconciliationReview } from "./mercalys-reconciliation-review";
import { readRetainedMercalysBytes } from "./read-retained-mercalys";
import {
  localOperationFailureCode,
  localOperationFailureMessage,
} from "../observability/local-operation-failure";
import { MercalysImportProductPicker } from "./mercalys-import-product-picker";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
  type ScrollView,
} from "react-native";
import { colors } from "../design/tokens";
import { requireOptionalNativeModule } from "expo-modules-core";
import { CryptoDigestAlgorithm, digest, randomUUID } from "expo-crypto";
import { Directory, File as ExpoFile, Paths } from "expo-file-system";
import type { Product, ProductMatchCatalog } from "@fl-copilot/domain";
import { useAuth } from "../auth/auth-provider";
import {
  AppHeader,
  AppScreen,
  InlineAlert,
  PrimaryButton,
  SecondaryButton,
  SectionCard,
} from "../components/ui";
import {
  MercalysImportValidationError,
  rematchMercalysImport,
  validateMercalysImport,
  type MercalysImportValidationSummary,
} from "./mercalys-import-validation";
import {
  MercalysExactDuplicateError,
  MercalysImportPublicationRepository,
  MercalysOverlapReconciliationError,
  type ExactDuplicateImport,
  type PublishedMercalysImport,
} from "./mercalys-import-publication";
import type { MercalysReconciliation } from "./mercalys-import-reconciliation";
import {
  buildMercalysProductResolutions,
  confirmMercalysProductMapping,
  correctMercalysProductMapping,
  createMercalysProducts,
  type MercalysProductResolution,
} from "./mercalys-product-resolution";
import { SheetJsSpreadsheetParser } from "./sheetjs-spreadsheet-parser";
import { ProductMasterRepository } from "../products/product-master-repository";
import { useLocalDatabase } from "../providers/database-provider";
import { useSync } from "../sync/sync-provider";
import {
  LocalAnalyticsRecomputationScheduler,
  SQLiteProductDateRecomputer,
} from "../analytics/local-recomputation";

type FilePublication = Pick<
  PublishedMercalysImport,
  "sourceDocumentId" | "publishedCount" | "remainingCount" | "replacedCount"
>;

type ImportProductCatalog = ProductMatchCatalog & {
  conflictedProductIds: readonly string[];
};

type ImportStage =
  "IDLE" | "READING" | "MATCHING" | "VALIDATING" | "COMPLETE" | "ERROR";

interface NativeDocumentPickerAsset {
  name: string;
  uri: string;
}

interface NativeDocumentPicker {
  getDocumentAsync(options: {
    type: string[];
    copyToCacheDirectory: boolean;
    multiple: boolean;
    base64: boolean;
  }): Promise<
    | { canceled: true; assets?: undefined }
    | { canceled: false; assets: NativeDocumentPickerAsset[] }
  >;
}

interface NativeFileSystem {
  FileSystemFile: new (uri: string) => {
    bytes(): Promise<Uint8Array<ArrayBuffer>>;
  };
}

const nativeDocumentPicker =
  requireOptionalNativeModule<NativeDocumentPicker>("ExpoDocumentPicker");
const nativeFileSystem =
  requireOptionalNativeModule<NativeFileSystem>("FileSystem");
const hasNativeFilePicker =
  nativeDocumentPicker !== null && nativeFileSystem !== null;

export function MercalysImportScreen({
  conversationId,
  onClose,
  onDiscuss,
  onBusyChange,
  onChanged,
  retainedAsset,
}: {
  retainedAsset?: NativeDocumentPickerAsset & { expectedChecksum: string };
  conversationId?: string;
  onClose?(): void;
  onDiscuss?(batchId: string): Promise<void>;
  onBusyChange?(busy: boolean): void;
  onChanged?(): void;
} = {}) {
  const fileScroll = useRef<ScrollView>(null);
  const scrollToStart = () =>
    fileScroll.current?.scrollTo({ y: 0, animated: true });
  const [batchBusy, setBatchBusy] = useState(false);
  const [uploadRevision, setUploadRevision] = useState(0);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [section, setSection] = useState<
    "SUMMARY" | "PRODUCTS" | "DIFFERENCES"
  >("SUMMARY");
  const [resolutionKey, setResolutionKey] = useState<string>();
  const [reviewSourceIndex, setReviewSourceIndex] = useState<number>();
  const { sqlite, deviceId } = useLocalDatabase();
  const { session } = useAuth();
  const { syncNow, lastSyncedAt } = useSync();
  const storeId = session?.stores[0]?.storeId;
  const actorUserId = session?.user.id;
  const archiveFocused = useIsFocused();
  const archiveAuthority = useRef({
    session,
    archiveFocused,
    sqlite,
    deviceId,
  });
  archiveAuthority.current = { session, archiveFocused, sqlite, deviceId };

  const repository = useMemo(
    () => new ProductMasterRepository(sqlite),
    [sqlite],
  );
  const publicationRepository = useMemo(
    () => new MercalysImportPublicationRepository(sqlite, randomUUID),
    [sqlite],
  );
  const analyticsScheduler = useMemo(
    () =>
      new LocalAnalyticsRecomputationScheduler(
        sqlite,
        new SQLiteProductDateRecomputer(sqlite),
      ),
    [sqlite],
  );
  const [stage, setStage] = useState<ImportStage>("IDLE");
  const [filename, setFilename] = useState<string>();
  const [summary, setSummary] = useState<MercalysImportValidationSummary>();
  const [productCatalog, setProductCatalog] = useState<ImportProductCatalog>();
  const [selectedBytes, setSelectedBytes] = useState<Uint8Array<ArrayBuffer>>();
  const [selectedChecksum, setSelectedChecksum] = useState<string>();
  const [duplicate, setDuplicate] = useState<ExactDuplicateImport>();
  const [continuation, setContinuation] =
    useState<
      Awaited<ReturnType<MercalysImportPublicationRepository["continuation"]>>
    >();
  const [reconciliation, setReconciliation] =
    useState<MercalysReconciliation>();
  const [keptExisting, setKeptExisting] = useState(false);
  const [publication, setPublication] = useState<FilePublication>();
  const [publishing, setPublishing] = useState(false);
  const [resolvingProducts, setResolvingProducts] = useState(false);
  const [resolutionProgress, setResolutionProgress] = useState<{
    completed: number;
    total: number;
  }>();
  const [error, setError] = useState<string>();
  const productResolutions = useMemo(
    () =>
      summary
        ? buildMercalysProductResolutions(summary, reviewSourceIndex)
        : [],
    [summary, reviewSourceIndex],
  );
  const loading = ["READING", "MATCHING", "VALIDATING"].includes(stage);
  const busy = loading || publishing || resolvingProducts || batchBusy;
  useEffect(() => {
    onBusyChange?.(busy);
  }, [onBusyChange, busy]);

  useEffect(() => {
    if (storeId) void analyticsScheduler.process(storeId);
  }, [analyticsScheduler, storeId]);

  const chooseWorkbook = useCallback(
    async (asset: NativeDocumentPickerAsset & { expectedChecksum: string }) => {
      if (!hasNativeFilePicker || !storeId) return;
      setFilename(undefined);
      setSummary(undefined);
      setProductCatalog(undefined);
      setSelectedBytes(undefined);
      setSelectedChecksum(undefined);
      setDuplicate(undefined);
      setContinuation(undefined);
      setReconciliation(undefined);
      setKeptExisting(false);
      setPublication(undefined);
      setResolutionProgress(undefined);
      setError(undefined);

      try {
        setFilename(asset.name);

        setStage("READING");
        await yieldToInterface();
        const bytes = await readRetainedMercalysBytes(asset.uri);
        if (
          asset.expectedChecksum &&
          `sha256:${await sha256Hex(bytes)}` !== asset.expectedChecksum
        )
          throw new Error("MERCALYS_BATCH_FILE_CHANGED");
        const workbook = new SheetJsSpreadsheetParser().parse(bytes);

        setStage("MATCHING");
        await yieldToInterface();
        const catalog = await loadProductCatalog(repository, storeId);
        const nextSummary = validateMercalysImport(workbook, storeId, catalog);
        setProductCatalog(catalog);

        setStage("VALIDATING");
        await yieldToInterface();
        const checksum = `sha256:${await sha256Hex(bytes)}`;
        const priorImport = await publicationRepository.findExactDuplicate(
          storeId,
          nextSummary.sourceType,
          checksum,
        );
        setSelectedChecksum(checksum);
        if (priorImport) {
          const pending = await publicationRepository.continuation(
            storeId,
            checksum,
            nextSummary,
          );
          if (pending && pending.remainingCount > 0) {
            setContinuation(pending);
            setSummary(pending.summary);
            setSelectedBytes(bytes);
            setSection(
              pending.summary.productReviewCount ? "PRODUCTS" : "SUMMARY",
            );
          } else setDuplicate(priorImport);
          setStage("COMPLETE");
          return;
        }
        const overlap = await publicationRepository.analyzeOverlap(
          storeId,
          nextSummary,
        );
        setSummary(nextSummary);
        setSelectedBytes(bytes);
        setReconciliation(overlap ?? undefined);
        setSection(
          overlap
            ? "DIFFERENCES"
            : nextSummary.productReviewCount
              ? "PRODUCTS"
              : "SUMMARY",
        );
        setStage("COMPLETE");
      } catch (caught) {
        setError(importErrorMessage(caught));
        setStage("ERROR");
      }
    },
    [storeId, repository, publicationRepository],
  );

  const seeded = useRef(false);
  useEffect(() => {
    if (retainedAsset && storeId && !seeded.current) {
      seeded.current = true;
      void chooseWorkbook(retainedAsset);
    }
  }, [retainedAsset, storeId, chooseWorkbook]);

  function reset() {
    if (retainedAsset && onClose) {
      onClose();
      return;
    }
    setStage("IDLE");
    setSection("SUMMARY");
    setResolutionKey(undefined);
    setReviewSourceIndex(undefined);
    setFilename(undefined);
    setSummary(undefined);
    setProductCatalog(undefined);
    setSelectedBytes(undefined);
    setSelectedChecksum(undefined);
    setDuplicate(undefined);
    setContinuation(undefined);
    setReconciliation(undefined);
    setKeptExisting(false);
    setPublication(undefined);
    setResolutionProgress(undefined);
    setError(undefined);
  }

  async function refreshProductMatches(
    currentSummary: MercalysImportValidationSummary,
  ) {
    if (!storeId) throw new Error("Aucun magasin actif.");
    const catalog = await loadProductCatalog(repository, storeId);
    const rematched = rematchMercalysImport(currentSummary, storeId, catalog);
    const pending =
      continuation && selectedChecksum
        ? await publicationRepository.continuation(
            storeId,
            selectedChecksum,
            rematched,
          )
        : null;
    if (
      continuation &&
      (!pending || pending.sourceDocumentId !== continuation.sourceDocumentId)
    )
      throw Error("MERCALYS_CONTINUATION_SOURCE_CHANGED");
    const nextSummary = pending?.summary ?? rematched;
    const overlap = pending
      ? null
      : await publicationRepository.analyzeOverlap(storeId, nextSummary);
    setProductCatalog(catalog);
    setSummary(nextSummary);
    setContinuation(pending ?? undefined);
    setReconciliation(overlap ?? undefined);
    setReviewSourceIndex(undefined);
    setResolutionKey(undefined);
    if (!nextSummary.productReviewCount) {
      setSection(overlap ? "DIFFERENCES" : "SUMMARY");
    }
  }

  async function createMissingProducts(
    selectedResolutions: readonly MercalysProductResolution[] = productResolutions,
    allowExplicitDistinct = false,
  ) {
    if (!storeId || !summary) {
      setError(
        "Sélectionnez de nouveau le fichier avant de créer les produits.",
      );
      return;
    }
    setResolvingProducts(true);
    setResolutionProgress(undefined);
    setError(undefined);
    try {
      await createMercalysProducts(
        repository,
        selectedResolutions,
        {
          storeId,
          deviceId,
          now: () => new Date().toISOString(),
          generateId: randomUUID,
        },
        (completed, total) => {
          setResolutionProgress({ completed, total });
          if (completed > 0) onChanged?.();
        },
        allowExplicitDistinct,
      );
      await refreshProductMatches(summary);
    } catch {
      try {
        await refreshProductMatches(summary);
      } catch {
        // Keep the original resolution error visible if refreshing also fails.
      }
      setError(
        "La création des produits s’est interrompue. Les produits déjà créés sont conservés; relancez l’action pour terminer.",
      );
    } finally {
      setResolvingProducts(false);
    }
  }

  async function createDistinctProduct(resolution: MercalysProductResolution) {
    if (!resolution.expectedProductIds) {
      await createMissingProducts([resolution], true);
      return;
    }
    if (!storeId || !summary) return;
    setResolvingProducts(true);
    setError(undefined);
    let saved = false;
    try {
      await correctMercalysProductMapping(sqlite, resolution, null, {
        storeId,
        deviceId,
        now: () => new Date().toISOString(),
        generateId: randomUUID,
      });
      saved = true;
      onChanged?.();
      await refreshProductMatches(summary);
    } catch {
      setError(
        saved
          ? "Le produit est créé, mais la comparaison n’a pas pu être actualisée. Rouvrez le fichier avant d’appliquer sa nouvelle version."
          : "Le produit distinct n’a pas pu être créé. Aucune correction partielle n’a été enregistrée. Rouvrez le fichier pour vérifier les associations.",
      );
    } finally {
      setResolvingProducts(false);
    }
  }

  async function confirmProductMapping(
    resolution: MercalysProductResolution,
    productId: string,
  ) {
    if (!storeId || !summary) return;
    setResolvingProducts(true);
    setError(undefined);
    try {
      const options = {
        storeId,
        deviceId,
        now: () => new Date().toISOString(),
        generateId: randomUUID,
      };
      if (resolution.expectedProductIds) {
        await correctMercalysProductMapping(
          sqlite,
          resolution,
          productId,
          options,
        );
      } else {
        await confirmMercalysProductMapping(
          repository,
          resolution,
          productId,
          options,
        );
      }
      onChanged?.();
      await refreshProductMatches(summary);
    } catch {
      setError(
        "La correspondance n’a pas pu être enregistrée. Vérifiez les conflits de synchronisation puis rouvrez le fichier.",
      );
    } finally {
      setResolvingProducts(false);
    }
  }

  const publishValidLines = useCallback(async () => {
    if (
      !storeId ||
      !filename ||
      !summary ||
      !selectedBytes ||
      !selectedChecksum
    ) {
      setError(
        "Les informations de l’import sont incomplètes. Sélectionnez de nouveau le fichier avant de publier.",
      );
      return;
    }
    const reconciliationApproval = reconciliation
      ? actorUserId
        ? {
            fingerprint: reconciliation.fingerprint,
            actorUserId,
          }
        : null
      : undefined;
    if (reconciliationApproval === null) {
      setError(
        "Votre session utilisateur ne permet pas d’enregistrer cette décision. Reconnectez-vous puis réessayez.",
      );
      return;
    }
    setPublishing(true);
    setError(undefined);
    let durableFile: ExpoFile | undefined;
    try {
      if (continuation) {
        const result = await publicationRepository.resume({
          storeId,
          sourceDocumentId: continuation.sourceDocumentId,
          checksum: selectedChecksum,
          summary,
        });
        onChanged?.();
        setPublication({
          ...result,
          publishedCount: continuation.publishedCount + result.publishedCount,
        });
        const analyticsRun = await analyticsScheduler.process(storeId);
        if (analyticsRun.failedJobs > 0)
          setError(
            "Les lignes sont publiées ; certains indicateurs restent à recalculer.",
          );
        void syncNow(storeId);
        return;
      }
      const directory = new Directory(Paths.document, "mercalys-imports");
      directory.create({ idempotent: true, intermediates: true });
      durableFile = new ExpoFile(directory, `${randomUUID()}.xlsx`);
      durableFile.create({ intermediates: true });
      durableFile.write(selectedBytes);

      const result = await publicationRepository.publish({
        storeId,
        filename,
        localFileUri: durableFile.uri,
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sizeBytes: selectedBytes.byteLength,
        checksum: selectedChecksum,
        summary,
        reconciliationApproval,
      });
      // The publication transaction now owns this original. Later failures must never delete it.
      durableFile = undefined;
      onChanged?.();
      setPublication(result);
      setReconciliation(undefined);
      const analyticsRun = await analyticsScheduler.process(storeId);
      if (analyticsRun.failedJobs > 0) {
        setError(
          "Les données sont publiées, mais certains indicateurs restent à recalculer.",
        );
      }
      void syncNow(storeId);
    } catch (caught) {
      if (durableFile?.exists) durableFile.delete();
      if (caught instanceof MercalysExactDuplicateError) {
        setSummary(undefined);
        setSelectedBytes(undefined);
        setDuplicate(caught.priorImport);
        return;
      }
      if (caught instanceof MercalysOverlapReconciliationError) {
        setReconciliation(caught.reconciliation);
        setSection("DIFFERENCES");
        setError(
          "La comparaison a changé. Examinez les points à résoudre ci-dessous avant d’appliquer la nouvelle version.",
        );
        scrollToStart();
        return;
      }
      setError(importErrorMessage(caught));
    } finally {
      setPublishing(false);
    }
  }, [
    storeId,
    filename,
    summary,
    selectedBytes,
    selectedChecksum,
    reconciliation,
    continuation,
    actorUserId,
    publicationRepository,
    analyticsScheduler,
    syncNow,
    onChanged,
  ]);
  const autoAttempts = useRef(new Set<string>());
  useEffect(() => {
    if (
      retainedAsset ||
      stage !== "COMPLETE" ||
      loading ||
      publishing ||
      resolvingProducts ||
      batchBusy ||
      reconciliation ||
      duplicate ||
      publication ||
      keptExisting ||
      !summary?.readyCount ||
      summary.productReviewCount ||
      summary.errorCount ||
      !selectedBytes ||
      !selectedChecksum
    )
      return;
    const key = JSON.stringify([
      selectedChecksum,
      summary.lines.map((l) => [
        l.record.sourceIndex,
        l.match.state,
        l.match.matchedProductId,
      ]),
    ]);
    if (autoAttempts.current.has(key)) return;
    autoAttempts.current.add(key);
    void publishValidLines();
  }, [
    retainedAsset,
    stage,
    loading,
    publishing,
    resolvingProducts,
    batchBusy,
    reconciliation,
    duplicate,
    publication,
    keptExisting,
    summary,
    selectedBytes,
    selectedChecksum,
    publishValidLines,
  ]);

  async function keepExistingObservations() {
    if (
      !storeId ||
      !filename ||
      !summary ||
      !selectedChecksum ||
      !reconciliation
    ) {
      setError(
        "Les informations de réconciliation sont incomplètes. Sélectionnez de nouveau le fichier.",
      );
      return;
    }
    if (!actorUserId) {
      setError(
        "Votre session utilisateur ne permet pas d’enregistrer cette décision. Reconnectez-vous puis réessayez.",
      );
      return;
    }
    setPublishing(true);
    setError(undefined);
    try {
      await publicationRepository.keepExisting({
        storeId,
        filename,
        checksum: selectedChecksum,
        summary,
        reconciliation,
        actorUserId,
      });
      setKeptExisting(true);
      setSelectedBytes(undefined);
    } catch (caught) {
      if (caught instanceof MercalysOverlapReconciliationError) {
        setReconciliation(caught.reconciliation);
        setSection("DIFFERENCES");
        setError(
          "La comparaison a changé. Examinez de nouveau les lignes avant de conserver l’existant.",
        );
        scrollToStart();
        return;
      }
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : "La décision de réconciliation n’a pas pu être enregistrée.",
      );
    } finally {
      setPublishing(false);
    }
  }

  return (
    <AppScreen scrollRef={fileScroll}>
      <AppHeader
        title={
          retainedAsset
            ? (filename ?? retainedAsset.name).split("/").at(-1)!
            : "Imports Mercalys"
        }
        subtitle={
          retainedAsset
            ? retainedAsset.name.includes("/")
              ? retainedAsset.name
              : undefined
            : "Ajoutez des exports, puis retrouvez chaque lot et ses fichiers."
        }
      />

      {onClose ? (
        <SecondaryButton
          label={retainedAsset ? "Fermer le fichier" : "Retour au chat"}
          disabled={loading || publishing || resolvingProducts || batchBusy}
          onPress={onClose}
        />
      ) : null}
      {!retainedAsset && storeId && actorUserId && hasNativeFilePicker ? (
        <MercalysBatchPanel
          key={`${storeId}/${actorUserId}/${conversationId ?? "manual"}`}
          db={sqlite}
          storeId={storeId}
          ownerId={actorUserId}
          archiveContext={{
            deviceId,
            revision: String(archiveFocused) + ":" + String(lastSyncedAt),
            canWrite: () =>
              archiveAuthority.current.archiveFocused &&
              archiveAuthority.current.sqlite === sqlite &&
              archiveAuthority.current.deviceId === deviceId &&
              archiveAuthority.current.session?.user.id === actorUserId &&
              archiveAuthority.current.session?.stores[0]?.storeId === storeId,
            onChanged: () => {
              void syncNow(storeId).catch(() => undefined);
            },
          }}
          conversationId={conversationId}
          onDiscuss={onDiscuss}
          onBusyChange={setBatchBusy}
          onPublished={async () => {
            setUploadRevision((r) => r + 1);
            if (storeId) {
              try {
                await analyticsScheduler.process(storeId);
                void syncNow(storeId);
              } catch {
                throw Error("MERCALYS_BATCH_POST_PUBLICATION_PENDING");
              }
            }
          }}
          disabled={loading || publishing || resolvingProducts}
          pick={async () => {
            const result = await nativeDocumentPicker.getDocumentAsync({
              type: [
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              ],
              copyToCacheDirectory: true,
              multiple: true,
              base64: false,
            });
            return result.canceled ? undefined : result.assets;
          }}
          pickZip={async () => {
            const result = await nativeDocumentPicker.getDocumentAsync({
              type: ["application/zip", "application/x-zip-compressed"],
              copyToCacheDirectory: true,
              multiple: false,
              base64: false,
            });
            return result.canceled ? undefined : result.assets[0];
          }}
          renderReview={(asset, close, reportBusy, reportChanged) => (
            <MercalysImportScreen
              key={asset.uri}
              retainedAsset={asset}
              conversationId={conversationId}
              onClose={close}
              onBusyChange={reportBusy}
              onChanged={reportChanged}
            />
          )}
        />
      ) : null}
      <View
        className="gap-6"
        pointerEvents={batchBusy ? "none" : "auto"}
        accessibilityElementsHidden={batchBusy}
        importantForAccessibility={batchBusy ? "no-hide-descendants" : "auto"}
      >
        {!retainedAsset ? (
          <>
            <SecondaryButton
              label="Envois et synchronisation des fichiers"
              disabled={busy}
              onPress={() => setRecoveryOpen(true)}
            />
            {!storeId ? (
              <InlineAlert
                title="Aucun magasin actif"
                message="Reconnectez-vous après l’ajout de votre magasin."
              />
            ) : !hasNativeFilePicker ? (
              <InlineAlert
                title="Sélection de fichiers indisponible"
                message="Utilisez l’application native pour choisir des fichiers XLSX ou ZIP."
              />
            ) : null}
          </>
        ) : null}
        {continuation && !publication ? (
          <InlineAlert
            title="Publication à compléter"
            message={`${continuation.publishedCount} lignes déjà publiées sont conservées. Seules les lignes restantes seront ajoutées après votre validation.`}
          />
        ) : null}
        {summary && !publication ? (
          <View className="flex-row flex-wrap gap-2">
            {(
              [
                ["SUMMARY", "Résumé"],
                ["PRODUCTS", `Produits (${productResolutions.length})`],
                ["DIFFERENCES", "Comparaison"],
              ] as const
            )
              .filter(([key]) => key !== "DIFFERENCES" || !!reconciliation)
              .map(([key, label]) => (
                <Pressable
                  key={key}
                  accessibilityRole="radio"
                  aria-checked={section === key}
                  accessibilityState={{ checked: section === key }}
                  onPress={() => {
                    setSection(key);
                    setResolutionKey(undefined);
                    scrollToStart();
                  }}
                  className={`min-h-12 justify-center rounded-xl border px-3 py-2 ${section === key ? "border-forest bg-forest" : "border-line bg-surface"}`}
                >
                  <Text
                    className={
                      section === key
                        ? "font-semibold text-on-accent"
                        : "text-ink"
                    }
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
          </View>
        ) : null}
        {stage !== "IDLE" && stage !== "COMPLETE" ? (
          <SectionCard title="Avancement">
            {filename ? <SummaryLine label="Fichier" value={filename} /> : null}
            <ProgressLine
              label="Lecture du fichier"
              state={progressState(stage, "READING")}
            />
            <ProgressLine
              label="Identification des produits"
              state={progressState(stage, "MATCHING")}
            />
            <ProgressLine
              label="Vérification des données"
              state={progressState(stage, "VALIDATING")}
            />
          </SectionCard>
        ) : null}

        {error ? (
          <InlineAlert title="Import impossible" message={error} />
        ) : null}

        {summary && section === "PRODUCTS" && productCatalog && storeId ? (
          <ProductResolutionSummary
            key={resolutionKey ?? "all"}
            resolutions={
              resolutionKey
                ? productResolutions.filter((r) => r.key === resolutionKey)
                : productResolutions
            }
            catalog={productCatalog}
            storeId={storeId}
            onShowAll={() => {
              setResolutionKey(undefined);
              setReviewSourceIndex(undefined);
            }}
            onNavigate={scrollToStart}
            loading={resolvingProducts}
            progress={resolutionProgress}
            onCreate={(resolutions) => {
              void createMissingProducts(resolutions);
            }}
            onCreateDistinct={(resolution) => {
              void createDistinctProduct(resolution);
            }}
            onConfirm={(resolution, productId) => {
              void confirmProductMapping(resolution, productId);
            }}
          />
        ) : null}

        {summary &&
        !reconciliation &&
        (section === "SUMMARY" || publication) ? (
          <ValidationSummary
            summary={summary}
            previouslyPublishedCount={continuation?.publishedCount ?? 0}
            publication={publication}
            publishing={publishing}
            onPublish={() => {
              void publishValidLines();
            }}
            onCancel={reset}
          />
        ) : null}

        {summary && reconciliation && section === "SUMMARY" ? (
          <SectionCard title="Nouvelle version à examiner">
            <Text className="text-base text-ink">
              {summary.detectedLineCount} lignes ·{" "}
              {reconciliation.counts.MODIFIED} modifiées ·{" "}
              {reconciliation.counts.AMBIGUOUS} à résoudre
            </Text>
            <SecondaryButton
              label="Examiner la comparaison"
              onPress={() => setSection("DIFFERENCES")}
            />
            {productResolutions.length ? (
              <SecondaryButton
                label="Confirmer les produits"
                onPress={() => setSection("PRODUCTS")}
              />
            ) : null}
          </SectionCard>
        ) : null}
        {summary && reconciliation && section === "DIFFERENCES" ? (
          <MercalysReconciliationReview
            key={selectedChecksum}
            reconciliation={reconciliation}
            validationMessages={summary.issueCodes.map(issueLabel)}
            incomingLines={summary.lines}
            onNavigate={scrollToStart}
            productLabels={Object.fromEntries(
              (productCatalog?.products ?? []).map((p) => [p.id, p.label]),
            )}
            onReviewProducts={(index) => {
              setReviewSourceIndex(index);
              setResolutionKey(
                index === undefined
                  ? undefined
                  : buildMercalysProductResolutions(summary, index).find((r) =>
                      r.sourceIndexes.includes(index),
                    )?.key,
              );
              setSection("PRODUCTS");
              scrollToStart();
            }}
            keptExisting={keptExisting}
            loading={publishing}
            onApply={() => {
              void publishValidLines();
            }}
            onKeep={() => {
              void keepExistingObservations();
            }}
            onCancel={reset}
          />
        ) : null}

        {duplicate ? (
          <DuplicateSummary duplicate={duplicate} onCancel={reset} />
        ) : null}
      </View>
      <Modal
        visible={recoveryOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        allowSwipeDismissal={!batchBusy}
        onRequestClose={() => {
          if (!batchBusy) setRecoveryOpen(false);
        }}
      >
        <AppScreen>
          <AppHeader title="Envois des fichiers" />
          <SecondaryButton
            label="Retour aux imports"
            disabled={batchBusy}
            onPress={() => setRecoveryOpen(false)}
          />
          {recoveryOpen && storeId && actorUserId ? (
            <SourceUploadRecoveryPanel
              key={`${storeId}/${actorUserId}/${conversationId ?? "manual"}`}
              db={sqlite}
              storeId={storeId}
              scope={
                conversationId
                  ? { ownerId: actorUserId, conversationId }
                  : undefined
              }
              canRetry={
                session?.stores.some(
                  (s) => s.storeId === storeId && s.role === "MANAGER",
                ) ?? false
              }
              sync={() => syncNow(storeId)}
              disabled={busy}
              refreshKey={`${stage}/${uploadRevision}`}
              onBusyChange={setBatchBusy}
            />
          ) : null}
        </AppScreen>
      </Modal>
    </AppScreen>
  );
}

function DuplicateSummary({
  duplicate,
  onCancel,
}: {
  duplicate: ExactDuplicateImport;
  onCancel: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  return (
    <>
      <InlineAlert
        title="Ce fichier a déjà été importé"
        message={`${formatImportDate(duplicate.createdAt)} · ${duplicateStatusLabel(duplicate)}`}
      />
      {showDetails ? (
        <SectionCard title="Import précédent">
          <SummaryLine
            label="Fichier"
            value={duplicate.originalFilename ?? "Nom indisponible"}
          />
          <SummaryLine
            label="Source"
            value={
              duplicate.sourceType === "MERCALYS_SALES"
                ? "Ventes Mercalys"
                : "Casse Mercalys"
            }
          />
          {duplicate.businessPeriodStart && duplicate.businessPeriodEnd ? (
            <SummaryLine
              label="Période"
              value={formatPeriod(
                duplicate.businessPeriodStart,
                duplicate.businessPeriodEnd,
              )}
            />
          ) : null}
          <SummaryLine label="État" value={duplicateStatusLabel(duplicate)} />
        </SectionCard>
      ) : null}
      <SectionCard title="Actions">
        <PrimaryButton
          label={showDetails ? "Masquer les détails" : "Voir l’import"}
          onPress={() => setShowDetails((value) => !value)}
        />
        <SecondaryButton label="Annuler" onPress={onCancel} />
      </SectionCard>
    </>
  );
}

async function loadProductCatalog(
  repository: ProductMasterRepository,
  storeId: string,
): Promise<ImportProductCatalog> {
  const [productRecords, identifiers, aliases] = await Promise.all([
    repository.listProducts(storeId),
    repository.listIdentifiersByStore(storeId),
    repository.listAliasesByStore(storeId),
  ]);
  return {
    conflictedProductIds: [
      ...new Set([
        ...productRecords
          .filter((r) => r.syncState === "ERROR" || r.syncState === "CONFLICT")
          .map((r) => r.entity.id),
        ...identifiers
          .filter((r) => r.syncState === "ERROR" || r.syncState === "CONFLICT")
          .map((r) => r.entity.productId),
        ...aliases
          .filter((r) => r.syncState === "ERROR" || r.syncState === "CONFLICT")
          .map((r) => r.entity.productId),
      ]),
    ],
    products: productRecords.map(({ entity }) => entity),
    identifiers: identifiers.map(({ entity }) => entity),
    aliases: aliases.map(({ entity }) => entity),
  };
}

function ValidationSummary({
  summary,
  previouslyPublishedCount = 0,
  publication,
  publishing,
  onPublish,
  onCancel,
}: {
  summary: MercalysImportValidationSummary;
  previouslyPublishedCount?: number;
  publication?: FilePublication;
  publishing: boolean;
  onPublish: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <SectionCard title="Résumé de validation">
        <SummaryLine
          label="Source"
          value={
            summary.sourceType === "MERCALYS_SALES"
              ? "Ventes Mercalys"
              : "Casse Mercalys"
          }
        />
        <SummaryLine
          label="Période"
          value={formatPeriod(
            summary.businessPeriodStart,
            summary.businessPeriodEnd,
          )}
        />
        <Text className="text-xl font-semibold text-ink">
          {summary.detectedLineCount} ligne
          {summary.detectedLineCount > 1 ? "s" : ""} détectée
          {summary.detectedLineCount > 1 ? "s" : ""}
        </Text>
        <CountLine
          label="Prêtes à ajouter"
          value={Math.max(0, summary.readyCount - previouslyPublishedCount)}
          tone="ready"
        />
        <CountLine
          label="Produits à confirmer"
          value={summary.productReviewCount}
          tone="review"
        />
        <CountLine label="Anomalies" value={summary.errorCount} tone="error" />
      </SectionCard>

      {summary.issueCodes.length > 0 ? (
        <InlineAlert
          title="Données à corriger"
          message={summary.issueCodes.map(issueLabel).join(" · ")}
        />
      ) : null}

      <SectionCard title="Publication">
        {publication ? (
          <SourceOriginalButton
            sourceDocumentId={publication.sourceDocumentId}
            label="Consulter le fichier Mercalys original"
          />
        ) : null}
        {publication ? (
          <InlineAlert
            title={`${publication.publishedCount} ligne${publication.publishedCount > 1 ? "s" : ""} publiée${publication.publishedCount > 1 ? "s" : ""} localement`}
            message={
              publication.remainingCount > 0
                ? `${publication.remainingCount} ligne${publication.remainingCount > 1 ? "s restent" : " reste"} à corriger. La synchronisation du fichier est en attente.`
                : "Les données sont disponibles hors connexion. La synchronisation du fichier est en attente."
            }
          />
        ) : (
          <Text className="text-base leading-6 text-muted">
            Seules les lignes prêtes seront enregistrées. Les autres resteront à
            corriger et le fichier sera conservé sur cet appareil.
          </Text>
        )}
        {!publication && summary.readyCount <= previouslyPublishedCount ? (
          <InlineAlert
            title="Aucune ligne prête à publier"
            message={
              summary.productReviewCount
                ? "Confirmez ou ajoutez les produits dans l’onglet Produits. Les lignes prêtes seront actualisées ici."
                : "Corrigez les anomalies signalées dans l’export source avant d’ajouter de nouvelles lignes."
            }
          />
        ) : null}
        <PrimaryButton
          label={
            publication
              ? "Lignes publiées"
              : previouslyPublishedCount
                ? "Publier les lignes restantes"
                : "Publier les lignes valides"
          }
          disabled={
            summary.readyCount <= previouslyPublishedCount ||
            publication !== undefined
          }
          loading={publishing}
          onPress={onPublish}
        />
        <SecondaryButton
          label={publication ? "Importer un autre fichier" : "Annuler l’import"}
          onPress={onCancel}
        />
      </SectionCard>
    </>
  );
}

function ProductResolutionSummary({
  resolutions,
  catalog,
  storeId,
  onShowAll,
  onNavigate,
  loading,
  progress,
  onCreate,
  onCreateDistinct,
  onConfirm,
}: {
  resolutions: MercalysProductResolution[];
  catalog: ImportProductCatalog;
  storeId: string;
  onShowAll(): void;
  onNavigate(): void;
  loading: boolean;
  progress?: { completed: number; total: number };
  onCreate(resolutions: readonly MercalysProductResolution[]): void;
  onCreateDistinct(resolution: MercalysProductResolution): void;
  onConfirm(resolution: MercalysProductResolution, productId: string): void;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const creatable = resolutions.filter(({ canCreate }) => canCreate);
  const productById = new Map(
    catalog.products.map((product) => [product.id, product]),
  );
  const filtered = resolutions.filter((r) =>
    `${r.label} ${r.identifiers.map((i) => i.value).join(" ")}`
      .toLocaleLowerCase("fr-FR")
      .includes(query.trim().toLocaleLowerCase("fr-FR")),
  );
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(filtered.length / 20) - 1),
  );
  const visibleResolutions = filtered.slice(
    currentPage * 20,
    (currentPage + 1) * 20,
  );
  return (
    <SectionCard title="Produits à confirmer">
      <SecondaryButton
        label="Voir tous les produits à confirmer"
        onPress={onShowAll}
        disabled={loading}
      />
      <TextInput
        accessibilityLabel="Rechercher un produit à confirmer"
        placeholder="Nom ou code article"
        placeholderTextColor={colors.muted}
        className="min-h-12 rounded-xl border border-line px-4 py-3 text-base text-ink"
        value={query}
        onChangeText={(value) => {
          setQuery(value);
          setPage(0);
        }}
        maxLength={200}
      />
      <Text className="text-sm text-muted">
        {filtered.length
          ? `${currentPage * 20 + 1}–${Math.min((currentPage + 1) * 20, filtered.length)} sur ${filtered.length} produits`
          : "Aucun produit à confirmer dans cette sélection."}
      </Text>
      <Text className="text-base leading-6 text-muted">
        Les références sont regroupées par ITM8. Les nouveaux produits gardent
        une catégorie, une nature et une unité inconnues jusqu’à leur
        enrichissement.
      </Text>
      {creatable.length > 0 ? (
        <PrimaryButton
          label={
            loading && progress
              ? `Création ${progress.completed}/${progress.total}`
              : `Créer ${creatable.length} produit${creatable.length > 1 ? "s" : ""} depuis Mercalys`
          }
          loading={loading}
          onPress={() => onCreate(creatable)}
        />
      ) : null}
      {visibleResolutions.map((resolution) => {
        const candidates = resolution.candidateProductIds
          .map((id) => productById.get(id))
          .filter((product): product is Product => product !== undefined);
        return (
          <View
            key={resolution.key}
            className="gap-2 border-t border-line pt-4"
          >
            <Text className="text-base font-semibold text-ink">
              {resolution.label}
            </Text>
            <Text className="text-sm text-muted">
              {resolution.identifiers
                .map(({ type, value }) => `${type} ${value}`)
                .join(" · ") || "Aucun identifiant exploitable"}
            </Text>
            {candidates.slice(0, 3).map((product) => (
              <SecondaryButton
                key={product.id}
                label={`Associer à ${product.label}`}
                disabled={loading}
                onPress={() => onConfirm(resolution, product.id)}
              />
            ))}
            <MercalysImportProductPicker
              storeId={storeId}
              source={{
                label: resolution.label,
                identifiers: resolution.identifiers,
              }}
              catalog={catalog}
              conflictedProductIds={catalog.conflictedProductIds}
              busy={loading}
              onConfirm={(id) => onConfirm(resolution, id)}
            />
            {resolution.expectedProductIds ? (
              <Text className="text-sm text-warning">
                Cette décision réassocie les codes de cette référence pour les
                prochains imports. Les autres codes du produit actuel sont
                conservés.
              </Text>
            ) : null}
            {resolution.canCreate ? (
              <SecondaryButton
                label="Créer ce produit"
                disabled={loading}
                onPress={() => onCreate([resolution])}
              />
            ) : resolution.canCreateAsDistinct ? (
              <SecondaryButton
                label="Créer comme nouveau produit"
                disabled={loading}
                onPress={() => onCreateDistinct(resolution)}
              />
            ) : candidates.length === 0 ? (
              <Text className="text-sm text-warning">
                Recherchez le produit existant à associer à cette ligne.
              </Text>
            ) : null}
          </View>
        );
      })}
      {filtered.length > 20 ? (
        <View className="gap-2">
          <SecondaryButton
            label="Produits précédents"
            disabled={loading || currentPage === 0}
            onPress={() => {
              setPage(currentPage - 1);
              onNavigate();
            }}
          />
          <SecondaryButton
            label="Produits suivants"
            disabled={loading || (currentPage + 1) * 20 >= filtered.length}
            onPress={() => {
              setPage(currentPage + 1);
              onNavigate();
            }}
          />
        </View>
      ) : null}
    </SectionCard>
  );
}

function ProgressLine({
  label,
  state,
}: {
  label: string;
  state: "pending" | "active" | "done" | "error";
}) {
  const prefix =
    state === "done"
      ? "✓"
      : state === "active"
        ? "…"
        : state === "error"
          ? "!"
          : "○";
  return (
    <Text
      accessibilityLiveRegion="polite"
      className={`text-base ${state === "active" ? "font-semibold text-forest" : "text-ink"}`}
    >
      {prefix} {label}
    </Text>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <Text className="text-base leading-6 text-ink">
      <Text className="font-semibold">{label} : </Text>
      {value}
    </Text>
  );
}

function CountLine({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ready" | "review" | "error";
}) {
  const color =
    tone === "ready"
      ? "text-forest"
      : tone === "review"
        ? "text-amber-700"
        : "text-red-700";
  return (
    <View className="flex-row items-center justify-between rounded-2xl bg-canvas px-4 py-3">
      <Text className="text-base text-ink">{label}</Text>
      <Text className={`text-xl font-bold ${color}`}>{value}</Text>
    </View>
  );
}

function progressState(stage: ImportStage, target: ImportStage) {
  if (stage === "ERROR") return "error" as const;
  const order: ImportStage[] = [
    "READING",
    "MATCHING",
    "VALIDATING",
    "COMPLETE",
  ];
  const currentIndex = order.indexOf(stage);
  const targetIndex = order.indexOf(target);
  if (currentIndex > targetIndex || stage === "COMPLETE")
    return "done" as const;
  if (currentIndex === targetIndex) return "active" as const;
  return "pending" as const;
}

function importErrorMessage(error: unknown) {
  const localMessage = localOperationFailureMessage(
    localOperationFailureCode(error),
  );
  if (localMessage) return localMessage;
  if (error instanceof Error && error.message === "MERCALYS_BATCH_FILE_CHANGED")
    return "L’original conservé a changé. Sélectionnez de nouveau le fichier avant de l’examiner.";
  if (error instanceof MercalysImportValidationError) {
    return error.code === "AGGREGATED_PERIOD_WITHOUT_DAILY_DATES"
      ? "Cet export regroupe plusieurs jours sans dates journalières. Dans Mercalys, choisissez un seul jour ou activez le détail « Par Jour » avec la colonne Date."
      : "Format Mercalys non reconnu. Vérifiez qu’il s’agit d’un export Ventes nettes ou Casse par article.";
  }
  const message = error instanceof Error ? error.message : "";
  if (message === "MERCALYS_CONTINUATION_SUPERSEDED")
    return "Cette version a déjà été remplacée. Retrouvez le fichier corrigé le plus récent dans les imports.";
  if (message === "MERCALYS_CONTINUATION_CONFLICT")
    return "La publication de ce fichier présente une erreur ou un conflit de synchronisation. Examinez son détail dans Synchronisation avant de reprendre ces lignes.";
  if (message === "MERCALYS_CONTINUATION_OVERLAP")
    return "Une ligne restante recouvre une autre publication. Les lignes déjà publiées sont conservées ; ce rapprochement doit être examiné avant de continuer.";
  if (message === "MERCALYS_CONTINUATION_SOURCE_CHANGED")
    return "Le fichier ou sa publication a changé. Fermez puis rouvrez ce fichier pour actualiser la comparaison.";
  if (
    message.includes("ExpoDocumentPicker") ||
    message.includes("ExpoFileSystem")
  ) {
    return "Ce build ne contient pas encore le sélecteur de documents. Installez un build de développement récent.";
  }
  return message || "Le fichier n’a pas pu être vérifié.";
}

function formatPeriod(start: string, end: string) {
  return start === end
    ? formatIsoDate(start)
    : `${formatIsoDate(start)} au ${formatIsoDate(end)}`;
}

function formatIsoDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function formatImportDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

function duplicateStatusLabel(duplicate: ExactDuplicateImport) {
  if (duplicate.remoteProcessingStatus === "PUBLISHED") {
    return "Publié et vérifié";
  }
  if (duplicate.localProcessingStatus === "PUBLISHED") {
    return "Publié localement · Synchronisation en attente";
  }
  return "Import déjà enregistré";
}

function issueLabel(code: string) {
  if (code === "MISSING_LABEL") return "Libellé manquant";
  if (code === "INVALID_IDENTIFIER") return "Identifiant invalide";
  if (code === "INVALID_BUSINESS_DATE") return "Date invalide";
  if (code === "INVALID_QUANTITY") return "Quantité invalide";
  if (code === "UNPARSEABLE_NUMERIC_VALUE") return "Valeur numérique invalide";
  if (code === "DECLARED_LINE_COUNT_MISMATCH")
    return "Nombre de lignes incohérent";
  return "Donnée non reconnue";
}

function yieldToInterface() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>) {
  const hash = new Uint8Array(
    await digest(CryptoDigestAlgorithm.SHA256, bytes),
  );
  return [...hash].map((value) => value.toString(16).padStart(2, "0")).join("");
}
