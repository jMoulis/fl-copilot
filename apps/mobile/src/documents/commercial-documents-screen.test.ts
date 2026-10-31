import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
} from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LocalSourceDocument } from "@fl-copilot/domain";
import type { CommercialReviewPage } from "@fl-copilot/sync-contracts";
import WeekScreen from "../app/(tabs)/week";

const runtime = vi.hoisted(() => ({
  documents: vi.fn(),
  archives: vi.fn(),
  archiveSet: vi.fn(),
  job: vi.fn(),
  jobs: vi.fn(),
  pages: vi.fn(),
  decisions: vi.fn(),
  contextMounts: 0,
  push: vi.fn(),
  db: {},
  picker: { getDocumentAsync: vi.fn() },
  capture: vi.fn(),
}));
const Focus = createContext(true);
const initialSync = () => ({
  status: "syncing",
  pendingCount: 200,
  lastSyncedAt: undefined as string | undefined,
  syncNow: async () => undefined,
});
const Sync = createContext(initialSync());
vi.mock("expo-router", () => ({
  router: { push: runtime.push },
  useIsFocused: () => useContext(Focus),
}));
vi.mock("react-native", () => ({
  Text: "Text",
  View: "View",
  TextInput: "TextInput",
  Pressable: "Pressable",
}));
vi.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: () => runtime.picker,
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "unused" }));
vi.mock("../auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      user: { id: "owner" },
      stores: [{ storeId: "store", role: "MANAGER" }],
    },
  }),
}));
vi.mock("../providers/database-provider", () => ({
  useLocalDatabase: () => ({ sqlite: runtime.db }),
}));
vi.mock("../sync/sync-provider", () => ({ useSync: () => useContext(Sync) }));
vi.mock("./document-archive-repository", () => ({
  DocumentArchiveRepository: class {
    list = runtime.archives;
    set = runtime.archiveSet;
  },
}));
vi.mock("./source-document-repository", () => ({
  SourceDocumentRepository: class {
    listDocuments = runtime.documents;
    commercialPdfUploadJob = runtime.job;
    listCommercialPdfUploadJobs = runtime.jobs;
  },
}));
vi.mock("../commercial/review-repository", () => ({
  CommercialReviewRepository: class {
    pages = runtime.pages;
    decisions = runtime.decisions;
  },
}));
vi.mock("./commercial-pdf-capture", () => ({
  captureCommercialPdf: runtime.capture,
}));
vi.mock("../components/ui", () => ({
  AppScreen: ({ children }: { children: React.ReactNode }) =>
    createElement("Screen", {}, children),
  AppHeader: (props: object) => createElement("Header", props),
  SectionCard: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    title: string;
  }) => createElement("Card", props, children),
  PrimaryButton: (props: object) => createElement("Button", props),
  SecondaryButton: (props: object) => createElement("Button", props),
  InlineAlert: (props: object) => createElement("Alert", props),
  EmptyState: (props: object) => createElement("Empty", props),
}));
vi.mock("../components/dashboard", () => ({
  IconButton: (props: object) => createElement("Button", props),
  SegmentedControl: (props: object) => createElement("Segments", props),
}));
vi.mock("../commercial/original-button", () => ({
  CommercialOriginalButton: (props: object) => createElement("Original", props),
}));
vi.mock("../commercial/analysis-recovery-panel", () => ({
  CommercialAnalysisRecoveryPanel: (props: object) =>
    createElement("Recovery", props),
}));
vi.mock("../commercial/version-decision-list", () => ({
  CommercialVersionDecisionList: () => null,
}));
vi.mock("../commercial/substitute-view", () => ({
  WeeklySubstitutesView: () => null,
}));
vi.mock("../store/weekly-context-view", () => ({
  WeeklyContextView: () => {
    const [draft, setDraft] = useState("");
    useEffect(() => {
      runtime.contextMounts++;
    }, []);
    return createElement("ContextDraft", { value: draft, onChange: setDraft });
  },
}));

function document(index: number): LocalSourceDocument {
  return {
    id: `document-${index}`,
    storeId: "store",
    sourceType: "WEEKLY_COMMERCIAL_PDF",
    originalFilename: `Document ${index}.pdf`,
    localFileUri: "file:///original.pdf",
    checksum: "sha256:test",
    sourceGeneratedAt: null,
    businessPeriodStart: null,
    businessPeriodEnd: null,
    localProcessingStatus: "VALIDATED",
    remoteUploadStatus: "CONFIRMED",
    remoteProcessingStatus: "TO_VALIDATE",
    parserVersion: null,
    extractionModelVersion: null,
    version: 1,
    createdAt: "2026-10-23T08:00:00.000Z",
    updatedAt: "2026-10-23T08:00:00.000Z",
    deletedAt: null,
    syncState: "SYNCED",
    remoteVersion: 1,
    dirty: false,
  };
}
function page(id: string): CommercialReviewPage {
  return {
    id: `page-${id}`,
    storeId: "store",
    sourceDocumentId: id,
    originalFilename: `${id}.pdf`,
    checksum: "sha256:test",
    pageNumber: 1,
    pageCount: 2,
    blocks: [],
    warnings: [],
    issues: [],
    remoteVersion: 1,
  };
}
let renderer: ReactTestRenderer | undefined,
  sync = initialSync();
async function render(focused = true) {
  await act(async () => {
    const tree = createElement(
      Focus.Provider,
      { value: focused },
      createElement(
        Sync.Provider,
        { value: { ...sync } },
        createElement(WeekScreen),
      ),
    );
    if (renderer) renderer.update(tree);
    else renderer = create(tree);
  });
}
function button(label: string) {
  return renderer!.root.findAll(
    (node) => String(node.type) === "Button" && node.props.label === label,
  )[0]!;
}
function nodes(type: string) {
  return renderer!.root.findAll((node) => String(node.type) === type);
}
function text() {
  return JSON.stringify(renderer!.toJSON());
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      original(...args);
  });
  vi.useFakeTimers();
  sync = initialSync();
  runtime.contextMounts = 0;
  runtime.push.mockReset();
  runtime.picker.getDocumentAsync
    .mockReset()
    .mockResolvedValue({ canceled: true });
  runtime.capture.mockReset();
  runtime.archives.mockReset().mockResolvedValue([]);
  runtime.archiveSet.mockReset().mockResolvedValue(true);
  runtime.documents.mockReset().mockResolvedValue([document(1)]);
  runtime.job.mockReset().mockResolvedValue(null);
  runtime.jobs.mockReset().mockResolvedValue({});
  runtime.pages.mockReset().mockResolvedValue([]);
  runtime.decisions.mockReset().mockResolvedValue([]);
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("reads locally on first focus during sync, stays idle for a minute and coalesces 300 progress renders", async () => {
  await render();
  expect(text()).toContain("Document 1.pdf");
  for (let i = 0; i < 300; i++) {
    sync.pendingCount = i;
    await render();
  }
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(runtime.documents).toHaveBeenCalledTimes(1);
  expect(runtime.jobs).toHaveBeenCalledTimes(1);
  expect(runtime.job).not.toHaveBeenCalled();
  sync.status = "idle";
  sync.lastSyncedAt = "2026-10-23T09:00:00Z";
  await render();
  expect(runtime.documents).toHaveBeenCalledTimes(2);
  await render(false);
  sync.lastSyncedAt = "2026-10-23T10:00:00Z";
  await render(false);
  expect(runtime.documents).toHaveBeenCalledTimes(2);
  await render();
  expect(runtime.documents).toHaveBeenCalledTimes(3);
});

it("bounds a 200-document list while search and review-only sources stay reachable, preserving the page on return", async () => {
  runtime.documents.mockResolvedValue(
    Array.from({ length: 200 }, (_, i) =>
      i === 137
        ? { ...document(i), originalFilename: "Pense-bête été 137.pdf" }
        : document(i),
    ),
  );
  runtime.pages.mockResolvedValue([page("document-137"), page("review-only")]);
  await render();
  expect(nodes("Original").length).toBeLessThanOrEqual(12);
  const search = () => nodes("TextInput")[0]!;
  await act(async () => search().props.onChangeText("ete 137"));
  expect(
    renderer!.root
      .findAll((node) => String(node.type) === "Original")
      .map((n) => n.props.sourceDocumentId),
  ).toEqual(["document-137"]);
  await act(async () => button("Voir la synthèse commerciale").props.onPress());
  expect(runtime.push).toHaveBeenLastCalledWith(
    "/commercial-review/document-137",
  );
  await act(async () => search().props.onChangeText("review-only"));
  expect(nodes("Original")[0]!.props.sourceDocumentId).toBe("review-only");
  await act(async () => search().props.onChangeText(""));
  await act(async () => button("Documents suivants").props.onPress());
  const ids = renderer!.root
    .findAll((node) => String(node.type) === "Original")
    .map((n) => n.props.sourceDocumentId);
  await render(false);
  await render();
  expect(
    renderer!.root
      .findAll((node) => String(node.type) === "Original")
      .map((n) => n.props.sourceDocumentId),
  ).toEqual(ids);
});

it("does not mount hidden preparation readers until requested, then keeps their state when folded", async () => {
  await render();
  expect(runtime.contextMounts).toBe(0);
  await act(async () =>
    button("Contexte et préparation de la semaine").props.onPress(),
  );
  expect(runtime.contextMounts).toBe(1);
  await act(async () =>
    renderer!.root
      .findAll((node) => String(node.type) === "ContextDraft")[0]!
      .props.onChange("saisie conservée"),
  );
  await act(async () =>
    button("Masquer le contexte et la préparation").props.onPress(),
  );
  await act(async () =>
    button("Contexte et préparation de la semaine").props.onPress(),
  );
  expect(runtime.contextMounts).toBe(1);
  expect(nodes("ContextDraft")[0]!.props.value).toBe("saisie conservée");
});

it.each([false, true])(
  "reveals the canonical imported source even through a restrictive filter (duplicate=%s)",
  async (duplicate) => {
    const existing = Array.from({ length: 200 }, (_, i) => document(i));
    if (duplicate)
      for (const item of existing) item.originalFilename = "pense_bete.pdf";
    const target = duplicate ? existing[120]! : document(201);
    runtime.documents.mockResolvedValue(existing);
    runtime.pages.mockResolvedValue([page("document-2")]);
    runtime.picker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [
        {
          name: "copie renommée.pdf",
          uri: "file:///selected.pdf",
          mimeType: "application/pdf",
        },
      ],
    });
    runtime.capture.mockImplementation(async () => {
      runtime.documents.mockResolvedValue(
        duplicate ? existing : [target, ...existing],
      );
      return { document: target, duplicate };
    });
    await render();
    await act(async () => nodes("Segments")[0]!.props.onChange("RESULTS"));
    expect(nodes("Original").map((n) => n.props.sourceDocumentId)).toEqual([
      "document-2",
    ]);
    await act(async () => button("Importer un PDF").props.onPress());
    expect(runtime.capture).toHaveBeenCalledTimes(1);
    expect(nodes("Original").map((n) => n.props.sourceDocumentId)).toContain(
      target.id,
    );
    expect(nodes("Segments")[0]!.props.value).toBe("ALL");
    expect(nodes("TextInput")[0]!.props.value).toBe("");
    if (duplicate) expect(text()).toContain("Aucune nouvelle copie");
  },
);

it("keeps the imported-source focus across a superseded read and ignores its late result", async () => {
  const existing = Array.from({ length: 200 }, (_, i) => document(i));
  let finish!: (docs: LocalSourceDocument[]) => void;
  runtime.documents
    .mockResolvedValueOnce(existing)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(existing);
  runtime.capture.mockResolvedValue({
    document: existing[120],
    duplicate: true,
  });
  runtime.picker.getDocumentAsync.mockResolvedValue({
    canceled: false,
    assets: [{ name: "renommé.pdf", uri: "file:///selected.pdf" }],
  });
  await render();
  await act(async () => button("Importer un PDF").props.onPress());
  sync.status = "idle";
  sync.lastSyncedAt = "2026-10-23T11:00:00Z";
  await render();
  expect(nodes("Original").map((n) => n.props.sourceDocumentId)).toContain(
    "document-120",
  );
  await act(async () => {
    finish([]);
  });
  expect(nodes("Original").map((n) => n.props.sourceDocumentId)).toContain(
    "document-120",
  );
});

it("filters received partial results separately from waiting and failed uploads without hiding their original actions", async () => {
  const failed = { ...document(3), remoteUploadStatus: "FAILED" as const };
  runtime.documents.mockResolvedValue([
    document(1),
    document(2),
    failed,
    document(4),
  ]);
  runtime.pages.mockResolvedValue([page("document-2")]);
  runtime.jobs.mockResolvedValue({
    "document-3": { status: "RETRY", last_error: "SOURCE_UPLOAD_NETWORK" },
    "document-4": { status: "RETRY", last_error: "SOURCE_UPLOAD_NETWORK" },
  });
  await render();
  expect(text()).toContain("Résultats reçus");
  const select = async (filter: string) =>
    act(async () => nodes("Segments")[0]!.props.onChange(filter));
  await select("PENDING");
  expect(nodes("Original").map((node) => node.props.sourceDocumentId)).toEqual([
    "document-1",
    "document-4",
  ]);
  await select("RESULTS");
  expect(nodes("Original").map((node) => node.props.sourceDocumentId)).toEqual([
    "document-2",
  ]);
  await select("ATTENTION");
  expect(nodes("Original").map((node) => node.props.sourceDocumentId)).toEqual([
    "document-3",
  ]);
  expect(button("Réessayer l’envoi").props.disabled).toBe(true);
  sync.status = "idle";
  await render();
  expect(button("Réessayer l’envoi").props.disabled).toBe(false);
});

it("retains content after a failed read and provides an explicit local retry", async () => {
  await render();
  runtime.documents.mockRejectedValueOnce(Error("offline local read failed"));
  sync.status = "offline";
  await render();
  expect(text()).toContain("Document 1.pdf");
  expect(text()).toContain("Lecture interrompue");
  await act(async () => button("Relire les documents").props.onPress());
  expect(text()).not.toContain("Lecture interrompue");
});

it("discards a delayed result after blur instead of replacing a newer focused snapshot", async () => {
  let finish!: (docs: LocalSourceDocument[]) => void;
  runtime.documents.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  await render(false);
  await render();
  expect(text()).toContain("Document 1.pdf");
  await act(async () => {
    finish([document(99)]);
  });
  expect(text()).not.toContain("Document 99.pdf");
});

it("archives only the list entry, restores it from Archivés and retains the canonical source link", async () => {
  const d = document(1);
  const entry = {
    id: d.id,
    storeId: "store",
    ownerId: "owner",
    targetKind: "COMMERCIAL_DOCUMENT",
    archived: true,
    version: 1,
    updatedAt: d.updatedAt,
  };
  runtime.documents.mockResolvedValue([d, document(2)]);
  runtime.archives.mockResolvedValue([entry]);
  await render();
  expect(text()).not.toContain("Document 1.pdf");
  expect(text()).toContain("Document 2.pdf");
  await act(async () => nodes("Segments")[0]!.props.onChange("ARCHIVED"));
  expect(text()).toContain("Document 1.pdf");
  expect(text()).not.toContain("Document 2.pdf");
  expect(nodes("Original")[0]?.props.sourceDocumentId).toBe(d.id);
  runtime.archiveSet.mockImplementationOnce(async () => {
    runtime.archives.mockResolvedValue([]);
    return true;
  });
  await act(async () => button("Restaurer").props.onPress());
  expect(runtime.archiveSet).toHaveBeenCalledWith(
    d.id,
    "COMMERCIAL_DOCUMENT",
    false,
    expect.objectContaining({ canWrite: expect.any(Function) }),
  );
  await act(async () => nodes("Segments")[0]!.props.onChange("ALL"));
  expect(text()).toContain("Document 1.pdf");
  expect(runtime.capture).not.toHaveBeenCalled();
});
it("reveals an archived exact duplicate without silently restoring it or creating another source", async () => {
  const d = document(1);
  runtime.documents.mockResolvedValue([d]);
  runtime.archives.mockResolvedValue([
    {
      id: d.id,
      storeId: "store",
      ownerId: "owner",
      targetKind: "COMMERCIAL_DOCUMENT",
      archived: true,
      version: 1,
      updatedAt: d.updatedAt,
    },
  ]);
  runtime.picker.getDocumentAsync.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///same.pdf", name: "same.pdf" }],
  });
  runtime.capture.mockResolvedValue({ document: d, duplicate: true });
  await render();
  await act(async () => button("Importer un PDF").props.onPress());
  expect(nodes("Segments")[0]!.props.value).toBe("ARCHIVED");
  expect(text()).toContain("Document 1.pdf");
  expect(runtime.archiveSet).not.toHaveBeenCalled();
});
