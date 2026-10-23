import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocalCopiesPanel } from "./local-copies-panel";
import type { LocalCopyRef, PreparedLocalCopy } from "./local-copy-contracts";
const runtime = vi.hoisted(() => ({
  ownerId: "owner",
  storeId: "store",
  list: vi.fn(),
  create: vi.fn(),
  prepare: vi.fn(),
  logout: vi.fn(),
  restore: vi.fn(),
}));
vi.mock("react-native", () => ({ View: "View", Text: "Text" }));
vi.mock("../components/ui", () => ({
  SectionCard: "Card",
  PrimaryButton: "Button",
  SecondaryButton: "Button",
  InlineAlert: "Alert",
}));
vi.mock("../auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    session: {
      user: { id: runtime.ownerId },
      stores: [{ storeId: runtime.storeId }],
    },
    logout: runtime.logout,
  }),
}));
vi.mock("../providers/database-provider", () => ({
  useDatabaseRestore: () => runtime.restore,
  useLocalDatabase: () => ({ sqlite: {}, deviceId: "device" }),
}));
vi.mock("./local-copies-native", () => ({
  listLocalCopies: runtime.list,
  createLocalCopy: runtime.create,
  prepareLocalCopy: runtime.prepare,
}));
let tree: ReactTestRenderer | undefined;
const copy: LocalCopyRef = {
  kind: "backup",
  id: "copy-id",
  createdAt: "2026-10-24T08:00:00Z",
  location: { version: 1, generation: null, recoveredAt: null },
};
const ready = { pendingCount: 3 } as PreparedLocalCopy;
function button(label: string) {
  return tree!.root
    .findAll((node) => String(node.type) === "Button")
    .find((node) => node.props.label === label)!;
}
async function click(label: string) {
  await act(async () => button(label).props.onPress());
}
async function mount() {
  await act(async () => {
    tree = create(createElement(LocalCopiesPanel));
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      original(...args);
  });
  vi.resetAllMocks();
  runtime.ownerId = "owner";
  runtime.storeId = "store";
  runtime.list.mockResolvedValue([copy]);
  runtime.prepare.mockResolvedValue(ready);
  runtime.logout.mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  tree = undefined;
  vi.unstubAllGlobals();
});
it("reads only after expansion, shows five copies per page and keeps the panel folded during normal sync renders", async () => {
  runtime.list.mockResolvedValue(
    Array.from({ length: 12 }, (_, i) => ({ ...copy, id: `copy-${i}` })),
  );
  await mount();
  expect(runtime.list).not.toHaveBeenCalled();
  await click("Gérer les copies locales");
  expect(runtime.list).toHaveBeenCalledTimes(1);
  expect(
    tree!.root
      .findAll((node) => String(node.type) === "Button")
      .filter((n) => n.props.label === "Vérifier cette copie"),
  ).toHaveLength(5);
  await click("Copies suivantes");
  await click("Copies suivantes");
  expect(
    tree!.root
      .findAll((node) => String(node.type) === "Button")
      .filter((n) => n.props.label === "Vérifier cette copie"),
  ).toHaveLength(2);
  await act(async () => tree!.update(createElement(LocalCopiesPanel)));
  expect(runtime.list).toHaveBeenCalledTimes(1);
});
it("verifies before a separate explicit confirmation and starts canonical logout before handing off to the root", async () => {
  await mount();
  await click("Gérer les copies locales");
  await click("Vérifier cette copie");
  expect(runtime.prepare).toHaveBeenCalledTimes(1);
  expect(runtime.logout).not.toHaveBeenCalled();
  expect(runtime.restore).not.toHaveBeenCalled();
  runtime.restore.mockImplementation(() =>
    expect(runtime.logout).toHaveBeenCalledWith({ localOnly: true }),
  );
  await click("Reprendre cette copie et me déconnecter");
  expect(runtime.restore).toHaveBeenCalledWith(ready, expect.any(Promise));
});
it("keeps working content and allows cancellation after preparation without changing session or active database", async () => {
  await mount();
  await click("Gérer les copies locales");
  await click("Vérifier cette copie");
  await click("Annuler la reprise");
  expect(button("Créer une copie maintenant")).toBeDefined();
  expect(runtime.logout).not.toHaveBeenCalled();
  expect(runtime.restore).not.toHaveBeenCalled();
});
it("rejects callbacks and a late prepared result after an account/store replacement", async () => {
  let release!: (v: PreparedLocalCopy) => void;
  runtime.prepare.mockReturnValue(
    new Promise<PreparedLocalCopy>((r) => {
      release = r;
    }),
  );
  await mount();
  await click("Gérer les copies locales");
  await click("Vérifier cette copie");
  const guard = runtime.prepare.mock.calls[0]![3] as () => void;
  runtime.ownerId = "other";
  await act(async () => tree!.update(createElement(LocalCopiesPanel)));
  expect(guard).toThrow("copie ou la session a changé");
  await act(async () => release(ready));
  expect(runtime.restore).not.toHaveBeenCalled();
  expect(runtime.logout).not.toHaveBeenCalled();
  expect(
    tree!.root
      .findAll((node) => String(node.type) === "Button")
      .some((n) => n.props.label === "Reprendre cette copie et me déconnecter"),
  ).toBe(false);
});
it("shows an actionable error while retaining the known list after a failed backup", async () => {
  runtime.create.mockRejectedValue(
    Error("native path and private diagnostics"),
  );
  await mount();
  await click("Gérer les copies locales");
  await click("Créer une copie maintenant");
  await act(async () => {});
  const alert = tree!.root.find((node) => String(node.type) === "Alert");
  expect(alert.props.message).toContain("espace disponible");
  expect(alert.props.message).not.toContain("private diagnostics");
  expect(button("Vérifier cette copie")).toBeDefined();
});
