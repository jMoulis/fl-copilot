import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { journalContextFixture } from "../../../../scripts/test-journal-context-fixtures";
import { JournalNationalNews } from "./journal-national-news";
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
it("shows attributed archived news, uncertain event dates and a recoverable link error", async () => {
  const context = journalContextFixture();
  context.national = [
    {
      ...structuredClone(context.sources[0]!),
      kind: "NATIONAL_SOCIAL",
      status: "STALE",
      history: [],
      payload: {
        consumption: null,
        items: [
          {
            title: "Appel national",
            summary: "Mobilisation annoncée",
            sourceUrl: "https://www.cgt.fr/appel",
            publishedAt: "2026-11-16T10:00:00.000Z",
            periodLabel: "17 novembre",
            startDate: null,
            endDate: null,
          },
        ],
      },
    },
  ];
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-17T12:00:00Z"));
  try {
    await act(() => {
      tree = create(
        createElement(JournalNationalNews, { context, date: "2026-11-17" }),
      );
    });
    await act(() =>
      tree!.root.findByType("Pressable" as never).props.onPress(),
    );
    expect(text()).toContain("Appel national");
    expect(text()).toContain("période exacte à vérifier");
    expect(text()).toContain("Version conservée");
    openURL.mockRejectedValueOnce(Error("offline"));
    await act(() => tree!.root.findByType("Button" as never).props.onPress());
    expect(text()).toContain("Impossible d’ouvrir la source");
  } finally {
    vi.useRealTimers();
  }
});
