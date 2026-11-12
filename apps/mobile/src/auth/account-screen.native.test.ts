import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AccountScreen from "../app/account";
const runtime = vi.hoisted(() => ({
  status: "authenticated",
  logout: vi.fn(),
  alert: vi.fn(),
}));
vi.mock("expo-constants", () => ({
  default: { expoConfig: { version: "0.1.0" } },
}));
vi.mock("react-native", () => ({
  Text: "Text",
  Alert: { alert: runtime.alert },
}));
vi.mock("expo-router", () => ({
  Redirect: "Redirect",
  router: { canGoBack: () => true, back: vi.fn() },
}));
vi.mock("./auth-provider", () => ({
  useAuth: () => ({
    status: runtime.status,
    session:
      runtime.status === "authenticated"
        ? { user: { email: "owner@example.test" } }
        : undefined,
    logout: runtime.logout,
  }),
}));
vi.mock("../components/ui", () => ({
  AppScreen: "Screen",
  AppHeader: "Header",
  SectionCard: "Card",
  SecondaryButton: "Button",
}));
let rendered: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  runtime.status = "authenticated";
  runtime.logout.mockReset();
  runtime.alert.mockReset();
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      original(...args);
  });
});
afterEach(async () => {
  await act(() => rendered?.unmount());
  rendered = undefined;
  vi.unstubAllGlobals();
});
async function render() {
  await act(() => {
    const node = createElement(AccountScreen);
    if (rendered) rendered.update(node);
    else rendered = create(node);
  });
}
it("confirms logout then replaces the account view with login when the session retires", async () => {
  await render();
  const button = rendered!.root
    .findAllByType("Button" as never)
    .find((node) => node.props.label === "Se déconnecter")!;
  await act(() => button.props.onPress());
  expect(runtime.logout).not.toHaveBeenCalled();
  const choices = runtime.alert.mock.lastCall![2] as {
    text: string;
    onPress?: () => void;
  }[];
  await act(() =>
    choices.find((choice) => choice.text === "Se déconnecter")!.onPress!(),
  );
  expect(runtime.logout).toHaveBeenCalledOnce();
  runtime.status = "anonymous";
  await render();
  expect(rendered!.root.findByType("Redirect" as never).props.href).toBe(
    "/login",
  );
  expect(rendered!.root.findAllByType("Card" as never)).toHaveLength(0);
});
it("does not show account data while the session is being restored", async () => {
  runtime.status = "loading";
  await render();
  expect(rendered!.toJSON()).toBeNull();
});
