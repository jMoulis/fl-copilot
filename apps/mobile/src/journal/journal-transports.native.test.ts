import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { it, expect, vi, afterEach, beforeEach } from "vitest";
import type { TransportContext } from "@fl-copilot/domain";
import { journalContextFixture } from "../../../../scripts/test-journal-context-fixtures";
import { JournalTransports, transportLinesForDate } from "./journal-transports";
vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
  Linking: { openURL: vi.fn() },
}));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Icon" }));
vi.mock("@expo/vector-icons/MaterialCommunityIcons", () => ({
  default: "TransportIcon",
}));
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
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  await act(() => tree?.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const traffic: TransportContext = {
  status: "AVAILABLE",
  issue: null,
  radiusMetres: 800,
  lines: [
    {
      id: "IDFM:C01383",
      name: "Metro 13",
      stopName: "Les Agnettes",
      distanceMetres: 450,
      status: "AVAILABLE",
      retrievedAt: "2026-11-13T10:00:00.000Z",
      validUntil: "2026-11-13T10:30:00.000Z",
      capturedAt: "2026-11-13T10:00:00.000Z",
      disruptions: [],
      partial: false,
      history: [
        {
          capturedAt: "2026-11-12T10:00:00.000Z",
          disruptions: [
            {
              id: "past",
              message: "Travaux annoncés pour le soir",
              effect: null,
              applicationPeriods: [
                { begin: "20261112T220000", end: "20261113T020000" },
              ],
              schedule: null,
              updatedAt: null,
            },
          ],
          partial: false,
        },
      ],
    },
  ],
};
it("uses the captured past day instead of today's feed and preserves unknown before first collection", () => {
  expect(
    transportLinesForDate(traffic, "2026-11-12", "2026-11-13")[0]
      ?.disruptions[0]?.id,
  ).toBe("past");
  expect(
    transportLinesForDate(traffic, "2026-11-13", "2026-11-14")[0]?.disruptions,
  ).toEqual([]);
  expect(
    transportLinesForDate(traffic, "2026-11-11", "2026-11-13")[0],
  ).toMatchObject({ status: "UNAVAILABLE", capturedAt: null, disruptions: [] });
});
it("keeps empty filtered lines quiet without losing their identity or shop configuration", async () => {
  await act(() => {
    tree = create(
      createElement(JournalTransports, {
        context: {
          ...journalContextFixture(),
          transport: {
            ...traffic,
            lines: traffic.lines.map((line) => ({ ...line, partial: true })),
          },
        },
        date: "2026-11-13",
        busy: false,
        onRefresh: vi.fn(),
      }),
    );
  });
  await act(() =>
    tree!.root
      .findByProps({
        accessibilityLabel: "Consulter les transports à proximité",
      })
      .props.onPress(),
  );
  const group = tree!.root.findByProps({ testID: "transport-group-METRO" });
  expect(group.props.accessibilityState.expanded).toBe(false);
  await act(() => group.props.onPress());
  expect(group.props.accessibilityState.expanded).toBe(true);
  expect(
    tree!.root
      .findAll((n) => String(n.type) === "TransportIcon")
      .map((n) => n.props.name),
  ).toEqual(["subway-variant", "subway-variant"]);
  const text = tree!.root
    .findAll((n) => String(n.type) === "Text")
    .map((n) => n.children.join(""))
    .join(" ");
  expect(text).toContain("Metro 13");
  expect(text).toContain("Les Agnettes");
  expect(text).not.toContain("Aucun message dans les types suivis");
  expect(text).not.toContain("Extrait partiel");
  expect(text).not.toContain("trafic normal");
  await act(() =>
    tree!.root
      .find(
        (n) =>
          String(n.type) === "Button" &&
          n.props.label === "Régler les transports du magasin",
      )
      .props.onPress(),
  );
  expect((await import("expo-router")).router.push).toHaveBeenCalledWith(
    "/store-transports",
  );
});

it("opens disrupted groups first, preserves manual collapse over refresh and exposes missing readings", async () => {
  const context = {
    ...journalContextFixture(),
    transport: {
      ...traffic,
      lines: [
        {
          ...traffic.lines[0]!,
          disruptions: [
            {
              id: "stopped",
              message: "Service interrompu",
              effect: "NO_SERVICE",
              applicationPeriods: [],
              schedule: null,
              updatedAt: null,
            },
          ],
        },
        {
          ...traffic.lines[0]!,
          id: "IDFM:C00002",
          name: "Bus 238",
          capturedAt: null,
          disruptions: [],
          status: "UNAVAILABLE" as const,
          history: [],
        },
      ],
    },
  };
  const props = {
    context,
    date: "2026-11-13",
    busy: false,
    onRefresh: vi.fn(),
  };
  await act(() => {
    tree = create(createElement(JournalTransports, props));
  });
  await act(() =>
    tree!.root
      .findByProps({
        accessibilityLabel: "Consulter les transports à proximité",
      })
      .props.onPress(),
  );
  const groups = tree!.root.findAll(
    (n) =>
      String(n.type) === "Pressable" &&
      n.props.testID?.startsWith("transport-group-"),
  );
  expect(groups.map((n) => n.props.testID)).toEqual([
    "transport-group-METRO",
    "transport-group-BUS",
  ]);
  expect(groups[0]!.props.accessibilityState.expanded).toBe(true);
  expect(groups[1]!.props.accessibilityState.expanded).toBe(false);
  expect(groups[1]!.props.accessibilityLabel).toContain("1 sans relevé");
  const alerts = () =>
    tree!.root
      .findAll((n) => String(n.type) === "Text")
      .map((n) => n.children.join(""))
      .join(" ");
  expect(alerts()).toContain("Service interrompu");
  await act(() => groups[0]!.props.onPress());
  expect(alerts()).not.toContain("Service interrompu");
  await act(() =>
    tree!.update(createElement(JournalTransports, { ...props, busy: true })),
  );
  expect(
    tree!.root.findByProps({ testID: "transport-group-METRO" }).props
      .accessibilityState.expanded,
  ).toBe(false);
  await act(() =>
    tree!.root.findByProps({ testID: "transport-group-BUS" }).props.onPress(),
  );
  expect(alerts()).toContain("Aucune capture disponible");
  await act(() =>
    tree!.update(
      createElement(JournalTransports, { ...props, date: "2026-11-14" }),
    ),
  );
  expect(
    tree!.root.findByProps({ testID: "transport-group-METRO" }).props
      .accessibilityState.expanded,
  ).toBe(true);
});
