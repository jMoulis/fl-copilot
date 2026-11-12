import {
  createElement,
  Fragment,
  useEffect,
  type ReactElement,
  type ReactNode,
} from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MainHeader } from "./main-header";
import TabLayout from "../app/(tabs)/_layout";
import ImportsHub from "../app/(tabs)/actions";
import JournalScreen from "../app/(tabs)/today";
const runtime = vi.hoisted(() => ({ push: vi.fn(), sqlite: {} }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "test-id" }));
vi.mock("../providers/database-provider", () => ({
  useLocalDatabase: () => ({ sqlite: runtime.sqlite, deviceId: "test-device" }),
}));
vi.mock("../journal/journal-observations", () => ({
  journalObservations: async () => [],
}));
vi.mock("../store/use-weekly-context", () => ({
  useWeeklyContext: () => ({
    settings: null,
    context: null,
    busy: false,
    refresh: async () => {},
  }),
}));
vi.mock("../journal/journal-weather", () => ({
  JournalWeather: (props: object) => createElement("Weather", props),
}));
vi.mock("react-native", () => ({
  Text: "Text",
  View: "View",
  Pressable: "Pressable",
  useWindowDimensions: () => ({ fontScale: 1 }),
}));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Icon" }));
vi.mock("expo-router", () => ({
  router: { push: runtime.push },
  useFocusEffect: (callback: () => void | (() => void)) =>
    useEffect(callback, [callback]),
  Redirect: "Redirect",
  Tabs: Object.assign(
    ({ children }: { children: ReactNode }) =>
      createElement("Tabs", {}, children),
    { Screen: (props: object) => createElement("TabScreen", props) },
  ),
}));
vi.mock("../auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    session: { user: { id: "owner" }, stores: [{ storeId: "store" }] },
  }),
}));
vi.mock("../sync/sync-provider", () => ({
  useSync: () => ({ status: "synced", pendingCount: 0 }),
}));
vi.mock("./ui", () => ({
  AppScreen: ({
    header,
    children,
  }: {
    header?: ReactNode;
    children: ReactNode;
  }) => createElement(Fragment, {}, header, children),
  MenuRow: "MenuRow",
  PrimaryButton: "Button",
  SecondaryButton: "Button",
  BottomSheet: ({
    visible,
    children,
    ...props
  }: {
    visible: boolean;
    children: ReactNode;
  }) => (visible ? createElement("Sheet", props, children) : null),
}));
let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  runtime.push.mockReset();
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      original(...args);
  });
});
afterEach(async () => {
  await act(() => tree?.unmount());
  tree = undefined;
  vi.unstubAllGlobals();
});
async function mount(component: ReactElement) {
  await act(() => {
    tree = create(component);
  });
}
function menu(title: string) {
  return tree!.root.find(
    (n) => String(n.type) === "MenuRow" && n.props.title === title,
  );
}
it("exposes exactly the four agreed primary tabs while keeping the catalogue off the bottom bar", async () => {
  await mount(createElement(TabLayout));
  const visible = tree!.root.findAll(
    (n) => String(n.type) === "TabScreen" && n.props.options.href !== null,
  );
  expect(visible.map((n) => n.props.options.title)).toEqual([
    "Journal",
    "Analyses",
    "Copilote",
    "Imports",
  ]);
});
it.each(["Journal", "Analyses", "Copilote", "Imports"])(
  "opens catalogue and settings from the same header on %s without a logout shortcut",
  async (title) => {
    await mount(createElement(MainHeader, { title }));
    const buttons = tree!.root.findAll((n) => String(n.type) === "Pressable");
    expect(buttons).toHaveLength(2);
    await act(() => buttons[0].props.onPress());
    expect(runtime.push).toHaveBeenLastCalledWith("/catalogue");
    await act(() => buttons[1].props.onPress());
    expect(runtime.push).toHaveBeenLastCalledWith("/settings");
  },
);
it("keeps four direct intake destinations and routes the shared file chooser into the existing workflows", async () => {
  await mount(createElement(ImportsHub));
  for (const [title, path] of [
    ["Mercalys", "/mercalys-imports"],
    ["Casse", "/waste-tickets"],
    ["Documents commerciaux", "/commercial-documents"],
    ["Emails reçus", "/email-inbox"],
  ]) {
    await act(() => menu(title).props.onPress());
    expect(runtime.push).toHaveBeenLastCalledWith(path);
  }
  expect(tree!.root.findAll((n) => String(n.type) === "MenuRow")).toHaveLength(
    4,
  );
  await act(() =>
    tree!.root
      .find(
        (n) =>
          String(n.type) === "Button" &&
          n.props.label === "Importer un fichier",
      )
      .props.onPress(),
  );
  expect(tree!.root.findAll((n) => String(n.type) === "Sheet")).toHaveLength(1);
  await act(() => menu("Ventes Mercalys").props.onPress());
  expect(runtime.push).toHaveBeenLastCalledWith("/mercalys-imports");
  expect(tree!.root.findAll((n) => String(n.type) === "Sheet")).toHaveLength(0);
});
it("retains the selected Journal week and reuses existing observation capture", async () => {
  await mount(createElement(JournalScreen));
  await act(() => menu("Ma semaine").props.onPress());
  expect(runtime.push).toHaveBeenLastCalledWith(
    expect.objectContaining({ pathname: "/my-week" }),
  );
  await act(() => menu("Historique des observations").props.onPress());
  expect(runtime.push).toHaveBeenLastCalledWith("/store-events");
  await act(() =>
    tree!.root
      .find(
        (n) =>
          String(n.type) === "Button" &&
          n.props.label === "Noter une observation produit",
      )
      .props.onPress(),
  );
  expect(runtime.push).toHaveBeenLastCalledWith(
    expect.objectContaining({
      pathname: "/store-event",
      params: { date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
    }),
  );
});
