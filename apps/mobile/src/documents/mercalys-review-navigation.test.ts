import { createElement, type ReactNode, type ElementType } from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MercalysReconciliationReview } from "./mercalys-reconciliation-review";
import { MercalysBatchPanel } from "./mercalys-batch-panel";
import type {
  MercalysReconciliation,
  MercalysReconciliationRow,
} from "./mercalys-import-reconciliation";
import type { MercalysBatchInput, MercalysBatchItem } from "@fl-copilot/domain";
import type { ComponentProps } from "react";

const ports = vi.hoisted(() => ({
  recent: vi.fn(),
  page: vi.fn(),
  get: vi.fn(),
  refresh: vi.fn(),
  publications: vi.fn(),
  archives: vi.fn(),
  prepare: vi.fn(),
  preview: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("react-native", () => ({
  Text: "Text",
  View: "View",
  TextInput: "TextInput",
  Pressable: "Pressable",
  Platform: { OS: "ios" },
  Modal: ({
    visible,
    children,
    ...props
  }: {
    visible: boolean;
    children: ReactNode;
  }) =>
    visible ? createElement("Modal", { ...props, visible }, children) : null,
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
vi.mock("expo-crypto", () => ({
  randomUUID: () => "new-id",
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
  digest: vi.fn(),
  digestStringAsync: vi.fn(),
}));
vi.mock("expo-file-system", () => ({ File: class {} }));
vi.mock("../observability/sentry", () => ({
  captureLocalOperationFailure: vi.fn(),
}));
vi.mock("./mercalys-zip-capture", () => ({
  retainMercalysZip: vi.fn(),
  extractRetainedMercalysZip: vi.fn(),
  nativeMercalysZipStorage: {},
}));
vi.mock("./mercalys-batch-capture", () => ({
  captureMercalysBatch: vi.fn(),
  nativeMercalysBatchStorage: {},
}));
vi.mock("../products/product-master-repository", () => ({
  ProductMasterRepository: class {},
}));
vi.mock("./mercalys-import-publication", () => ({
  MercalysImportPublicationRepository: class {},
}));
vi.mock("./mercalys-batch-preparation", () => ({
  MercalysBatchPreparation: class {
    prepare = ports.prepare;
  },
}));
vi.mock("./mercalys-batch-publication", () => ({
  MercalysBatchPublication: class {
    preview = ports.preview;
    confirm = ports.confirm;
  },
}));
vi.mock("./mercalys-archive-repository", () => ({
  MercalysArchiveRepository: class {
    recent = ports.archives;
  },
}));
vi.mock("./mercalys-batch-repository", () => ({
  MercalysBatchRepository: class {
    recent = ports.recent;
    page = ports.page;
    get = ports.get;
    refresh = ports.refresh;
    publications = ports.publications;
    retainedLocation = async () => "file:///retained/21102026.xlsx";
  },
}));
let renderer: ReactTestRenderer | undefined;
function text(node: ReactTestInstance): string {
  return node.children
    .map((n) => (typeof n === "string" ? n : text(n)))
    .join(" ")
    .replace(/\s+/g, " ");
}
function button(label: string) {
  return renderer!.root
    .findAll(
      (n) => n.props.label === label || n.props.accessibilityLabel === label,
    )
    .find((n) => typeof n.props.onPress === "function")!;
}
async function press(label: string) {
  await act(async () => {
    const b = button(label);
    expect(b, label).toBeDefined();
    expect(b.props.disabled).not.toBe(true);
    b.props.onPress();
  });
}
const values = {
  quantity: "2",
  salesValue: "12.40",
  purchaseValue: "8",
  marginValue: "4.4",
  rceValue: "0",
  vatValue: null,
  marginRate: null,
};
function row(index: number, ambiguous = false): MercalysReconciliationRow {
  return {
    key: `row-${index}`,
    productId: ambiguous ? null : `p-${index}`,
    productLabel: `ARTICLE ${index}`,
    businessDate: "2026-10-21",
    incomingSourceIndex: index,
    incomingRecord: null,
    category: ambiguous ? "AMBIGUOUS" : "MODIFIED",
    reason: ambiguous ? "UNRESOLVED_PRODUCT" : null,
    existingObservationIds: [],
    existingSourceRecordIds: [],
    existingValues: values,
    incomingValues: { ...values, salesValue: "15.75" },
  };
}
function comparison(ambiguous = true): MercalysReconciliation {
  return {
    sourceType: "MERCALYS_SALES",
    businessPeriodStart: "2026-10-21",
    businessPeriodEnd: "2026-10-21",
    priorSourceDocumentIds: ["old-source"],
    counts: {
      UNCHANGED: 0,
      MODIFIED: 45,
      ADDED: 0,
      REMOVED: 0,
      AMBIGUOUS: ambiguous ? 1 : 0,
    },
    safeToApply: !ambiguous,
    fingerprint: "current-fingerprint",
    rows: [
      ...Array.from({ length: 45 }, (_, n) => row(n)),
      ...(ambiguous ? [row(99, true)] : []),
    ],
  };
}
function review(
  patch: Partial<ComponentProps<typeof MercalysReconciliationReview>> = {},
) {
  return createElement(MercalysReconciliationReview, {
    reconciliation: comparison(),
    keptExisting: false,
    loading: false,
    onApply: vi.fn(),
    onKeep: vi.fn(),
    onCancel: vi.fn(),
    onReviewProducts: vi.fn(),
    ...patch,
  });
}
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
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
it("puts the ambiguous line beyond the old 20-row cutoff first and links directly to its product resolution", async () => {
  const resolve = vi.fn();
  await act(async () => {
    renderer = create(review({ onReviewProducts: resolve }));
  });
  expect(text(renderer!.root)).toContain("ARTICLE 99");
  expect(text(renderer!.root)).not.toContain("ARTICLE 0");
  expect(button("Appliquer la nouvelle version").props.disabled).toBe(true);
  await press("Confirmer le produit");
  expect(resolve).toHaveBeenCalledExactlyOnceWith(99);
});
it("exposes every difference through bounded pages and search, including monetary-only changes and zero versus missing", async () => {
  const r = comparison(false);
  r.rows[0]!.incomingValues!.quantity = "0";
  await act(async () => {
    renderer = create(review({ reconciliation: r }));
  });
  expect(text(renderer!.root)).toContain("Vente (€) : 12,4 → 15,75");
  expect(text(renderer!.root)).toContain("Quantité : 2 → 0");
  expect(text(renderer!.root)).not.toContain("ARTICLE 44");
  await press("Lignes suivantes");
  await press("Lignes suivantes");
  expect(text(renderer!.root)).toContain("ARTICLE 44");
  expect(button("Lignes suivantes").props.disabled).toBe(true);
  const input = renderer!.root.findByProps({
    accessibilityLabel: "Rechercher une ligne par produit ou code",
  });
  await act(async () => input.props.onChangeText("ARTICLE 0"));
  expect(text(renderer!.root)).toContain("1–1 sur 1 ligne");
});
it("refreshes the decision against the current reconciliation and preserves explicit apply/keep without automatic publication", async () => {
  const apply = vi.fn(),
    keep = vi.fn();
  await act(async () => {
    renderer = create(review({ onApply: apply, onKeep: keep }));
  });
  expect(apply).not.toHaveBeenCalled();
  await act(async () =>
    renderer!.update(
      review({
        reconciliation: comparison(false),
        onApply: apply,
        onKeep: keep,
      }),
    ),
  );
  await press("Appliquer la nouvelle version");
  expect(apply).toHaveBeenCalledTimes(1);
  await press("Conserver l’existant");
  expect(keep).toHaveBeenCalledTimes(1);
});
it("explains different ambiguity causes and parser issues without enabling an unsafe replacement", async () => {
  const r = comparison();
  r.rows = [
    { ...row(1, true), reason: "MULTIPLE_INCOMING_ROWS" },
    { ...row(2, true), reason: "MULTIPLE_EXISTING_ROWS" },
    { ...row(3, true), reason: "UNRESOLVED_ROW_ON_DATE" },
  ];
  await act(async () => {
    renderer = create(
      review({ reconciliation: r, validationMessages: ["Date invalide"] }),
    );
  });
  expect(text(renderer!.root)).toContain(
    "ne seront pas additionnées automatiquement",
  );
  expect(text(renderer!.root)).toContain("Plusieurs observations existantes");
  expect(text(renderer!.root)).toContain("Date invalide");
  expect(button("Appliquer la nouvelle version").props.disabled).toBe(true);
});
const at = "2026-10-23T10:00:00.000Z";
function batchFixture() {
  const items = Array.from({ length: 40 }, (_, n): MercalysBatchItem => ({
    id: `item-${n}`,
    batchId: "batch",
    filename: n === 25 ? "21102026.xlsx" : `export-${n}.xlsx`,
    localUri: `file:///retained/${n}.xlsx`,
    checksum: `sha256:${"a".repeat(64)}`,
    sizeBytes: 1,
    position: n,
    version: 1,
    updatedAt: at,
    result: {
      status: "REVIEW",
      sourceType: "MERCALYS_SALES",
      parserVersion: "v1",
      businessPeriodStart: "2026-10-21",
      businessPeriodEnd: "2026-10-21",
      readyCount: 140,
      productReviewCount: 1,
      errorCount: 0,
      overlap: true,
    },
  }));
  const batch = {
    id: "batch",
    storeId: "store",
    ownerId: "owner",
    conversationId: null,
    archiveId: "archive",
    createdAt: at,
    files: items,
  } satisfies MercalysBatchInput;
  ports.recent.mockResolvedValue({ batches: [batch], hasMore: false });
  ports.archives.mockResolvedValue({
    archives: [
      {
        id: "archive",
        filename: "21102026.zip",
        createdAt: at,
        batchId: "batch",
        outcome: {
          status: "PROCESSED",
          retainedCount: 40,
          failures: [],
          ignored: [],
        },
      },
    ],
    hasMore: false,
  });
  ports.page.mockImplementation(async (_id, after: number) => ({
    items: after < 0 ? items.slice(0, 20) : items.slice(20),
    hasMore: after < 0,
  }));
  ports.publications.mockResolvedValue([]);
  ports.get.mockImplementation(async (_batch, id) =>
    items.find((i) => i.id === id),
  );
  ports.prepare.mockImplementation(async (_batch, id) =>
    items.find((i) => i.id === id),
  );
  return items;
}
let fileBusy: ((busy: boolean) => void) | undefined;
function panel() {
  return createElement(MercalysBatchPanel, {
    db: {} as ComponentProps<typeof MercalysBatchPanel>["db"],
    storeId: "store",
    ownerId: "owner",
    pick: vi.fn(),
    renderReview: (asset, close, reportBusy, changed) => {
      fileBusy = reportBusy;
      return createElement(
        "FileReview",
        { asset, close, changed },
        "Examen de " + asset.name,
      );
    },
  });
}
async function openBatch() {
  const archive = renderer!.root.findAll(
    (n) =>
      n.props.accessibilityLabel?.startsWith("Ouvrir 21102026.zip") &&
      typeof n.props.onPress === "function",
  )[0]!;
  await act(async () => archive.props.onPress());
}
it("keeps archives and batch files on separate levels, labels the import date, and retains the loaded list when a review closes", async () => {
  batchFixture();
  await act(async () => {
    renderer = create(panel());
  });
  expect(text(renderer!.root)).toContain("21102026.zip");
  expect(text(renderer!.root)).toContain("23/10/2026");
  expect(
    renderer!.root.findAllByProps({
      accessibilityLabel: "Rechercher un fichier du lot par nom",
    }),
  ).toHaveLength(0);
  await openBatch();
  await press("Afficher les fichiers suivants");
  const input = renderer!.root.findByProps({
    accessibilityLabel: "Rechercher un fichier du lot par nom",
  });
  await act(async () => input.props.onChangeText("21102026"));
  const batchModal = renderer!.root.findByType("Modal" as ElementType);
  await press("Ouvrir le fichier 21102026.xlsx");
  const file = renderer!.root.findByType("FileReview" as ElementType);
  expect(file.props.asset.expectedChecksum).toMatch(/^sha256:/);
  const nestedModal = file.parent!;
  expect(nestedModal.type).toBe("Modal");
  let ancestor: ReactTestInstance | null = nestedModal;
  while (ancestor && ancestor !== batchModal) ancestor = ancestor.parent;
  expect(ancestor === batchModal).toBe(true);
  const dismiss = nestedModal.props.onDismiss;
  await act(async () => file.props.close());
  await act(async () => dismiss());
  expect(ports.refresh).not.toHaveBeenCalled();
  expect(ports.prepare).not.toHaveBeenCalled();
  expect(ports.page).toHaveBeenCalledTimes(2);
  expect(input.props.value).toBe("21102026");
  expect(text(renderer!.root)).toContain("1 sur 40 fichiers chargés");
  expect(ports.confirm).not.toHaveBeenCalled();
});
it("allows opening retained failed files and protects dismissal during a file mutation", async () => {
  const items = batchFixture();
  items[0]!.result = {
    status: "FAILED",
    code: "MERCALYS_BATCH_PREPARATION_FAILED",
  };
  await act(async () => {
    renderer = create(panel());
  });
  await openBatch();
  await press("Ouvrir le fichier export-0.xlsx");
  await act(async () => fileBusy!(true));
  const fileModal = renderer!.root
    .findAllByType("Modal" as ElementType)
    .at(-1)!;
  expect(fileModal.props.allowSwipeDismissal).toBe(false);
  await act(async () => fileModal.props.onRequestClose());
  expect(
    renderer!.root.findAllByType("FileReview" as ElementType),
  ).toHaveLength(1);
  await act(async () => fileBusy!(false));
  const dismiss = fileModal.props.onDismiss;
  await act(async () =>
    renderer!.root.findByType("FileReview" as ElementType).props.close(),
  );
  await act(async () => dismiss());
  expect(ports.prepare).not.toHaveBeenCalled();
});
it("does not mutate a batch after its owner-scoped review is unmounted", async () => {
  batchFixture();
  await act(async () => {
    renderer = create(panel());
  });
  await openBatch();
  await press("Ouvrir le fichier export-0.xlsx");
  await act(async () => renderer!.unmount());
  renderer = undefined;
  expect(ports.refresh).not.toHaveBeenCalled();
});

it("retains extraction failures under batch actions and the archive timestamp when older batch headers are not loaded", async () => {
  batchFixture();
  ports.recent.mockResolvedValue({ batches: [], hasMore: true });
  ports.archives.mockResolvedValue({
    archives: [
      {
        id: "archive",
        filename: "21102026.zip",
        createdAt: at,
        batchId: "batch",
        outcome: {
          status: "PROCESSED",
          retainedCount: 40,
          failures: [
            { path: "Ventes/fichier-absent.xlsx", code: "EXTRACTION_FAILED" },
          ],
          ignored: ["__MACOSX/system"],
        },
      },
    ],
    hasMore: false,
  });
  await act(async () => {
    renderer = create(panel());
  });
  expect(text(renderer!.root)).not.toContain("Ventes/fichier-absent.xlsx");
  await openBatch();
  const header = renderer!.root.findAll(
    (n) => n.type === ("UI" as ElementType) && n.props.title === "21102026.zip",
  )[0]!;
  expect(header.props.subtitle).toContain("40 fichiers");
  expect(header.props.subtitle).toContain("23/10/2026");
  await press("Actions du lot");
  expect(text(renderer!.root)).toContain("Ventes/fichier-absent.xlsx");
  expect(text(renderer!.root)).toContain("fichiers système ignorés");
});

it("reprepares only the changed file after a committed mapping/publication, once the sheet is dismissed", async () => {
  batchFixture();
  await act(async () => {
    renderer = create(panel());
  });
  await openBatch();
  await press("Ouvrir le fichier export-0.xlsx");
  const file = renderer!.root.findByType("FileReview" as ElementType);
  const dismiss = file.parent!.props.onDismiss;
  await act(async () => file.props.changed());
  expect(ports.refresh).not.toHaveBeenCalled();
  await act(async () => file.props.close());
  await act(async () => dismiss());
  expect(ports.refresh).toHaveBeenCalledExactlyOnceWith("batch", "item-0", 1);
  expect(ports.prepare).toHaveBeenCalledExactlyOnceWith(
    "batch",
    "item-0",
    expect.any(AbortSignal),
  );
});
