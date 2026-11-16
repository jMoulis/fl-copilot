import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  economicContextFixture,
  economicProduceContextFixture,
} from "../../../../scripts/test-economic-fixtures";
import { JournalEconomy } from "./journal-economy";
const openURL = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
  Linking: { openURL },
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
}));
let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  openURL.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  await act(() => tree?.unmount());
  vi.unstubAllGlobals();
});
function text() {
  return tree!.root
    .findAll((n) => String(n.type) === "Text")
    .map((n) => n.children.filter((x) => typeof x === "string").join(""))
    .join(" ");
}
it("shows each monthly period, exact annual inflation and confidence points with independent official links", async () => {
  await act(() => {
    tree = create(
      createElement(JournalEconomy, {
        date: "2026-11-13",
        context: economicContextFixture(),
        busy: false,
        onRefresh: vi.fn(),
      }),
    );
  });
  expect(text()).toContain("2 % / an");
  expect(text()).toContain("septembre 2026");
  expect(text()).toContain("80 points");
  expect(text()).toContain("octobre 2026");
  await act(() =>
    tree!.root.find((n) => String(n.type) === "Pressable").props.onPress(),
  );
  expect(text()).toContain("-5 points");
  expect(text()).toContain("ne reconstitue pas");
  const sources = tree!.root.findAll(
    (n) =>
      String(n.type) === "Button" &&
      n.props.label === "Consulter la source INSEE",
  );
  expect(sources).toHaveLength(2);
  await act(() => sources[0]!.props.onPress());
  expect(openURL).toHaveBeenLastCalledWith(
    "https://www.insee.fr/fr/statistiques/serie/011813720",
  );
  await act(() => sources[1]!.props.onPress());
  expect(openURL).toHaveBeenLastCalledWith(
    "https://www.insee.fr/fr/statistiques/serie/001587668",
  );
});
it("keeps zero confidence and missing inflation distinct, with no automatic refresh or AI action", async () => {
  const c = economicContextFixture(),
    refresh = vi.fn();
  c.series[0]!.points.at(-1)!.value = null;
  c.series[1]!.points.at(-1)!.value = "0";
  await act(() => {
    tree = create(
      createElement(JournalEconomy, {
        date: "2026-11-13",
        context: c,
        busy: true,
        onRefresh: refresh,
      }),
    );
  });
  expect(text()).toContain("0 points");
  expect(text()).not.toContain("0 % / an");
  expect(refresh).not.toHaveBeenCalled();
  await act(() =>
    tree!.root.find((n) => String(n.type) === "Pressable").props.onPress(),
  );
  expect(
    tree!.root.findAll(
      (n) => String(n.type) === "Button" && n.props.label === "Actualisation…",
    )[0]!.props.disabled,
  ).toBe(true);
});

it("shows produce first with separate months, scope and direct sources in the existing sheet", async () => {
  await act(() => {
    tree = create(
      createElement(JournalEconomy, {
        date: "2026-11-16",
        context: economicProduceContextFixture(),
        busy: false,
        onRefresh: vi.fn(),
      }),
    );
  });
  expect(text()).toContain("Fruits (INSEE) · 5,25 % / an · octobre 2026");
  expect(text()).toContain("Légumes (INSEE) · -10 % / an · septembre 2026");
  await act(() =>
    tree!.root.find((n) => String(n.type) === "Pressable").props.onPress(),
  );
  expect(text()).toContain("ne correspondent pas strictement au rayon frais");
  const links = tree!.root.findAll(
    (n) =>
      String(n.type) === "Button" &&
      n.props.label === "Consulter la source INSEE",
  );
  expect(links).toHaveLength(4);
  await act(() => links[2]!.props.onPress());
  expect(openURL).toHaveBeenLastCalledWith(
    "https://www.insee.fr/fr/statistiques/serie/011814957",
  );
});
