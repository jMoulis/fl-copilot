import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { weeklyContextFixture } from "../../../../scripts/test-weekly-context-fixtures";
import { observedWeatherContextFixture } from "../../../../scripts/test-observed-weather-fixtures";
import { JournalWeather } from "./journal-weather";
const openURL = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
  Linking: { openURL },
  StyleSheet: { create: (s: unknown) => s },
}));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Icon" }));
vi.mock("../components/ui", () => ({
  BottomSheet: ({
    visible,
    children,
  }: {
    visible: boolean;
    children: unknown;
  }) => (visible ? createElement("Sheet", {}, children as never) : null),
  SecondaryButton: "Button",
  InlineAlert: "Alert",
}));
let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-09T08:30:00Z"));
  openURL.mockClear();
});
afterEach(async () => {
  await act(() => tree?.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const text = () =>
  tree!.root
    .findAll((n) => String(n.type) === "Text")
    .map((n) => n.children.filter((x) => typeof x === "string").join(""))
    .join(" ");
async function mount(observed = true) {
  const context = weeklyContextFixture();
  context.weather.days[0] = {
    ...context.weather.days[0]!,
    validDate: "2026-10-08",
    symbol: {
      code: "clearsky_day",
      validFrom: "2026-10-08T10:00:00Z",
      validTo: "2026-10-08T11:00:00Z",
    },
  };
  if (observed) context.observedWeather = observedWeatherContextFixture();
  const refresh = vi.fn();
  await act(() => {
    tree = create(
      createElement(JournalWeather, {
        date: "2026-10-08",
        context,
        location: "Magasin test",
        busy: false,
        configured: true,
        onRefresh: refresh,
        onSettings: vi.fn(),
      }),
    );
  });
  return { context, refresh };
}
it("shows observed station values neutrally, preserves the separate archived forecast, and opens public provenance", async () => {
  const { refresh } = await mount();
  expect(text()).toContain("Météo observée");
  expect(text()).toContain("SURESNES");
  expect(text()).toContain("max. mesurée");
  expect(text()).not.toContain("Ensoleillé");
  expect(
    tree!.root.findAll((n) => String(n.type) === "Icon")[0]!.props.name,
  ).toBe("thermometer-outline");
  await act(() =>
    tree!.root.find((n) => String(n.type) === "Pressable").props.onPress(),
  );
  expect(text()).toContain("0 mm · cumul producteur");
  expect(text()).toContain("06 h UTC");
  expect(text()).toContain("horaires d’ouverture");
  expect(refresh).not.toHaveBeenCalled();
  await act(() =>
    tree!.root
      .find(
        (n) =>
          String(n.type) === "Button" &&
          n.props.label === "Source météo · Météo-France · Licence ouverte",
      )
      .props.onPress(),
  );
  expect(openURL).toHaveBeenLastCalledWith(
    "https://www.data.gouv.fr/datasets/donnees-climatologiques-de-base-quotidiennes",
  );
  await act(() =>
    tree!.root
      .find(
        (n) =>
          String(n.type) === "Button" &&
          n.props.label === "Consulter la prévision archivée",
      )
      .props.onPress(),
  );
  expect(text()).toContain("Prévision archivée · distincte des mesures");
  expect(text()).toContain("Ensoleillé");
});
it("keeps old API responses readable and never relabels a forecast as an observation", async () => {
  const { refresh } = await mount(false);
  expect(text()).toContain("Prévision archivée");
  expect(text()).not.toContain("Météo observée");
  await act(() =>
    tree!.root.find((n) => String(n.type) === "Pressable").props.onPress(),
  );
  expect(text()).toContain("Une prévision archivée reste une prévision");
  expect(refresh).not.toHaveBeenCalled();
});
