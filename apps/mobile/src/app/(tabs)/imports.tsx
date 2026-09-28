import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import type { ProductMatchCatalog } from "@fl-copilot/domain";
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
  validateMercalysImport,
  type MercalysImportValidationSummary,
} from "@/documents/mercalys-import-validation";
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
  const { sqlite } = useLocalDatabase();
  const { session } = useAuth();
  const storeId = session?.stores[0]?.storeId;
  const repository = useMemo(
    () => new ProductMasterRepository(sqlite),
    [sqlite],
  );
  const [stage, setStage] = useState<ImportStage>("IDLE");
  const [filename, setFilename] = useState<string>();
  const [summary, setSummary] = useState<MercalysImportValidationSummary>();
  const [error, setError] = useState<string>();
  const loading = ["READING", "MATCHING", "VALIDATING"].includes(stage);

  async function chooseWorkbook() {
    if (!hasNativeFilePicker || !storeId) return;
    setFilename(undefined);
    setSummary(undefined);
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

      setStage("VALIDATING");
      await yieldToInterface();
      setSummary(nextSummary);
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
    setError(undefined);
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

      {summary ? (
        <ValidationSummary summary={summary} onCancel={reset} />
      ) : null}
    </AppScreen>
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
  onCancel,
}: {
  summary: MercalysImportValidationSummary;
  onCancel: () => void;
}) {
  const reviewLines = summary.lines.filter(
    ({ match }) => match.state !== "AUTO_MATCH",
  );
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

      {reviewLines.length > 0 ? (
        <SectionCard title="Produits à examiner">
          {reviewLines.slice(0, 5).map(({ record, match }) => (
            <View
              key={record.sourceIndex}
              className="gap-1 border-b border-line pb-3"
            >
              <Text className="text-base font-semibold text-ink">
                {record.rawLabel}
              </Text>
              <Text className="text-sm text-muted">
                {match.state === "AMBIGUOUS"
                  ? "Plusieurs produits possibles"
                  : match.state === "REVIEW"
                    ? "Correspondance à confirmer"
                    : "Produit absent du référentiel"}
              </Text>
            </View>
          ))}
          {reviewLines.length > 5 ? (
            <Text className="text-sm text-muted">
              Et {reviewLines.length - 5} autre
              {reviewLines.length - 5 > 1 ? "s" : ""} ligne
              {reviewLines.length - 5 > 1 ? "s" : ""} à examiner.
            </Text>
          ) : null}
        </SectionCard>
      ) : null}

      {summary.issueCodes.length > 0 ? (
        <InlineAlert
          title="Données à corriger"
          message={summary.issueCodes.map(issueLabel).join(" · ")}
        />
      ) : null}

      <SectionCard title="Publication">
        <Text className="text-base leading-6 text-muted">
          La publication locale sera activée à l’étape suivante. Ce contrôle n’a
          encore modifié aucune vente, aucune casse et aucun indicateur.
        </Text>
        <PrimaryButton
          label="Publier les lignes valides"
          disabled
          onPress={() => {}}
        />
        <SecondaryButton label="Annuler l’import" onPress={onCancel} />
      </SectionCard>
    </>
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
