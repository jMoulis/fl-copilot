import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { weeklyContextFixture } from "../../../../scripts/test-weekly-context-fixtures";
import { journalContextFixture } from "../../../../scripts/test-journal-context-fixtures";
import JournalContextScreen from "./journal-context-screen";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  params: { date: "2026-11-10" },
  back: vi.fn(),
  replace: vi.fn(),
  canGoBack: vi.fn(() => true),
  collect: vi.fn(),
}));
vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
  Linking: { openURL: vi.fn() },
  StyleSheet: { create: (s: unknown) => s },
}));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Icon" }));
vi.mock("@expo/vector-icons/MaterialCommunityIcons", () => ({
  default: "Icon",
}));
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => mocks.params,
  router: {
    back: mocks.back,
    replace: mocks.replace,
    canGoBack: mocks.canGoBack,
  },
}));
vi.mock("../auth/auth-provider", () => ({
  useAuth: () => ({
    session: { user: { id: "owner" }, stores: [{ storeId: "store" }] },
  }),
}));
vi.mock("../store/use-weekly-context", () => ({
  useWeeklyContext: mocks.context,
}));
vi.mock("../components/settings-chrome", () => ({ SettingsHeader: "Header" }));
vi.mock("../components/ui", () => ({
  AppScreen: ({ header, children }: { header: unknown; children: unknown }) =>
    createElement("Screen", {}, header as never, children as never),
  BottomSheet: ({
    visible,
    children,
    ...props
  }: {
    visible: boolean;
    children: unknown;
  }) => (visible ? createElement("Sheet", props, children as never) : null),
  SecondaryButton: "Button",
  InlineAlert: "Alert",
}));
let tree: ReactTestRenderer;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.params.date = "2026-11-10";
  mocks.canGoBack.mockReturnValue(true);
  mocks.back.mockClear();
  mocks.replace.mockClear();
  mocks.collect.mockClear();
  const context = weeklyContextFixture();
  context.journal = journalContextFixture();
  mocks.context.mockReturnValue({
    settings: {
      syncState: "SYNCED",
      entity: { city: "Sélestat", postalCode: "67600" },
    },
    context,
    busy: false,
    error: "Hors connexion : données conservées",
    collect: mocks.collect,
  });
});
afterEach(async () => {
  await act(() => tree?.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const byType = (type: string) =>
  tree.root.findAll((n) => String(n.type) === type);
it("opens every existing detail from the selected archived day even with a refresh error, and returns without replacing Journal", async () => {
  await act(() => {
    tree = create(createElement(JournalContextScreen));
  });
  expect(mocks.context).toHaveBeenLastCalledWith("store", "2026-11-09", true);
  expect(byType("Alert")[0]!.props.message).toContain("données conservées");
  expect(byType("Pressable")).toHaveLength(8);
  const titles = [
    "Météo",
    "Calendrier",
    "Transports à proximité",
    "Travaux et accès",
    "Autour du magasin",
    "Contexte économique",
    "Achats de fruits et légumes",
    "Actualités et déplacements",
  ];
  for (let i = 0; i < 8; i++) {
    await act(() => byType("Pressable")[i]!.props.onPress());
    const sheets = byType("Sheet");
    expect(sheets).toHaveLength(1);
    expect(sheets[0]!.props.title).toBe(titles[i]);
    const buttons = byType("Button").map((n) => n.props.label);
    if (i === 0) expect(buttons).not.toContain("Source · calendrier national");
    if (i === 1) {
      expect(buttons).toContain("Source · calendrier national");
      expect(buttons).not.toContain("Source météo · MET Norway · CC BY 4.0");
    }
    await act(() => sheets[0]!.props.onClose());
    expect(byType("Sheet")).toHaveLength(0);
  }
  await act(() => byType("Pressable")[0]!.props.onPress());
  expect(byType("Sheet")).toHaveLength(1);
  await act(() => byType("Sheet")[0]!.props.onClose());
  await act(() => byType("Header")[0]!.props.onBack());
  expect(mocks.back).toHaveBeenCalledOnce();
  expect(mocks.replace).not.toHaveBeenCalled();
  expect(mocks.collect).not.toHaveBeenCalled();
});
it("keeps the date when returning from a direct link and uses the existing explicit refresh", async () => {
  mocks.canGoBack.mockReturnValue(false);
  await act(() => {
    tree = create(createElement(JournalContextScreen));
  });
  await act(() =>
    byType("Button")
      .find((n) => n.props.label === "Actualiser les repères")!
      .props.onPress(),
  );
  expect(mocks.collect).toHaveBeenCalledOnce();
  await act(() => byType("Header")[0]!.props.onBack());
  expect(mocks.replace).toHaveBeenCalledWith({
    pathname: "/today",
    params: { date: "2026-11-10" },
  });
});
