import { createElement, type ReactNode } from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { MercalysImportScreen } from "./mercalys-import-screen";
import { MercalysOverlapReconciliationError } from "./mercalys-import-publication";
import type { MercalysImportValidationSummary } from "./mercalys-import-validation";
import type { MercalysReconciliation } from "./mercalys-import-reconciliation";

const p = vi.hoisted(() => ({
  identifiers: [] as { entity: Record<string, unknown>; syncState: string }[],
  products: [] as { entity: Record<string, unknown>; syncState: string }[],
  validate: vi.fn(),
  analyze: vi.fn(),
  publish: vi.fn(),
  duplicate: vi.fn(),
  continuation: vi.fn(),
  resume: vi.fn(),
  sync: vi.fn(),
  write: vi.fn(),
  close: vi.fn(),
  changed: vi.fn(),
  read: vi.fn(),
}));
vi.mock("expo-router", () => ({ useIsFocused: () => true }));
vi.mock("react-native", () => ({
  StyleSheet: { create: (value: unknown) => value },
  Text: "Text",
  View: "View",
  TextInput: "TextInput",
  Pressable: "Pressable",
  Modal: ({ visible, children }: { visible: boolean; children: ReactNode }) =>
    visible ? children : null,
}));
vi.mock("../components/ui", () => {
  const box = ({
    children,
    title,
    label,
    message,
    ...props
  }: {
    children?: ReactNode;
    title?: string;
    label?: string;
    message?: string;
  }) =>
    createElement(
      "UI",
      { ...props, title, label, message },
      title,
      label,
      message,
      children,
    );
  return {
    AppScreen: box,
    AppHeader: box,
    SectionCard: box,
    InlineAlert: box,
    PrimaryButton: box,
    SecondaryButton: box,
  };
});
vi.mock("../auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      user: { id: "99999999-9999-4999-8999-999999999999" },
      stores: [
        { storeId: "11111111-1111-4111-8111-111111111111", role: "MANAGER" },
      ],
    },
  }),
}));
vi.mock("../providers/database-provider", () => ({
  useLocalDatabase: () => ({ sqlite: {}, deviceId: "device" }),
}));
vi.mock("../sync/sync-provider", () => ({
  useSync: () => ({ syncNow: p.sync }),
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "33333333-3333-4333-8333-333333333333",
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
  digest: async () => new Uint8Array(32).buffer,
}));
vi.mock("expo-file-system", () => ({
  Paths: { document: "file:///documents" },
  Directory: class {
    create() {}
  },
  File: class {
    uri = "file:///documents/original.xlsx";
    exists = false;
    create() {}
    write = p.write;
    delete() {}
  },
}));
vi.mock("./read-retained-mercalys", () => ({
  readRetainedMercalysBytes: p.read,
}));
vi.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: (name: string) =>
    name === "FileSystem"
      ? {
          FileSystemFile: class {
            bytes = async () => new Uint8Array([1]).slice();
          },
        }
      : { getDocumentAsync: vi.fn() },
}));
vi.mock("../analytics/local-recomputation", () => ({
  LocalAnalyticsRecomputationScheduler: class {
    process = async () => ({ failedJobs: 0 });
  },
  SQLiteProductDateRecomputer: class {},
}));
vi.mock("./source-original-button", () => ({
  SourceOriginalButton: () => null,
}));
vi.mock("./source-upload-recovery-panel", () => ({
  SourceUploadRecoveryPanel: () => null,
}));
vi.mock("./mercalys-batch-panel", () => ({ MercalysBatchPanel: () => null }));
vi.mock("./sheetjs-spreadsheet-parser", () => ({
  SheetJsSpreadsheetParser: class {
    parse() {
      return {};
    }
  },
}));
vi.mock("./mercalys-import-validation", async (importActual) => ({
  ...(await importActual<typeof import("./mercalys-import-validation")>()),
  validateMercalysImport: p.validate,
}));
vi.mock("./mercalys-import-publication", async (importActual) => ({
  ...(await importActual<typeof import("./mercalys-import-publication")>()),
  MercalysImportPublicationRepository: class {
    findExactDuplicate = p.duplicate;
    continuation = p.continuation;
    resume = p.resume;
    analyzeOverlap = p.analyze;
    publish = p.publish;
  },
}));
vi.mock("../products/product-master-repository", () => ({
  ProductMasterRepository: class {
    listProducts = async () => p.products;
    listIdentifiersByStore = async () => p.identifiers;
    listAliasesByStore = async () => [];
    upsertIdentifier = async (entity: Record<string, unknown>) => {
      p.identifiers.push({ entity, syncState: "PENDING" });
    };
  },
}));
const asset = {
  name: "21102026.xlsx",
  uri: "file:///retained/21102026.xlsx",
  expectedChecksum: `sha256:${"0".repeat(64)}`,
};
let renderer: ReactTestRenderer | undefined;
function text(n: ReactTestInstance): string {
  return n.children
    .map((c) => (typeof c === "string" ? c : text(c)))
    .join(" ")
    .replace(/\s+/g, " ");
}
function button(label: string) {
  return renderer!.root.findAll(
    (n) => n.props.label === label && typeof n.props.onPress === "function",
  )[0]!;
}
async function press(label: string) {
  await act(async () => {
    const b = button(label);
    expect(b, label).toBeDefined();
    expect(b.props.disabled).not.toBe(true);
    b.props.onPress();
  });
}
function compare(
  summary: MercalysImportValidationSummary,
): MercalysReconciliation {
  const resolved = summary.productReviewCount === 0;
  return {
    sourceType: "MERCALYS_SALES",
    businessPeriodStart: "2026-10-21",
    businessPeriodEnd: "2026-10-21",
    priorSourceDocumentIds: ["old"],
    fingerprint: resolved ? "resolved-fingerprint" : "unresolved-fingerprint",
    counts: {
      UNCHANGED: 0,
      ADDED: 0,
      REMOVED: 0,
      MODIFIED: resolved ? 1 : 0,
      AMBIGUOUS: resolved ? 0 : 1,
    },
    safeToApply: resolved,
    rows: [
      {
        key: "line",
        category: resolved ? "MODIFIED" : "AMBIGUOUS",
        productId: resolved ? "22222222-2222-4222-8222-222222222222" : null,
        productLabel: "TOMATE VRAC",
        businessDate: "2026-10-21",
        incomingSourceIndex: 30,
        incomingRecord: summary.lines[0]!.record,
        existingObservationIds: ["old-observation"],
        existingSourceRecordIds: ["old-record"],
        existingValues: {
          quantity: "1",
          salesValue: "10",
          purchaseValue: "8",
          marginValue: "2",
          rceValue: null,
          vatValue: null,
          marginRate: null,
        },
        incomingValues: {
          quantity: "2",
          salesValue: "20",
          purchaseValue: "16",
          marginValue: "4",
          rceValue: null,
          vatValue: null,
          marginRate: null,
        },
        reason: resolved ? null : "UNRESOLVED_PRODUCT",
      },
    ],
  };
}
async function mount() {
  await act(async () => {
    renderer = create(
      createElement<NonNullable<Parameters<typeof MercalysImportScreen>[0]>>(
        MercalysImportScreen,
        { retainedAsset: asset, onClose: p.close, onChanged: p.changed },
      ),
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  p.read.mockResolvedValue(new Uint8Array([1]).slice());
  p.identifiers = [];
  p.products = [
    {
      entity: {
        id: "22222222-2222-4222-8222-222222222222",
        storeId: "11111111-1111-4111-8111-111111111111",
        label: "TOMATE VRAC",
        status: "ACTIVE",
        category: "VEGETABLE",
        nature: "BULK",
        salesUnit: "KG",
        deletedAt: null,
      },
      syncState: "SYNCED",
    },
  ];
  const summary: MercalysImportValidationSummary = {
    sourceType: "MERCALYS_SALES",
    parserVersion: "v1",
    businessPeriodStart: "2026-10-21",
    businessPeriodEnd: "2026-10-21",
    detectedLineCount: 1,
    readyCount: 0,
    productReviewCount: 1,
    errorCount: 0,
    issueCodes: [],
    lines: [
      {
        record: {
          sourceIndex: 30,
          businessDate: "2026-10-21",
          rawLabel: "TOMATE VRAC",
          itm8: "00000001",
          ean: null,
          quantity: 2,
          salesValue: 20,
          purchaseValue: 16,
          rceValue: null,
          vatValue: null,
          marginValue: 4,
          marginRate: null,
          rawValues: {
            itm8: "00000001",
            ean: null,
            rawLabel: "TOMATE VRAC",
            businessDate: "2026-10-21",
            quantity: 2,
            salesValue: 20,
            purchaseValue: 16,
            rceValue: null,
            vatValue: null,
            marginValue: 4,
            marginRate: null,
          },
        },
        match: {
          engineVersion: "product-matcher-v1",
          state: "REVIEW",
          matchedProductId: null,
          method: "FUZZY_LABEL",
          conflict: null,
          candidates: [
            {
              productId: "22222222-2222-4222-8222-222222222222",
              score: 0.7,
              method: "FUZZY_LABEL",
              reasons: ["FUZZY_LABEL_MATCH"],
            },
          ],
        },
      },
    ],
  };
  p.validate.mockReturnValue(summary);
  p.duplicate.mockResolvedValue(null);
  p.analyze.mockImplementation(async (_store, s) => compare(s));
  p.publish.mockResolvedValue({
    sourceDocumentId: "new-source",
    localFileId: "file",
    analyticsJobId: "job",
    publishedCount: 1,
    remainingCount: 0,
    replacedCount: 1,
  });
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      original(...args);
  });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
  vi.restoreAllMocks();
});
it("opens a retained corrected file, resolves its product through the real mapping/rematch functions and requires explicit current-fingerprint application", async () => {
  await mount();
  expect(text(renderer!.root)).toContain("Comparer les deux versions");
  expect(p.publish).not.toHaveBeenCalled();
  await press("Confirmer le produit");
  await press("Associer à TOMATE VRAC");
  expect(p.identifiers).toHaveLength(1);
  expect(p.changed).toHaveBeenCalledTimes(1);
  expect(text(renderer!.root)).toContain("Comparer les deux versions");
  expect(button("Appliquer la nouvelle version").props.disabled).toBe(false);
  expect(p.publish).not.toHaveBeenCalled();
  await press("Appliquer la nouvelle version");
  expect(p.publish).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      filename: "21102026.xlsx",
      checksum: asset.expectedChecksum,
      reconciliationApproval: {
        fingerprint: "resolved-fingerprint",
        actorUserId: "99999999-9999-4999-8999-999999999999",
      },
      summary: expect.objectContaining({
        productReviewCount: 0,
        readyCount: 1,
      }),
    }),
  );
  expect(p.write).toHaveBeenCalledWith(new Uint8Array([1]));
  expect(p.changed).toHaveBeenCalledTimes(2);
  expect(text(renderer!.root)).toContain("publiée localement");
});
it("offers correction and distinct creation for an already automatic association even when no products need confirmation", async () => {
  const source = p.validate.mock.results[0]?.value as
    MercalysImportValidationSummary | undefined;
  expect(source).toBeUndefined();
  const resolved: MercalysImportValidationSummary = {
    sourceType: "MERCALYS_SALES",
    parserVersion: "v1",
    businessPeriodStart: "2026-10-21",
    businessPeriodEnd: "2026-10-21",
    detectedLineCount: 1,
    readyCount: 1,
    productReviewCount: 0,
    errorCount: 0,
    issueCodes: [],
    lines: [
      {
        record: {
          sourceIndex: 30,
          itm8: "00000042",
          ean: null,
          rawLabel: "PDT RACLETTE MICRO ONDE 500G",
          businessDate: "2026-10-21",
          quantity: 4,
          purchaseValue: 2,
          rceValue: 0,
          salesValue: 7.96,
          vatValue: 0,
          marginValue: 1,
          marginRate: 10,
          rawValues: {
            itm8: "00000042",
            ean: null,
            rawLabel: "PDT RACLETTE MICRO ONDE 500G",
            businessDate: "2026-10-21",
            quantity: 4,
            purchaseValue: 2,
            rceValue: 0,
            salesValue: 7.96,
            vatValue: 0,
            marginValue: 1,
            marginRate: 10,
          },
        },
        match: {
          engineVersion: "product-matcher-v1",
          state: "AUTO_MATCH",
          matchedProductId: "22222222-2222-4222-8222-222222222222",
          method: "EXACT_IDENTIFIER",
          candidates: [],
          conflict: null,
        },
      },
    ],
  };
  p.validate.mockReturnValue(resolved);
  await mount();
  expect(text(renderer!.root)).toContain("Produit associé : TOMATE VRAC");
  await press("Corriger l’association");
  expect(text(renderer!.root)).toContain("PDT RACLETTE MICRO ONDE 500G");
  expect(button("Créer comme nouveau produit").props.disabled).not.toBe(true);
  expect(button("Associer à TOMATE VRAC")).toBeDefined();
  expect(p.publish).not.toHaveBeenCalled();
});

it("reopens comparison if observations change before apply instead of claiming a successful replacement", async () => {
  await mount();
  await press("Confirmer le produit");
  await press("Associer à TOMATE VRAC");
  const blocked = compare(p.validate.mock.results[0]!.value);
  blocked.fingerprint = "changed-again";
  p.publish.mockRejectedValue(new MercalysOverlapReconciliationError(blocked));
  await press("Appliquer la nouvelle version");
  expect(button("Application bloquée — points à résoudre").props.disabled).toBe(
    true,
  );
  expect(text(renderer!.root)).toContain("Des points restent à résoudre");
  expect(text(renderer!.root)).not.toContain("publiée localement");
});
it("does not expose the batch history or upload-recovery list at file detail level", async () => {
  await mount();
  expect(text(renderer!.root)).not.toContain("Imports récents");
  expect(button("Envois et synchronisation des fichiers")).toBeUndefined();
  await press("Fermer le fichier");
  expect(p.close).toHaveBeenCalledTimes(1);
});

it("reopens a partial duplicate and completes only the unpublished rows through the existing resume path", async () => {
  p.duplicate.mockResolvedValue({
    sourceDocumentId: "partial-source",
    sourceType: "MERCALYS_SALES",
  });
  p.continuation.mockImplementation(
    async (_store, _checksum, summary: MercalysImportValidationSummary) => ({
      sourceDocumentId: "partial-source",
      publishedCount: 1,
      remainingCount: 1,
      summary: {
        ...summary,
        detectedLineCount: 2,
        readyCount: summary.readyCount + 1,
      },
    }),
  );
  p.resume.mockResolvedValue({
    sourceDocumentId: "partial-source",
    publishedCount: 1,
    remainingCount: 0,
    replacedCount: 0,
  });
  await mount();
  expect(text(renderer!.root)).toContain("Publication à compléter");
  expect(text(renderer!.root)).not.toContain("Ce fichier a déjà été importé");
  await press("Associer à TOMATE VRAC");
  expect(button("Publier les lignes restantes").props.disabled).toBe(false);
  expect(p.resume).not.toHaveBeenCalled();
  await press("Publier les lignes restantes");
  expect(p.resume).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      sourceDocumentId: "partial-source",
      checksum: asset.expectedChecksum,
    }),
  );
  expect(p.publish).not.toHaveBeenCalled();
  expect(p.write).not.toHaveBeenCalled();
  expect(text(renderer!.root)).toContain("2 lignes publiées localement");
});
it("keeps a completed duplicate read-only and explains a blocked partial-source continuation", async () => {
  p.duplicate.mockResolvedValue({
    sourceDocumentId: "old-source",
    sourceType: "MERCALYS_SALES",
    createdAt: "2026-10-23T10:00:00Z",
    localProcessingStatus: "PUBLISHED",
  });
  p.continuation.mockResolvedValue({
    sourceDocumentId: "old-source",
    publishedCount: 1,
    remainingCount: 0,
    summary: p.validate.mock.results[0]?.value,
  });
  await mount();
  expect(text(renderer!.root)).toContain("Ce fichier a déjà été importé");
  expect(p.publish).not.toHaveBeenCalled();
  await act(async () => renderer!.unmount());
  renderer = undefined;
  p.continuation.mockRejectedValue(new Error("MERCALYS_CONTINUATION_CONFLICT"));
  await mount();
  expect(text(renderer!.root)).toContain("conflit de synchronisation");
  expect(p.resume).not.toHaveBeenCalled();
});

it("explains an unavailable retained original without exposing native paths or enabling publication", async () => {
  p.read.mockRejectedValueOnce(
    Object.assign(new Error("native-private-path"), { code: "ENOENT" }),
  );
  await mount();
  expect(text(renderer!.root)).toContain(
    "L’original conservé ne peut pas être retrouvé",
  );
  expect(text(renderer!.root)).not.toContain("native-private-path");
  expect(p.publish).not.toHaveBeenCalled();
  expect(p.changed).not.toHaveBeenCalled();
});
