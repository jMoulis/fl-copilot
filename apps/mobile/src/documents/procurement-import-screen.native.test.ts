import { createElement, useEffect, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { procurementLinksFixture } from "../../../../scripts/test-procurement-links-fixtures";
import { procurementHash } from "../../../../scripts/test-procurement-publication-fixtures";
import { ProcurementImportScreen } from "./procurement-import-screen";
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  storeId: "",
  ownerId: "",
  files: new Map<string, Uint8Array>(),
  push: vi.fn(),
  back: vi.fn(),
  syncNow: vi.fn(async () => {}),
}));
vi.mock("react-native", () => ({
  Text: "Text",
  View: "View",
  Pressable: "Pressable",
  TextInput: "Input",
}));
vi.mock("expo-router", () => ({
  useFocusEffect: (cb: () => void | (() => void)) => useEffect(cb, [cb]),
  router: {
    push: state.push,
    back: state.back,
    replace: state.push,
    canGoBack: () => true,
  },
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => randomUUID() }));
vi.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: () => null,
}));
vi.mock("../components/ui", () => ({
  AppScreen: ({
    children,
    header,
    footer,
  }: {
    children: ReactNode;
    header: ReactNode;
    footer: ReactNode;
  }) => createElement("Screen", null, header, children, footer),
  BottomSheet: ({
    children,
    visible,
    ...props
  }: {
    children: ReactNode;
    visible: boolean;
  }) =>
    createElement("Sheet", { ...props, visible }, visible ? children : null),
  PrimaryButton: "Button",
  SecondaryButton: "Button",
  InlineAlert: "Alert",
}));
vi.mock("../components/dashboard", () => ({ IconButton: "Button" }));
vi.mock("./imports-presentation", () => ({
  ImportDocumentRow: "Row",
  ImportScreenHeader: ({ action, ...props }: { action?: ReactNode }) =>
    createElement("Header", props, action),
}));
vi.mock("./source-original-button", () => ({ SourceOriginalButton: "Source" }));
vi.mock("./procurement-native-originals", () => ({
  retainProcurementJson: vi.fn(),
  procurementNativeOriginals: {
    sha256: procurementHash,
    read: async (uri: string) => {
      const b = state.files.get(uri);
      if (!b) throw Error("MISSING");
      return b;
    },
  },
}));
vi.mock("../auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      user: { id: state.ownerId },
      stores: [{ storeId: state.storeId, role: "MANAGER" }],
    },
  }),
}));
vi.mock("../providers/database-provider", () => ({
  useLocalDatabase: () => ({ sqlite: state.db, deviceId: state.storeId }),
}));
vi.mock("../sync/sync-provider", () => ({
  useSync: () => ({ lastSyncedAt: null, syncNow: state.syncNow }),
}));
vi.mock("../sync/outbox-repository", async (original) => ({
  ...(await original<object>()),
  subscribeOutboxChanges: () => () => {},
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let tree: ReactTestRenderer | undefined, dispose: (() => void) | undefined;
afterEach(async () => {
  if (tree) await act(() => tree!.unmount());
  tree = undefined;
  dispose?.();
  state.files.clear();
  vi.clearAllMocks();
});
const button = (label: string) =>
  tree!.root.find(
    (n) => String(n.type) === "Button" && n.props.label === label,
  );
it("reopens a retained draft, defers navigation until sheet dismissal and confirms exactly once without Product creation", async () => {
  const f = await procurementLinksFixture();
  dispose = () => f.device.raw.close();
  f.device.raw
    .prepare(
      "UPDATE source_documents SET parser_version='mercalys-article-reference.v1',local_processing_status='PUBLISHED' WHERE id=?",
    )
    .run(f.referenceId);
  f.device.raw.exec(
    "DELETE FROM procurement_catalogue_snapshots; DELETE FROM sync_outbox; DELETE FROM local_jobs;",
  );
  state.db = f.device;
  state.storeId = f.product.storeId;
  state.ownerId = f.ownerId;
  state.files.set(f.input.localUri, f.bytes);
  state.files.set("file:///reference.xlsx", f.referenceBytes);
  await act(async () => {
    tree = create(createElement(ProcurementImportScreen));
  });
  const reopen = async () => {
    await act(async () =>
      tree!.root.find((n) => String(n.type) === "Row").props.onPress(),
    );
  };
  await reopen();
  expect(button("Confirmer les 1 correspondances").props.disabled).toBe(false);
  await act(() => button("Choisir le référentiel").props.onPress());
  await act(() => button("Importer un référentiel Mercalys").props.onPress());
  expect(state.push).not.toHaveBeenCalled();
  await act(() =>
    tree!.root.find((n) => String(n.type) === "Sheet").props.onDismiss(),
  );
  expect(state.push).toHaveBeenCalledWith("/mercalys-imports");
  await act(async () =>
    button("Confirmer les 1 correspondances").props.onPress(),
  );
  expect(f.device.raw.prepare("SELECT COUNT(*) n FROM products").get()).toEqual(
    { n: 1 },
  );
  expect(
    f.device.raw
      .prepare("SELECT COUNT(*) n FROM procurement_product_links")
      .get(),
  ).toEqual({ n: 1 });
  expect(
    f.device.raw.prepare("SELECT COUNT(*) n FROM sync_outbox").get(),
  ).toEqual({ n: 2 });
  await act(async () => button("Enregistrer les offres").props.onPress());
  expect(
    f.device.raw.prepare("SELECT COUNT(*) n FROM sync_outbox").get(),
  ).toEqual({ n: 2 });
  await act(() =>
    tree!.root.find((n) => String(n.type) === "Header").props.onClose(),
  );
  await reopen();
  expect(JSON.stringify(tree!.toJSON())).toContain("correspondance");
});
