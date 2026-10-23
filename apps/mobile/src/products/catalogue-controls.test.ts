import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CatalogueList } from "./catalogue-list";
import { initialCatalogueView } from "./catalogue-view";

vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
  TextInput: "TextInput",
  FlatList: ({
    ListHeaderComponent,
    ListEmptyComponent,
  }: {
    ListHeaderComponent: ReactNode;
    ListEmptyComponent: ReactNode;
  }) => createElement("List", null, ListHeaderComponent, ListEmptyComponent),
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
}));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Icon" }));
vi.mock("./product-visual", () => ({ ProductVisual: () => null }));
vi.mock("../components/ui", () => ({
  AppHeader: () => null,
  BottomSheet: () => null,
  EmptyState: () => null,
  InlineAlert: () => null,
  PrimaryButton: () => null,
  SecondaryButton: () => null,
  StatusBadge: () => null,
}));
let rendered: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (String(args[0]).includes("react-test-renderer is deprecated")) return;
    original(...args);
  });
});
afterEach(async () => {
  await act(() => rendered?.unmount());
  rendered = undefined;
  vi.unstubAllGlobals();
});
const view = {
  ...initialCatalogueView,
  query: "00000123",
  category: "FRUIT" as const,
  nature: "PACKAGED" as const,
  state: "PENDING" as const,
  scroll: 350,
};
async function mount() {
  const onChange = vi.fn();
  await act(() => {
    rendered = create(
      createElement(CatalogueList, {
        items: [],
        view,
        onChange,
        onOpen: vi.fn(),
        onAdd: vi.fn(),
        loading: false,
        onRefresh: vi.fn(),
      }),
    );
  });
  return onChange;
}
it("can remove hidden catalogue filters without erasing the literal identifier being searched", async () => {
  const changed = await mount();
  await act(() =>
    rendered!.root
      .findByProps({
        accessibilityLabel: "Effacer les filtres en conservant la recherche",
      })
      .props.onPress(),
  );
  expect(changed).toHaveBeenCalledWith({
    ...initialCatalogueView,
    query: "00000123",
    scroll: 0,
  });
});
it("can clear the search separately while retaining the selected classification and sync-state filters", async () => {
  const changed = await mount();
  await act(() =>
    rendered!.root
      .findByProps({ accessibilityLabel: "Effacer la recherche" })
      .props.onPress(),
  );
  expect(changed).toHaveBeenCalledWith({ ...view, query: "", scroll: 0 });
});
