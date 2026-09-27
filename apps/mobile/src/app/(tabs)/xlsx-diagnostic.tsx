import { useState } from "react";
import { Platform, Text } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import * as XLSX from "xlsx";
import {
  AppHeader,
  AppScreen,
  InlineAlert,
  SecondaryButton,
  SectionCard,
} from "@/components/ui";
import {
  SheetJsSpreadsheetParser,
  XLSX_ADAPTER_VERSION,
} from "@/documents/sheetjs-spreadsheet-parser";
import type { SpreadsheetWorkbook } from "@/documents/spreadsheet-parser";

interface DiagnosticResult {
  filename: string;
  sizeBytes: number;
  elapsedMilliseconds: number;
  sheetCount: number;
  emptySheetCount: number;
  rowCount: number;
  formattedLeadingZeroCount: number;
  dateCellCount: number;
  totalLabelCount: number;
}

interface NativeDocumentPickerAsset {
  name: string;
  size?: number;
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

export default function XlsxDiagnosticScreen() {
  const [result, setResult] = useState<DiagnosticResult>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  async function chooseWorkbook() {
    if (!hasNativeFilePicker) return;

    setError(undefined);
    setResult(undefined);
    setLoading(true);
    try {
      const selection = await nativeDocumentPicker.getDocumentAsync({
        type: [
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ],
        copyToCacheDirectory: true,
        multiple: false,
        base64: false,
      });
      if (selection.canceled) return;

      const asset = selection.assets[0];
      if (!asset) throw new Error("Aucun fichier sélectionné.");
      const bytes = await new nativeFileSystem.FileSystemFile(
        asset.uri,
      ).bytes();
      setResult(parseAndSummarize(asset.name, bytes));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "";
      setError(
        message.includes("ExpoDocumentPicker") ||
          message.includes("ExpoFileSystem")
          ? "Ce build ne contient pas encore le sélecteur de documents. Installez un nouveau build de développement, puis réessayez."
          : message || "Le classeur n’a pas pu être lu.",
      );
    } finally {
      setLoading(false);
    }
  }

  function runBuiltInDiagnostic(rowCount = 320) {
    setError(undefined);
    setResult(undefined);
    setLoading(true);
    try {
      const bytes = createBuiltInWorkbook(rowCount);
      setResult(parseAndSummarize(`diagnostic-${rowCount}-lignes.xlsx`, bytes));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Le diagnostic intégré a échoué.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppScreen>
      <AppHeader
        title="Diagnostic XLSX"
        subtitle="Vérification technique locale du futur import Mercalys."
      />
      <SectionCard title="Appareil">
        <Text className="text-base leading-6 text-muted">
          {Platform.OS} · Adaptateur {XLSX_ADAPTER_VERSION}
        </Text>
        <Text className="text-base leading-6 text-muted">
          Choisissez un export Mercalys anonymisé. Le fichier reste sur
          l’appareil et aucun envoi réseau n’est effectué.
        </Text>
        <SecondaryButton
          label={
            hasNativeFilePicker
              ? "Choisir un fichier XLSX"
              : "Nouveau build requis pour choisir un fichier"
          }
          disabled={!hasNativeFilePicker}
          loading={loading}
          onPress={() => {
            void chooseWorkbook();
          }}
        />
        {!hasNativeFilePicker ? (
          <InlineAlert
            title="Module natif absent"
            message="Cette version installée peut exécuter le test intégré, mais elle doit être remplacée par un nouveau build de développement pour ouvrir un fichier XLSX de l’iPhone."
          />
        ) : null}
        <SecondaryButton
          label="Tester le classeur intégré"
          loading={loading}
          onPress={() => runBuiltInDiagnostic()}
        />
        <SecondaryButton
          label="Tester la charge de 10 000 lignes"
          loading={loading}
          onPress={() => runBuiltInDiagnostic(10_000)}
        />
        <Text className="text-sm leading-5 text-muted">
          Le test intégré vérifie immédiatement l’adaptateur JavaScript. Le
          choix d’un fichier réel nécessite un build créé après l’ajout des
          modules natifs.
        </Text>
      </SectionCard>
      {error ? (
        <InlineAlert title="Lecture impossible" message={error} />
      ) : null}
      {result ? (
        <SectionCard title="Résultat">
          <DiagnosticLine label="Fichier" value={result.filename} />
          <DiagnosticLine
            label="Taille"
            value={`${formatBytes(result.sizeBytes)} (${result.sizeBytes} octets)`}
          />
          <DiagnosticLine
            label="Durée de lecture"
            value={`${Math.round(result.elapsedMilliseconds)} ms`}
          />
          <DiagnosticLine
            label="Feuilles"
            value={`${result.sheetCount}, dont ${result.emptySheetCount} vide(s)`}
          />
          <DiagnosticLine
            label="Lignes exposées"
            value={String(result.rowCount)}
          />
          <DiagnosticLine
            label="Identifiants formatés avec zéro initial"
            value={String(result.formattedLeadingZeroCount)}
          />
          <DiagnosticLine
            label="Cellules de date"
            value={String(result.dateCellCount)}
          />
          <DiagnosticLine
            label="Libellés TOTAL"
            value={String(result.totalLabelCount)}
          />
          <Text className="text-sm leading-5 text-muted">
            Pour valider la mémoire sur iPhone, relevez le pic mémoire avec
            Xcode Instruments pendant cette lecture. Aucun chiffre mémoire
            fiable n’est exposé par Hermes à l’application.
          </Text>
        </SectionCard>
      ) : null}
    </AppScreen>
  );
}

function parseAndSummarize(filename: string, bytes: ArrayBuffer | Uint8Array) {
  const startedAt = performance.now();
  const workbook = new SheetJsSpreadsheetParser().parse(bytes);
  return summarizeWorkbook(
    filename,
    bytes.byteLength,
    performance.now() - startedAt,
    workbook,
  );
}

function createBuiltInWorkbook(rowCount: number) {
  const rows: unknown[][] = [
    ["Rapport ventes nettes Mercalys"],
    ["Rapport généré le", new Date("2026-09-27T00:00:00.000Z")],
    ["Période sélectionnée", "15/04/2024"],
    [],
    ["ITM8 Prio", "EAN Prio", "Libellé", "Date", "Quantité", "Valeur"],
  ];
  for (let index = 0; index < rowCount; index += 1) {
    rows.push([
      String(index).padStart(8, "0"),
      String(index).padStart(13, "0"),
      `Produit ${index}`,
      "15/04/2024",
      index / 10,
      index / 100,
    ]);
  }
  rows.push([null, null, "TOTAL", null, 51_040, 510.4]);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(rows),
    "Ventes",
  );
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([]), "Vide");
  return XLSX.write(workbook, {
    type: "array",
    bookType: "xlsx",
  }) as ArrayBuffer;
}

function summarizeWorkbook(
  filename: string,
  sizeBytes: number,
  elapsedMilliseconds: number,
  workbook: SpreadsheetWorkbook,
): DiagnosticResult {
  const cells = workbook.sheets.flatMap((sheet) => sheet.rows.flat());
  return {
    filename,
    sizeBytes,
    elapsedMilliseconds,
    sheetCount: workbook.sheets.length,
    emptySheetCount: workbook.sheets.filter((sheet) => sheet.empty).length,
    rowCount: workbook.sheets.reduce((sum, sheet) => sum + sheet.rowCount, 0),
    formattedLeadingZeroCount: cells.filter(
      (cell) => cell.formattedValue?.startsWith("0") ?? false,
    ).length,
    dateCellCount: cells.filter((cell) => cell.kind === "DATE").length,
    totalLabelCount: cells.filter(
      (cell) =>
        typeof cell.value === "string" &&
        cell.value.trim().toLocaleUpperCase("fr-FR") === "TOTAL",
    ).length,
  };
}

function DiagnosticLine({ label, value }: { label: string; value: string }) {
  return (
    <Text className="text-base leading-6 text-ink">
      <Text className="font-semibold">{label} : </Text>
      {value}
    </Text>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}
