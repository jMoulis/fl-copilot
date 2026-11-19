import * as confirmation from "./mercalys-confirmation-session";
import { MercalysReviewCache } from "./mercalys-review-cache";
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
  remove: vi.fn(),
  referenced: vi.fn(),
  close: vi.fn(),
  changed: vi.fn(),
  read: vi.fn(),
  sqlite: {
    getFirstAsync: vi.fn(),
    runAsync: vi.fn(),
    getAllAsync: vi.fn(),
    withExclusiveTransactionAsync: vi.fn(),
  },
  recover: vi.fn(),
  originalsEnabled: false,
  digest: vi.fn(),
  recompute: vi.fn(async () => ({ failedJobs: 0 })),
}));
vi.mock("expo-router", () => ({ useIsFocused: () => true }));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Icon" }));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaProvider: ({ children }: { children: ReactNode }) =>
    createElement("SafeAreaProvider", {}, children),
  initialWindowMetrics: null,
}));
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
    header,
    title,
    label,
    message,
    ...props
  }: {
    children?: ReactNode;
    header?: ReactNode;
    title?: string;
    label?: string;
    message?: string;
  }) =>
    createElement(
      "UI",
      { ...props, title, label, message },
      header,
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
  useLocalDatabase: () => ({ sqlite: p.sqlite, deviceId: "device" }),
}));
vi.mock("../sync/sync-provider", () => ({
  useSync: () => ({
    syncNow: p.sync,
    originals: p.originalsEnabled ? { recover: p.recover } : undefined,
  }),
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "33333333-3333-4333-8333-333333333333",
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
  digest: p.digest,
}));
vi.mock("expo-file-system", () => ({
  Paths: { document: "file:///documents" },
  Directory: class {
    create() {}
  },
  File: class {
    uri = "file:///documents/original.xlsx";
    exists = false;
    create() {
      this.exists = true;
    }
    write = p.write;
    delete() {
      p.remove();
      this.exists = false;
    }
  },
}));
vi.mock("./source-upload-recovery", () => ({
  isLocalOriginalReferenced: p.referenced,
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
    process = p.recompute;
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
  validateMercalysImportResponsive: p.validate,
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
    getProduct = async (id: string) =>
      p.products.find((r) => r.entity.id === id);
    upsertAlias = async () => {};
    listProducts = async () => p.products;
    listIdentifiersByStore = async () => p.identifiers;
    findIdentifiersByCodes = async () => p.identifiers;
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
    (n) =>
      (n.props.label === label || n.props.accessibilityLabel === label) &&
      typeof n.props.onPress === "function",
  )[0]!;
}
async function press(label: string) {
  await act(async () => {
    const b = button(label);
    expect(b, label).toBeDefined();
    expect(b.props.disabled).not.toBe(true);
    b.props.onPress();
    await new Promise((resolve) => setTimeout(resolve, 20));
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
async function mount(
  extra: Partial<NonNullable<Parameters<typeof MercalysImportScreen>[0]>> = {},
) {
  await act(async () => {
    renderer = create(
      createElement<NonNullable<Parameters<typeof MercalysImportScreen>[0]>>(
        MercalysImportScreen,
        {
          retainedAsset: asset,
          onClose: p.close,
          onChanged: p.changed,
          ...extra,
        },
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
  p.sqlite = {
    getFirstAsync: vi.fn(),
    runAsync: vi.fn(),
    getAllAsync: vi.fn(),
    withExclusiveTransactionAsync: vi.fn(async (task) => task(p.sqlite)),
  };
  p.originalsEnabled = false;
  p.sqlite.getFirstAsync.mockReset().mockResolvedValue(null);
  p.recover.mockReset();
  p.continuation.mockReset().mockResolvedValue(null);
  p.digest.mockReset().mockResolvedValue(new Uint8Array(32).buffer);
  p.remove.mockReset();
  p.referenced.mockReset().mockResolvedValue(false);
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
it("opens an existing email batch without workbook reading, publication or background recomputation", async () => {
  await act(async () => {
    renderer = create(
      createElement<NonNullable<Parameters<typeof MercalysImportScreen>[0]>>(
        MercalysImportScreen,
        {
          initialBatchId: "11111111-1111-4111-8111-111111111111",
          closeLabel: "Retour aux documents reçus",
          onClose: p.close,
        },
      ),
    );
  });
  expect(p.read).not.toHaveBeenCalled();
  expect(p.publish).not.toHaveBeenCalled();
  expect(p.recompute).not.toHaveBeenCalled();
  await press("Retour aux documents reçus");
  expect(p.close).toHaveBeenCalledTimes(1);
});
it("opens a retained corrected file, resolves its product through the real mapping/rematch functions and requires explicit current-fingerprint application", async () => {
  await mount();
  expect(text(renderer!.root)).toContain("Comparer les deux versions");
  expect(p.publish).not.toHaveBeenCalled();
  await press("Confirmer le produit");
  await press("Associer à TOMATE VRAC");
  await press("Terminer les confirmations");
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
  await press("Terminer les confirmations");
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
  await press("Terminer les confirmations");
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

it.each(["COMMITTED", "READ_FAILURE", "ROLLED_BACK", "DELETE_FAILED"])(
  "preserves original ownership and the publication error during cleanup: %s",
  async (mode) => {
    await mount();
    await press("Confirmer le produit");
    await press("Associer à TOMATE VRAC");
    await press("Terminer les confirmations");
    p.publish.mockRejectedValue(new Error("PUBLICATION_FAILED"));
    if (mode === "COMMITTED") p.referenced.mockResolvedValue(true);
    if (mode === "READ_FAILURE")
      p.referenced.mockRejectedValue(new Error("DATABASE_UNAVAILABLE"));
    if (mode === "DELETE_FAILED")
      p.remove.mockImplementation(() => {
        throw Error("DISK_UNAVAILABLE");
      });
    await press("Appliquer la nouvelle version");
    expect(p.remove).toHaveBeenCalledTimes(
      ["COMMITTED", "READ_FAILURE"].includes(mode) ? 0 : 1,
    );
    expect(p.referenced).toHaveBeenCalledWith(
      expect.anything(),
      "file:///documents/original.xlsx",
    );
    expect(text(renderer!.root)).toContain("PUBLICATION_FAILED");
    expect(text(renderer!.root)).not.toContain("publiée localement");
    expect(p.sync).not.toHaveBeenCalled();
  },
);

it("recovers an old import through the existing original service and offers retry without republication", async () => {
  p.originalsEnabled = true;
  p.sqlite.getFirstAsync.mockResolvedValue({
    id: "55555555-5555-4555-8555-555555555555",
    local_file_uri: null,
  });
  p.read.mockImplementation(async (uri: string) => {
    if (uri === asset.uri)
      throw Object.assign(new Error("old-private-container"), {
        code: "ENOENT",
      });
    return new Uint8Array([1]).slice();
  });
  p.recover.mockRejectedValueOnce(new TypeError("offline"));
  p.recover.mockResolvedValueOnce({
    localUri: "file:///recovered-original.xlsx",
    views: null,
  });
  p.duplicate.mockResolvedValue({
    sourceDocumentId: "old-source",
    sourceType: "MERCALYS_SALES",
    createdAt: "2026-10-23T10:00:00Z",
    localProcessingStatus: "PUBLISHED",
  });
  await mount();
  expect(text(renderer!.root)).toContain("La récupération n’a pas abouti");
  expect(text(renderer!.root)).not.toContain("old-private-container");
  expect(p.publish).not.toHaveBeenCalled();
  await press("Réessayer la lecture");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(p.recover).toHaveBeenCalledTimes(2);
  expect(text(renderer!.root)).toContain("Ce fichier a déjà été importé");
  expect(p.publish).not.toHaveBeenCalled();
  expect(p.resume).not.toHaveBeenCalled();
  expect(p.write).not.toHaveBeenCalled();
  expect(p.changed).not.toHaveBeenCalled();
});
it("checks the recovered old import checksum before parsing or publishing it", async () => {
  p.originalsEnabled = true;
  p.sqlite.getFirstAsync.mockResolvedValue({
    id: "55555555-5555-4555-8555-555555555555",
    local_file_uri: null,
  });
  p.read.mockRejectedValueOnce(
    Object.assign(new Error("missing"), { code: "ENOENT" }),
  );
  p.recover.mockResolvedValue({
    localUri: "file:///recovered-original.xlsx",
    views: null,
  });
  p.digest.mockResolvedValueOnce(new Uint8Array(32).fill(1).buffer);
  await mount();
  expect(p.recover).toHaveBeenCalledTimes(1);
  expect(text(renderer!.root)).toContain("L’original conservé a changé");
  expect(p.validate).not.toHaveBeenCalled();
  expect(p.publish).not.toHaveBeenCalled();
});

it("keeps retained-file review dismissible during matching and aborts on unmount", async () => {
  const summary = p.validate();
  let resolve!: (value: MercalysImportValidationSummary) => void;
  p.validate.mockImplementation(
    () =>
      new Promise<MercalysImportValidationSummary>((r) => {
        resolve = r;
      }),
  );
  await mount();
  expect(text(renderer!.root)).toContain("Identification des produits");
  const signal = p.validate.mock.calls.at(-1)?.[3] as AbortSignal;
  expect(signal.aborted).toBe(false);
  expect(text(renderer!.root)).toContain("Chargement du catalogue produits…");
  const progress = p.validate.mock.calls.at(-1)?.[4] as (value: {
    completed: number;
    total: number;
  }) => void;
  await act(async () => progress({ completed: 20, total: 1226 }));
  expect(text(renderer!.root)).toContain("20 / 1226 lignes examinées");
  await press("Fermer le fichier");
  expect(p.close).toHaveBeenCalledTimes(1);
  await act(async () => {
    renderer!.unmount();
  });
  renderer = undefined;
  expect(signal.aborted).toBe(true);
  await act(async () => {
    resolve(summary);
  });
  expect(p.analyze).not.toHaveBeenCalled();
  expect(p.publish).not.toHaveBeenCalled();
});

it("reopens a verified file without matching again, but rechecks bytes, publication and catalogue changes", async () => {
  const reviewCache = new MercalysReviewCache();
  await mount({ reviewCache });
  expect(p.validate).toHaveBeenCalledTimes(1);
  await act(async () => renderer!.unmount());
  await mount({ reviewCache });
  expect(p.validate).toHaveBeenCalledTimes(1);
  expect(p.read).toHaveBeenCalledTimes(2);
  expect(p.duplicate).toHaveBeenCalledTimes(2);
  expect(p.analyze).toHaveBeenCalledTimes(2);
  await act(async () => renderer!.unmount());
  p.products = p.products.map((r) => ({
    ...r,
    entity: { ...r.entity, version: 2 },
  }));
  await mount({ reviewCache });
  expect(p.validate).toHaveBeenCalledTimes(1);
  await act(async () => renderer!.unmount());
  p.products = p.products.map((r) => ({
    ...r,
    entity: { ...r.entity, label: "Changed identity" },
  }));
  await mount({ reviewCache });
  expect(p.validate).toHaveBeenCalledTimes(2);
  await act(async () => renderer!.unmount());
  p.digest.mockResolvedValueOnce(new Uint8Array(32).fill(1).buffer);
  await mount({ reviewCache });
  expect(text(renderer!.root)).toContain("L’original conservé a changé");
  expect(p.validate).toHaveBeenCalledTimes(2);
});
it("reports a completed review result without giving it publication authority", async () => {
  const onReviewResult = vi.fn();
  await mount({ onReviewResult });
  expect(onReviewResult).toHaveBeenLastCalledWith(
    expect.objectContaining({ status: "REVIEW", productReviewCount: 1 }),
  );
  expect(p.publish).not.toHaveBeenCalled();
});

it("saves without whole-file refresh, then explicitly finalizes the session", async () => {
  let complete!: () => void;
  const commit = vi
    .spyOn(confirmation, "commitMercalysResolution")
    .mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
  await mount();
  await press("Confirmer le produit");
  const analyzes = p.analyze.mock.calls.length;
  await act(async () => {
    const createProduct = button("Créer comme nouveau produit").props.onPress;
    // Two native events in the same render must not start overlapping writes.
    createProduct();
    createProduct();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(commit).toHaveBeenCalledTimes(1);
  expect(
    text(renderer!.root).match(/Enregistrement des produits… 0\/1/g),
  ).toHaveLength(1);
  await act(async () => {
    complete();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(p.analyze).toHaveBeenCalledTimes(analyzes);
  expect(button("Terminer les confirmations")).toBeDefined();
  expect(button("Appliquer la nouvelle version")).toBeUndefined();
  await press("Terminer les confirmations");
  expect(p.analyze).toHaveBeenCalledTimes(analyzes + 1);
  commit.mockRestore();
});

it("keeps the verified review through a complete route unmount without an injected cache", async () => {
  await mount();
  await act(async () => renderer!.unmount());
  await mount();
  expect(p.validate).toHaveBeenCalledTimes(1);
  expect(p.read).toHaveBeenCalledTimes(2);
  expect(p.duplicate).toHaveBeenCalledTimes(2);
});

it("shows publication failures beside the action, without claiming the original cannot be read", async () => {
  p.analyze.mockResolvedValue(null);
  p.publish.mockRejectedValueOnce(
    Object.assign(new Error("Invalid lineage"), { name: "ZodError" }),
  );
  const initial = await p.validate();
  initial.readyCount = 1;
  initial.productReviewCount = 0;
  initial.lines[0].match = {
    ...initial.lines[0].match,
    state: "AUTO_MATCH",
    matchedProductId: p.products[0]!.entity.id,
  };
  p.validate.mockResolvedValue(initial);
  await mount();
  await press("Publier les lignes valides");
  const content = text(renderer!.root);
  expect(content).toContain("Publication impossible");
  expect(content).not.toContain("Consultation du fichier impossible");
  expect(content).not.toContain("Réessayer la lecture");
  const action = button("Publier les lignes valides");
  // The action and message share the same publication section.
  expect(text(action.parent!)).toContain("Publication impossible");
  expect(p.remove).toHaveBeenCalled();
});

it("chooses a price without changing product identity, and restores the draft after reopening", async () => {
  p.analyze.mockResolvedValue(null);
  const initial = structuredClone(await p.validate());
  initial.sourceType = "MERCALYS_PURCHASE_PRICES";
  initial.lines[0].record.purchasePrice = {
    amount: "2.85",
    sourceActive: true,
    nomenclature: "FRUITS",
  };
  initial.lines[0].match.state = "AUTO_MATCH";
  initial.lines[0].match.matchedProductId = p.products[0]!.entity.id;
  const second = structuredClone(initial.lines[0]);
  second.record.sourceIndex = 31;
  second.record.itm8 = "00000002";
  second.record.purchasePrice.amount = "5.99";
  initial.lines.push(second);
  initial.detectedLineCount = 2;
  p.validate.mockReturnValue(initial);
  const drafts = new Map<string, string>();
  p.sqlite.getFirstAsync.mockImplementation(async (_sql, key) =>
    drafts.has(key) ? { value: drafts.get(key) } : null,
  );
  p.sqlite.runAsync.mockImplementation(async (sql, key, value) => {
    if (
      sql.startsWith("INSERT INTO app_metadata") &&
      key.startsWith("mercalys-price-selection:")
    )
      drafts.set(key, value);
    return { changes: 1 };
  });
  addPriceCodes("00000001", "00000002");
  await mount();
  await press("Voir les références à compléter");
  expect(button("Associer à TOMATE VRAC")).toBeUndefined();
  expect(button("Corriger l’association produit")).toBeDefined();
  const choose = renderer!.root.findAll((n) =>
    n.props.label?.startsWith("Retenir 2,85 € HT"),
  )[0]!;
  await act(async () => {
    choose.props.onPress();
    choose.props.onPress();
    await new Promise((r) => setTimeout(r, 20));
  });
  expect(drafts.size).toBe(1);
  expect(text(renderer!.root)).toContain("Prix retenus pour ce fichier");
  expect(button("Associer à TOMATE VRAC")).toBeUndefined();
  expect(
    p.sqlite.runAsync.mock.calls.filter((c) =>
      String(c[0]).includes("product_identifier"),
    ),
  ).toHaveLength(0);
  await act(async () => renderer!.unmount());
  await mount();
  expect(text(renderer!.root)).toContain("Prix retenus pour ce fichier");
  await press("Ajouter les PA reconnus");
  expect(p.publish).toHaveBeenCalledWith(
    expect.objectContaining({
      summary: expect.objectContaining({
        readyCount: 1,
        productReviewCount: 0,
        purchasePriceSelections: [
          expect.objectContaining({ selectedSourceIndex: 30 }),
        ],
      }),
    }),
  );
});

function addPriceCodes(...values: string[]) {
  p.identifiers = values.map((value, index) => ({
    entity: {
      id: `77777777-7777-4777-8777-${String(index).padStart(12, "0")}`,
      productId: p.products[0]!.entity.id,
      storeId: p.products[0]!.entity.storeId,
      type: "ITM8",
      value,
      status: "VALIDATED",
      deletedAt: null,
    },
    syncState: "SYNCED",
  }));
}
function partialPrices() {
  const summary = structuredClone(
    p.validate(),
  ) as MercalysImportValidationSummary;
  summary.sourceType = "MERCALYS_PURCHASE_PRICES";
  summary.lines[0]!.record.purchasePrice = {
    amount: "2.85",
    sourceActive: true,
    nomenclature: "FRUITS",
  };
  const unknown = structuredClone(summary.lines[0]!);
  unknown.record.sourceIndex = 31;
  unknown.record.itm8 = "00000999";
  unknown.record.rawLabel = "REFERENCE INCONNUE";
  unknown.match = {
    ...unknown.match,
    state: "NO_MATCH",
    matchedProductId: null,
    candidates: [],
  };
  summary.lines[0]!.match = {
    ...summary.lines[0]!.match,
    state: "AUTO_MATCH",
    matchedProductId: String(p.products[0]!.entity.id),
  };
  summary.lines.push(unknown);
  summary.detectedLineCount = 2;
  summary.readyCount = 1;
  summary.productReviewCount = 1;
  addPriceCodes("00000001");
  p.validate.mockReturnValue(summary);
  p.analyze.mockResolvedValue(null);
  return summary;
}
it("adds recognised PA without requiring catalogue completion or waiting for sales computations, then opens remaining references directly", async () => {
  const summary = partialPrices();
  p.publish.mockResolvedValue({
    sourceDocumentId: "new-source",
    publishedCount: 1,
    remainingCount: 1,
    replacedCount: 0,
  });
  await mount();
  expect(button("Ajouter les PA reconnus").props.disabled).toBe(false);
  expect(button("Créer les produits manquants")).toBeUndefined();
  expect(button("Terminer les confirmations")).toBeUndefined();
  await press("Ajouter les PA reconnus");
  expect(p.publish).toHaveBeenCalledTimes(1);
  expect(p.publish.mock.calls[0]![0].summary).toMatchObject({
    readyCount: 1,
    productReviewCount: 1,
  });
  expect(p.recompute).not.toHaveBeenCalled();
  expect(p.sync).toHaveBeenCalledTimes(1);
  expect(text(renderer!.root)).toContain("1 PA ajouté");
  p.continuation.mockResolvedValue({
    sourceDocumentId: "new-source",
    summary,
    publishedCount: 1,
    remainingCount: 1,
    publication: { records: [] },
  });
  const reads = p.read.mock.calls.length;
  await press("Compléter les références restantes");
  expect(p.read).toHaveBeenCalledTimes(reads);
  expect(p.publish).toHaveBeenCalledTimes(1);
  expect(text(renderer!.root)).toContain("REFERENCE INCONNUE");
});
it("retires old PA confirmation markers after a fresh read without imposing a manual finish", async () => {
  partialPrices();
  p.sqlite.getFirstAsync.mockImplementation(async (_sql, key) =>
    String(key).startsWith("mercalys-confirmations:")
      ? { value: "pending" }
      : null,
  );
  await mount();
  expect(
    p.sqlite.runAsync.mock.calls.some(
      (c) =>
        String(c[0]).startsWith("DELETE FROM app_metadata") &&
        String(c[1]).startsWith("mercalys-confirmations:"),
    ),
  ).toBe(true);
  expect(button("Terminer les confirmations")).toBeUndefined();
  await press("Ajouter les PA reconnus");
  expect(p.publish).toHaveBeenCalledTimes(1);
});
it("revalidates PA mappings at addition time and prevents a second native tap from starting another publication", async () => {
  partialPrices();
  await mount();
  // A catalogue pull happened since the preview: the old code is no longer known.
  p.identifiers = [];
  p.publish.mockImplementation(async (input) => {
    if (!input.summary.readyCount)
      throw Error("No validated Mercalys line is ready for publication.");
  });
  await act(async () => {
    const add = button("Ajouter les PA reconnus").props.onPress;
    add();
    add();
    await new Promise((r) => setTimeout(r, 30));
  });
  expect(p.publish).toHaveBeenCalledTimes(1);
  expect(p.publish.mock.calls[0]![0].summary.readyCount).toBe(0);
  expect(text(renderer!.root)).toContain("Publication impossible");
  expect(p.sync).not.toHaveBeenCalled();
  expect(p.recompute).not.toHaveBeenCalled();
});

it("keeps PA addition available after an optional catalogue decision without starting a global confirmation session", async () => {
  partialPrices();
  const commit = vi
    .spyOn(confirmation, "commitMercalysResolution")
    .mockResolvedValue(undefined);
  await mount();
  await press("Voir les références à compléter");
  await press("Créer 1 produit depuis Mercalys");
  expect(commit).toHaveBeenCalledTimes(1);
  expect(
    p.sqlite.runAsync.mock.calls.some(
      (c) =>
        String(c[0]).startsWith("INSERT INTO app_metadata") &&
        String(c[1]).startsWith("mercalys-confirmations:"),
    ),
  ).toBe(false);
  expect(button("Terminer les confirmations")).toBeUndefined();
  expect(button("Ajouter les PA reconnus").props.disabled).toBe(false);
  await press("Ajouter les PA reconnus");
  expect(p.publish).toHaveBeenCalledTimes(1);
});

it("requires a renewed comparison when the PA source overlaps a price added since the preview", async () => {
  const summary = partialPrices();
  const overlap = {
    ...compare({ ...summary, productReviewCount: 0 }),
    sourceType: "MERCALYS_PURCHASE_PRICES" as const,
  };
  p.analyze.mockResolvedValueOnce(null).mockResolvedValue(overlap);
  p.publish.mockRejectedValue(new MercalysOverlapReconciliationError(overlap));
  await mount();
  await press("Ajouter les PA reconnus");
  expect(p.publish.mock.calls[0]![0].reconciliationApproval).toBeUndefined();
  expect(text(renderer!.root)).toContain("La comparaison a changé");
  expect(p.sync).not.toHaveBeenCalled();
  expect(p.recompute).not.toHaveBeenCalled();
});
