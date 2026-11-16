import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { StoreLayoutPanel } from "./layout-panel";
import { StoreLayoutElementSheet } from "./layout-element-sheet";
import { layoutFixture } from "../../../../scripts/test-store-layout-fixtures";

vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  TextInput: "Input",
  Switch: "Switch",
  Pressable: "Pressable",
  Platform: { OS: "ios" },
  BackHandler: { addEventListener: () => ({ remove: vi.fn() }) },
}));
vi.mock("expo-router", () => ({
  Stack: { Screen: "StackScreen" },
  useFocusEffect: (fn: () => void | (() => void)) => useEffect(fn, [fn]),
}));
vi.mock("../components/ui", () => ({
  AppHeader: "Header",
  BottomSheet: "Sheet",
  EmptyState: "Empty",
  InlineAlert: "Alert",
  PrimaryButton: "Button",
  SecondaryButton: "Button",
  SectionCard: "Card",
  StatusBadge: "Status",
}));
vi.mock("./layout-map", () => ({ StoreLayoutMap: "Map" }));
vi.mock("./layout-conflict", () => ({ StoreLayoutConflict: "Conflict" }));
vi.mock("./layout-comparison", () => ({ LayoutComparison: "Comparison" }));
vi.mock("./layout-geometry-report", () => ({
  LayoutGeometryReport: "Geometry",
}));
vi.mock("./layout-inventory-editor", () => ({
  LayoutInventoryForm: "InventoryForm",
  LayoutInventoryControls: "InventoryControls",
}));
vi.mock("./layout-physical-fields", () => ({
  LayoutPhysicalFields: "PhysicalFields",
}));

let tree: ReactTestRenderer | undefined;
const hosts = (type: string) =>
  tree!.root.findAll(
    (node) => typeof node.type === "string" && node.type === type,
  );
const button = (label: string) =>
  hosts("Button").find((node) => node.props.label === label)!;
const sheet = (title: string) =>
  hosts("Sheet").find((node) => node.props.title === title)!;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const log = console.error;
  vi.spyOn(console, "error").mockImplementation((...args) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      log(...args);
  });
});
afterEach(async () => {
  await act(() => tree?.unmount());
  tree = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function panel() {
  const layout = layoutFixture(),
    onAction = vi.fn();
  await act(() => {
    tree = create(
      createElement(StoreLayoutPanel, {
        snapshot: {
          head: {
            entity: layout,
            remote: null,
            remoteVersion: 1,
            syncState: "SYNCED",
          },
          reference: null,
          conflicts: [],
        },
        loaded: true,
        allowed: true,
        busy: false,
        onBack: vi.fn(),
        onInitialize: vi.fn(),
        onAction,
        onConflictResolved: vi.fn(),
        onHistory: vi.fn().mockResolvedValue([]),
        onSync: vi.fn(),
      }),
    );
  });
  await act(() => button("Modifier le plan").props.onPress());
  return { layout, onAction };
}

it("keeps addition mounted through its guarded close, blocks late application and resets the form on reopening", async () => {
  const { layout, onAction } = await panel();
  await act(() =>
    button("Ajouter au plan : îlot, élément, TG ou mobile").props.onPress(),
  );
  const form = hosts("InventoryForm")[0]!,
    apply = form.props.onApply;
  expect(sheet("Ajouter au plan").props.dismissible).toBe(true);
  await act(() => form.props.onDirty());
  expect(sheet("Ajouter au plan").props.dismissible).toBe(false);
  await act(() => sheet("Ajouter au plan").props.onClose());
  expect(sheet("Ajouter au plan").props.visible).toBe(true);
  expect(
    hosts("Alert").some(
      (node) => node.props.title === "Abandonner cet ajout ?",
    ),
  ).toBe(true);
  await act(() => button("Abandonner les champs de cet ajout").props.onPress());
  expect(sheet("Ajouter au plan").props.visible).toBe(false);
  expect(hosts("InventoryForm")[0]!.props.busy).toBe(true);
  expect(apply(layout.content, layout.content.furniture[0]!.id)).toBe(false);
  expect(onAction).not.toHaveBeenCalled();
  await act(() => sheet("Ajouter au plan").props.onDismiss());
  await act(() =>
    button("Ajouter au plan : îlot, élément, TG ou mobile").props.onPress(),
  );
  expect(sheet("Ajouter au plan").props.visible).toBe(true);
  expect(hosts("InventoryForm")[0]).not.toBe(form);
  expect(hosts("InventoryForm")[0]!.props.busy).toBe(false);
  expect(
    hosts("Alert").some(
      (node) => node.props.title === "Abandonner cet ajout ?",
    ),
  ).toBe(false);
  expect(onAction).not.toHaveBeenCalled();
});

it("keeps an element mounted while closing and clears discarded local controls when it reopens", async () => {
  const { layout, onAction } = await panel(),
    furniture = layout.content.furniture[0]!;
  await act(() => hosts("Map")[0]!.props.onSelect(furniture.id));
  const inventory = hosts("InventoryControls")[0]!,
    apply = inventory.props.onApply;
  expect(sheet(furniture.label).props.dismissible).toBe(true);
  await act(() => inventory.props.onDirty());
  expect(sheet(furniture.label).props.dismissible).toBe(false);
  await act(() => sheet(furniture.label).props.onClose());
  expect(sheet(furniture.label).props.visible).toBe(true);
  expect(
    hosts("Alert").some((node) => node.props.title === "Champs non appliqués"),
  ).toBe(true);
  await act(() => button("Fermer sans appliquer ces champs").props.onPress());
  expect(sheet(furniture.label).props.visible).toBe(false);
  expect(hosts("InventoryControls")[0]!.props.busy).toBe(true);
  expect(apply(layout.content)).toBe(false);
  expect(onAction).not.toHaveBeenCalled();
  await act(() => hosts("Map")[0]!.props.onSelect(furniture.id));
  expect(sheet(furniture.label).props.visible).toBe(true);
  expect(hosts("InventoryControls")[0]).not.toBe(inventory);
  expect(
    hosts("Alert").some((node) => node.props.title === "Champs non appliqués"),
  ).toBe(false);
  expect(hosts("InventoryControls")[0]!.props.busy).toBe(false);
  expect(onAction).not.toHaveBeenCalled();
});

it("retains the sheet host rather than returning null after its selected element is removed", async () => {
  const layout = layoutFixture(),
    furniture = layout.content.furniture[0]!;
  const onApply = vi.fn(),
    onClose = vi.fn();
  await act(() => {
    tree = create(
      createElement(StoreLayoutElementSheet, {
        content: layout.content,
        id: furniture.id,
        visible: true,
        editing: true,
        busy: false,
        onApply,
        onClose,
        onSelect: vi.fn(),
      }),
    );
  });
  await act(() => {
    tree!.update(
      createElement(StoreLayoutElementSheet, {
        content: {
          ...layout.content,
          furniture: layout.content.furniture.filter(
            (item) => item.id !== furniture.id,
          ),
        },
        id: furniture.id,
        visible: false,
        editing: true,
        busy: false,
        onApply,
        onClose,
        onSelect: vi.fn(),
      }),
    );
  });
  expect(hosts("Sheet")).toHaveLength(1);
  expect(hosts("Sheet")[0]!.props.visible).toBe(false);
  expect(onApply).not.toHaveBeenCalled();
});
