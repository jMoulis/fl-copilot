import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import { CryptoDigestAlgorithm, digest, randomUUID } from "expo-crypto";
import { Directory, File as ExpoFile, Paths } from "expo-file-system";
import type { Product, ProductMatchCatalog } from "@fl-copilot/domain";
import { useAuth } from "@/auth/auth-provider";
import {
  AppHeader,
  AppScreen,
  InlineAlert,
  PrimaryButton,
  SecondaryButton,
  SectionCard,
} from "@/components/ui";
import {
  MercalysImportValidationError,
  rematchMercalysImport,
  validateMercalysImport,
  type MercalysImportValidationSummary,
} from "@/documents/mercalys-import-validation";
import {
  MercalysExactDuplicateError,
  MercalysImportPublicationRepository,
  MercalysOverlapReconciliationError,
  type ExactDuplicateImport,
  type PublishedMercalysImport,
} from "@/documents/mercalys-import-publication";
import type {
  MercalysReconciliation,
  MercalysReconciliationRow,
} from "@/documents/mercalys-import-reconciliation";
import {
  buildMercalysProductResolutions,
  confirmMercalysProductMapping,
  createMercalysProducts,
  type MercalysProductResolution,
} from "@/documents/mercalys-product-resolution";
import { SheetJsSpreadsheetParser } from "@/documents/sheetjs-spreadsheet-parser";
import { ProductMasterRepository } from "@/products/product-master-repository";
import { useLocalDatabase } from "@/providers/database-provider";

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

export default function MercalysImportsScreen() {
  const { sqlite, deviceId } = useLocalDatabase();
  const { session } = useAuth();
  const storeId = session?.stores[0]?.storeId;
  const actorUserId = session?.user.id;
  const repository = useMemo(
    () => new ProductMasterRepository(sqlite),
    [sqlite],
  );
  const publicationRepository = useMemo(
    () => new MercalysImportPublicationRepository(sqlite, randomUUID),
    [sqlite],
  );
  const [stage, setStage] = useState<ImportStage>("IDLE");
  const [filename, setFilename] = useState<string>();
  const [summary, setSummary] = useState<MercalysImportValidationSummary>();
  const [productCatalog, setProductCatalog] = useState<ProductMatchCatalog>();
  const [selectedBytes, setSelectedBytes] = useState<Uint8Array<ArrayBuffer>>();
  const [selectedChecksum, setSelectedChecksum] = useState<string>();
  const [duplicate, setDuplicate] = useState<ExactDuplicateImport>();
  const [reconciliation, setReconciliation] =
    useState<MercalysReconciliation>();
  const [keptExisting, setKeptExisting] = useState(false);
  const [publication, setPublication] = useState<PublishedMercalysImport>();
  const [publishing, setPublishing] = useState(false);
  const [resolvingProducts, setResolvingProducts] = useState(false);
  const [resolutionProgress, setResolutionProgress] = useState<{
    completed: number;
    total: number;
  }>();
  const [error, setError] = useState<string>();
  const productResolutions = useMemo(
    () => (summary ? buildMercalysProductResolutions(summary) : []),
    [summary],
  );
  const loading = ["READING", "MATCHING", "VALIDATING"].includes(stage);

  async function chooseWorkbook() {
    if (!hasNativeFilePicker || !storeId) return;
    setFilename(undefined);
    setSummary(undefined);
    setProductCatalog(undefined);
    setSelectedBytes(undefined);
    setSelectedChecksum(undefined);
    setDuplicate(undefined);
    setReconciliation(undefined);
    setKeptExisting(false);
    setPublication(undefined);
    setResolutionProgress(undefined);
    setError(undefined);

    try {
      const selection = await nativeDocumentPicker.getDocumentAsync({
        type: [
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ],
        copyToCacheDirectory: true,
        multiple: false,
        base64: false,
      });
      if (selection.canceled) {
        setStage("IDLE");
        return;
      }
      const asset = selection.assets[0];
      if (!asset) throw new Error("Aucun fichier sélectionné.");
      setFilename(asset.name);

      setStage("READING");
      await yieldToInterface();
      const bytes = await new nativeFileSystem.FileSystemFile(
        asset.uri,
      ).bytes();
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
        setDuplicate(priorImport);
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
      setStage("COMPLETE");
    } catch (caught) {
      setError(importErrorMessage(caught));
      setStage("ERROR");
    }
  }

  function reset() {
    setStage("IDLE");
    setFilename(undefined);
    setSummary(undefined);
    setProductCatalog(undefined);
    setSelectedBytes(undefined);
    setSelectedChecksum(undefined);
    setDuplicate(undefined);
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
    const nextSummary = rematchMercalysImport(currentSummary, storeId, catalog);
    const overlap = await publicationRepository.analyzeOverlap(
      storeId,
      nextSummary,
    );
    setProductCatalog(catalog);
    setSummary(nextSummary);
    setReconciliation(overlap ?? undefined);
  }

  async function createMissingProducts(
    selectedResolutions: readonly MercalysProductResolution[] = productResolutions,
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
        (completed, total) => setResolutionProgress({ completed, total }),
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

  async function confirmProductMapping(
    resolution: MercalysProductResolution,
    productId: string,
  ) {
    if (!storeId || !summary) return;
    setResolvingProducts(true);
    setError(undefined);
    try {
      await confirmMercalysProductMapping(repository, resolution, productId, {
        storeId,
        deviceId,
        now: () => new Date().toISOString(),
        generateId: randomUUID,
      });
      await refreshProductMatches(summary);
    } catch {
      setError(
        "La correspondance produit n’a pas pu être enregistrée localement.",
      );
    } finally {
      setResolvingProducts(false);
    }
  }

  async function publishValidLines() {
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
      setPublication(result);
      setReconciliation(undefined);
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
        return;
      }
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : "Les lignes valides n’ont pas pu être publiées localement.",
      );
    } finally {
      setPublishing(false);
    }
  }

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
    <AppScreen>
      <AppHeader
        title="Imports Mercalys"
        subtitle="Vérifiez les ventes ou la casse avant toute publication locale."
      />

      <SectionCard title="Nouveau fichier">
        <Text className="text-base leading-6 text-muted">
          Le fichier est lu sur cet appareil. Aucune donnée n’est publiée ni
          envoyée pendant cette vérification.
        </Text>
        <PrimaryButton
          label={
            summary
              ? "Choisir un autre fichier XLSX"
              : "Choisir un fichier XLSX"
          }
          disabled={!hasNativeFilePicker || !storeId}
          loading={loading}
          onPress={() => {
            void chooseWorkbook();
          }}
        />
        {!storeId ? (
          <InlineAlert
            title="Aucun magasin actif"
            message="Reconnectez-vous après l’ajout de votre magasin de développement."
          />
        ) : !hasNativeFilePicker ? (
          <InlineAlert
            title="Module natif absent"
            message="Installez un build de développement récent pour choisir un fichier XLSX."
          />
        ) : null}
      </SectionCard>

      {stage !== "IDLE" ? (
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

      {error ? <InlineAlert title="Import impossible" message={error} /> : null}

      {summary && !reconciliation ? (
        <ValidationSummary
          summary={summary}
          publication={publication}
          publishing={publishing}
          productResolutions={productResolutions}
          products={productCatalog?.products ?? []}
          resolvingProducts={resolvingProducts}
          resolutionProgress={resolutionProgress}
          onCreateProducts={(resolutions) => {
            void createMissingProducts(resolutions);
          }}
          onConfirmProduct={(resolution, productId) => {
            void confirmProductMapping(resolution, productId);
          }}
          onPublish={() => {
            void publishValidLines();
          }}
          onCancel={reset}
        />
      ) : null}

      {summary && reconciliation ? (
        <ReconciliationSummary
          reconciliation={reconciliation}
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
    </AppScreen>
  );
}

function ReconciliationSummary({
  reconciliation,
  keptExisting,
  loading,
  onApply,
  onKeep,
  onCancel,
}: {
  reconciliation: MercalysReconciliation;
  keptExisting: boolean;
  loading: boolean;
  onApply: () => void;
  onKeep: () => void;
  onCancel: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const differences = reconciliation.rows.filter(
    (row) => row.category !== "UNCHANGED",
  );
  if (keptExisting) {
    return (
      <SectionCard title="Réconciliation enregistrée">
        <InlineAlert
          title="Données existantes conservées"
          message="Le nouveau fichier n’a pas modifié les observations locales. Votre décision a été enregistrée."
        />
        <PrimaryButton label="Importer un autre fichier" onPress={onCancel} />
      </SectionCard>
    );
  }
  return (
    <>
      <SectionCard title="Réconciliation nécessaire">
        <CountLine
          label="Lignes inchangées"
          value={reconciliation.counts.UNCHANGED}
          tone="ready"
        />
        <CountLine
          label="Lignes modifiées"
          value={reconciliation.counts.MODIFIED}
          tone="review"
        />
        <CountLine
          label="Nouvelles lignes"
          value={reconciliation.counts.ADDED}
          tone="ready"
        />
        <CountLine
          label="Lignes absentes"
          value={reconciliation.counts.REMOVED}
          tone="review"
        />
        {reconciliation.counts.AMBIGUOUS > 0 ? (
          <CountLine
            label="Lignes ambiguës"
            value={reconciliation.counts.AMBIGUOUS}
            tone="error"
          />
        ) : null}
      </SectionCard>

      {showDetails ? (
        <SectionCard title="Différences">
          {differences.slice(0, 20).map((row) => (
            <ReconciliationRow key={row.key} row={row} />
          ))}
          {differences.length > 20 ? (
            <Text className="text-sm text-muted">
              Et {differences.length - 20} autre
              {differences.length - 20 > 1 ? "s" : ""} différence
              {differences.length - 20 > 1 ? "s" : ""}.
            </Text>
          ) : null}
        </SectionCard>
      ) : null}

      {!reconciliation.safeToApply ? (
        <InlineAlert
          title="Examen nécessaire"
          message="La nouvelle version ne peut pas être appliquée globalement tant que des produits ou des lignes restent ambigus."
        />
      ) : null}

      <SectionCard title="Décision">
        <SecondaryButton
          label={
            showDetails ? "Masquer les différences" : "Examiner les différences"
          }
          onPress={() => setShowDetails((value) => !value)}
        />
        <PrimaryButton
          label="Appliquer la nouvelle version"
          disabled={!reconciliation.safeToApply}
          loading={loading}
          onPress={onApply}
        />
        <SecondaryButton
          label="Conserver l’existant"
          disabled={loading}
          onPress={onKeep}
        />
        <SecondaryButton
          label="Annuler"
          disabled={loading}
          onPress={onCancel}
        />
      </SectionCard>
    </>
  );
}

function ReconciliationRow({ row }: { row: MercalysReconciliationRow }) {
  return (
    <View className="gap-1 border-b border-line pb-3">
      <Text className="text-base font-semibold text-ink">
        {row.productLabel}
      </Text>
      <Text className="text-sm text-muted">
        {formatIsoDate(row.businessDate)} · {reconciliationCategoryLabel(row)}
      </Text>
      {row.existingValues ? (
        <SummaryLine
          label="Quantité existante"
          value={row.existingValues.quantity ?? "Indisponible"}
        />
      ) : null}
      {row.incomingValues ? (
        <SummaryLine
          label="Nouvelle quantité"
          value={row.incomingValues.quantity ?? "Indisponible"}
        />
      ) : null}
    </View>
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
): Promise<ProductMatchCatalog> {
  const [productRecords, identifiers, aliases] = await Promise.all([
    repository.listProducts(storeId),
    repository.listIdentifiersByStore(storeId),
    repository.listAliasesByStore(storeId),
  ]);
  return {
    products: productRecords.map(({ entity }) => entity),
    identifiers: identifiers.map(({ entity }) => entity),
    aliases: aliases.map(({ entity }) => entity),
  };
}

function ValidationSummary({
  summary,
  publication,
  publishing,
  productResolutions,
  products,
  resolvingProducts,
  resolutionProgress,
  onCreateProducts,
  onConfirmProduct,
  onPublish,
  onCancel,
}: {
  summary: MercalysImportValidationSummary;
  publication?: PublishedMercalysImport;
  publishing: boolean;
  productResolutions: MercalysProductResolution[];
  products: readonly Product[];
  resolvingProducts: boolean;
  resolutionProgress?: { completed: number; total: number };
  onCreateProducts(resolutions: readonly MercalysProductResolution[]): void;
  onConfirmProduct(
    resolution: MercalysProductResolution,
    productId: string,
  ): void;
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
        <CountLine label="Prêtes" value={summary.readyCount} tone="ready" />
        <CountLine
          label="Produits à confirmer"
          value={summary.productReviewCount}
          tone="review"
        />
        <CountLine label="Anomalies" value={summary.errorCount} tone="error" />
      </SectionCard>

      {productResolutions.length > 0 ? (
        <ProductResolutionSummary
          resolutions={productResolutions}
          products={products}
          loading={resolvingProducts}
          progress={resolutionProgress}
          onCreate={onCreateProducts}
          onConfirm={onConfirmProduct}
        />
      ) : null}

      {summary.issueCodes.length > 0 ? (
        <InlineAlert
          title="Données à corriger"
          message={summary.issueCodes.map(issueLabel).join(" · ")}
        />
      ) : null}

      <SectionCard title="Publication">
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
        {!publication && summary.readyCount === 0 ? (
          <InlineAlert
            title="Aucune ligne prête à publier"
            message="Confirmez ou ajoutez les produits signalés, puis importez de nouveau le fichier."
          />
        ) : null}
        <PrimaryButton
          label={publication ? "Lignes publiées" : "Publier les lignes valides"}
          disabled={summary.readyCount === 0 || publication !== undefined}
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
  products,
  loading,
  progress,
  onCreate,
  onConfirm,
}: {
  resolutions: MercalysProductResolution[];
  products: readonly Product[];
  loading: boolean;
  progress?: { completed: number; total: number };
  onCreate(resolutions: readonly MercalysProductResolution[]): void;
  onConfirm(resolution: MercalysProductResolution, productId: string): void;
}) {
  const [showAll, setShowAll] = useState(false);
  const creatable = resolutions.filter(({ canCreate }) => canCreate);
  const productById = new Map(products.map((product) => [product.id, product]));
  const visibleResolutions = showAll ? resolutions : resolutions.slice(0, 20);
  return (
    <SectionCard title="Produits à confirmer">
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
            {resolution.canCreate ? (
              <SecondaryButton
                label="Créer ce produit"
                disabled={loading}
                onPress={() => onCreate([resolution])}
              />
            ) : candidates.length === 0 ? (
              <Text className="text-sm text-red-700">
                Cette ligne doit être examinée individuellement.
              </Text>
            ) : null}
          </View>
        );
      })}
      {resolutions.length > 20 ? (
        <SecondaryButton
          label={
            showAll
              ? "Afficher seulement les 20 premiers"
              : `Afficher les ${resolutions.length} produits`
          }
          disabled={loading}
          onPress={() => setShowAll((value) => !value)}
        />
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
  if (error instanceof MercalysImportValidationError) {
    return error.code === "AGGREGATED_PERIOD_WITHOUT_DAILY_DATES"
      ? "Cet export regroupe plusieurs jours sans dates journalières. Dans Mercalys, choisissez un seul jour ou activez le détail « Par Jour » avec la colonne Date."
      : "Format Mercalys non reconnu. Vérifiez qu’il s’agit d’un export Ventes nettes ou Casse par article.";
  }
  const message = error instanceof Error ? error.message : "";
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

function reconciliationCategoryLabel(row: MercalysReconciliationRow) {
  if (row.category === "UNCHANGED") return "Inchangée";
  if (row.category === "ADDED") return "Nouvelle ligne";
  if (row.category === "REMOVED") return "Absente du nouveau fichier";
  if (row.category === "MODIFIED") return "Modifiée";
  if (row.reason === "UNRESOLVED_PRODUCT") return "Produit à confirmer";
  return "Comparaison ambiguë";
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
