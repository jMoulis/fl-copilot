import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { journalContextFixture } from "../../../../scripts/test-journal-context-fixtures";
import { JournalExternalContext } from "./journal-context";
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const text = () =>
  tree!.root
    .findAll((n) => String(n.type) === "Text")
    .map((n) => n.children.filter((x) => typeof x === "string").join(""))
    .join(" ");
it("opens consumption details and provenance without generation, preserves periods and reports broken source links", async () => {
  const refresh = vi.fn();
  await act(() => {
    tree = create(
      createElement(JournalExternalContext, {
        date: "2026-11-13",
        context: journalContextFixture(),
        busy: false,
        configured: true,
        onRefresh: refresh,
      }),
    );
  });
  expect(
    tree!.root.findAll((n) => String(n.type) === "Pressable"),
  ).toHaveLength(3);
  expect(refresh).not.toHaveBeenCalled();
  await act(() =>
    tree!.root
      .findAll((n) => String(n.type) === "Pressable")[2]!
      .props.onPress(),
  );
  expect(text()).toContain("6,59 kg / ménage");
  expect(text()).toContain("3,18 €/kg");
  expect(text()).toContain("2026-09");
  expect(text()).toContain("pas un indice d’inflation");
  openURL.mockRejectedValueOnce(Error("offline"));
  await act(() =>
    tree!.root
      .find(
        (n) =>
          String(n.type) === "Button" &&
          n.props.label === "Ouvrir la source officielle",
      )
      .props.onPress(),
  );
  expect(text()).toContain("Impossible d’ouvrir");
});
it("keeps unknown history distinct from no events and disables refresh without synchronized settings", async () => {
  const c = journalContextFixture();
  c.sources[0] = {
    ...c.sources[0]!,
    status: "UNAVAILABLE",
    payload: null,
    issue: "HISTORY_UNAVAILABLE",
  };
  await act(() => {
    tree = create(
      createElement(JournalExternalContext, {
        date: "2026-10-01",
        context: c,
        busy: false,
        configured: false,
        onRefresh: vi.fn(),
      }),
    );
  });
  await act(() =>
    tree!.root
      .findAll((n) => String(n.type) === "Pressable")[0]!
      .props.onPress(),
  );
  expect(text()).toContain("Aucune version n’a été collectée");
  expect(text()).not.toContain("transport n’est pas configuré");
  expect(
    tree!.root.find(
      (n) =>
        String(n.type) === "Button" &&
        n.props.label === "Actualiser les sources",
    ).props.disabled,
  ).toBe(true);
});
