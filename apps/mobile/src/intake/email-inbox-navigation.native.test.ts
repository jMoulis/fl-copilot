import { createElement, Fragment, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StackRouter } from "expo-router/build/react-navigation/routers/StackRouter";
import EmailScreen from "../app/email-inbox";
import SettingsScreen from "../app/email-settings";

const runtime = vi.hoisted(() => ({
  manager: true,
  canGoBack: (): boolean => false,
  back: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("expo-router", () => ({
  router: {
    back: runtime.back,
    replace: runtime.replace,
    canGoBack: () => runtime.canGoBack(),
    push: vi.fn(),
  },
  useLocalSearchParams: () => ({
    receiptId: "11111111-1111-4111-8111-111111111111",
  }),
}));
vi.mock("@/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      user: { id: "owner", email: "owner@example.test" },
      stores: [
        { storeId: "store", role: runtime.manager ? "MANAGER" : "VIEWER" },
      ],
    },
  }),
}));
vi.mock("@/sync/sync-provider", () => ({
  useSync: () => ({ emailIntake: {}, lastSyncedAt: "unchanged" }),
}));
vi.mock("@/intake/email-inbox", () => ({ EmailInbox: "EmailInbox" }));
vi.mock("@/components/ui", () => ({
  AppScreen: ({ children }: { children: ReactNode }) =>
    createElement(Fragment, {}, children),
  AppHeader: "Header",
  InlineAlert: "Alert",
  SecondaryButton: "Button",
}));

let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  runtime.manager = true;
  runtime.back.mockReset();
  runtime.replace.mockReset();
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

/** Use the actual Expo stack actions that notification entry and Back dispatch. */
function navigation(initial: string, params?: object) {
  const sdk = StackRouter({ initialRouteName: initial });
  const options = {
    routeNames: [
      "index",
      "(tabs)",
      "email-inbox",
      "email-settings",
      "settings",
    ],
    routeParamList: { [initial]: params },
    routeGetIdList: {},
  };
  let state = sdk.getInitialState(options);
  function apply(
    type: "POP_TO" | "NAVIGATE" | "PUSH" | "REPLACE",
    name: string,
    params?: object,
  ) {
    state = (sdk.getStateForAction(
      state,
      { type, payload: { name, params } },
      options,
    ) ?? state) as typeof state;
  }
  runtime.canGoBack = () => state.index > 0;
  runtime.back.mockImplementation(() => {
    state = (sdk.getStateForAction(state, { type: "GO_BACK" }, options) ??
      state) as typeof state;
  });
  runtime.replace.mockImplementation((href: string) => {
    if (href === "/(tabs)/actions")
      apply("REPLACE", "(tabs)", { screen: "actions" });
    else if (href === "/settings") apply("REPLACE", "settings");
    else throw Error(`Unexpected fallback: ${href}`);
  });
  return { apply, state: () => state };
}
async function render(configuration = false) {
  await act(() => {
    tree = create(createElement(configuration ? SettingsScreen : EmailScreen));
  });
}
async function close() {
  await act(() => {
    if (runtime.manager)
      tree!.root.find((n) => String(n.type) === "EmailInbox").props.onClose();
    else
      tree!.root
        .find((n) => String(n.type) === "Button" && n.props.label === "Retour")
        .props.onPress();
  });
}

it.each([true, false])(
  "can leave an isolated notification inbox, including unavailable access (manager=%s)",
  async (manager) => {
    runtime.manager = manager;
    const nav = navigation("index");
    nav.apply("POP_TO", "email-inbox", {
      receiptId: "11111111-1111-4111-8111-111111111111",
    });
    expect(nav.state().routes.map((r) => r.name)).toEqual(["email-inbox"]);
    await render();
    await close();
    expect(nav.state().routes).toHaveLength(1);
    expect(nav.state().routes[0]).toMatchObject({
      name: "(tabs)",
      params: { screen: "actions" },
    });
    expect(runtime.back).not.toHaveBeenCalled();
  },
);

it.each(["today", "actions", "analytics"])(
  "returns to the original %s tab and its saved context when history exists",
  async (screen) => {
    const nav = navigation("(tabs)", {
      screen,
      selectedDate: "2026-11-15",
      scrollY: 320,
    });
    const origin = nav.state().routes[0]!;
    nav.apply("NAVIGATE", "email-inbox");
    await render();
    await close();
    expect(nav.state().routes).toEqual([origin]);
    expect(runtime.back).toHaveBeenCalledOnce();
    expect(runtime.replace).not.toHaveBeenCalled();
  },
);

it("returns through email settings to the inbox, then to Imports without creating a loop", async () => {
  const nav = navigation("email-inbox");
  nav.apply("PUSH", "email-settings");
  await render(true);
  await close();
  expect(nav.state().routes.map((r) => r.name)).toEqual(["email-inbox"]);
  await act(() => tree!.update(createElement(EmailScreen)));
  await close();
  expect(nav.state().routes).toHaveLength(1);
  expect(nav.state().routes[0]).toMatchObject({
    name: "(tabs)",
    params: { screen: "actions" },
  });
});

it("keeps a direct settings entry escapable through the existing Settings root", async () => {
  const nav = navigation("email-settings");
  await render(true);
  await close();
  expect(nav.state().routes.map((r) => r.name)).toEqual(["settings"]);
});
