import { randomUUID } from "node:crypto";
import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { synchronizedCommercialVisualReadingSchema } from "@fl-copilot/sync-contracts";
import { COMMERCIAL_VISUAL_SCHEMA_VERSION } from "@fl-copilot/domain";
import { CommercialVisualView } from "./visual-view";

const runtime = vi.hoisted(() => ({
  push: vi.fn(),
  active: undefined as ((state: string) => void) | undefined,
}));
vi.mock("react-native", () => ({
  Text: "Text",
  View: "View",
  AppState: {
    addEventListener: (_event: string, callback: (state: string) => void) => {
      runtime.active = callback;
      return { remove: vi.fn() };
    },
  },
}));
vi.mock("expo-router", () => ({
  router: { push: runtime.push },
  useFocusEffect: (callback: () => () => void) =>
    useEffect(callback, [callback]),
}));
vi.mock("@/components/ui", () => ({
  SectionCard: "Card",
  InlineAlert: "Alert",
  SecondaryButton: "Button",
}));
vi.mock("../components/date-selector", () => ({
  DateSelector: "DateSelector",
}));
vi.mock("@/dates/calendar", () => import("../dates/calendar"));

let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  runtime.push.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-23T18:00:00Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const error = console.error;
  vi.spyOn(console, "error").mockImplementation((...args) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      error(...args);
  });
});
afterEach(async () => {
  await act(() => tree?.unmount());
  tree = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function source(header = "Du 26 au 31 octobre 2026") {
  const evidence = [
    {
      pageNumber: 1,
      quote: "Source de test",
      region: null,
      verification: "VISUAL_TO_VERIFY",
    },
  ];
  const operation = (number: number) => ({
    kind: "DRAMAT",
    label: `Offre semaine ${number}`,
    summaryFr: "Proposition de la source",
    validationStatus: "TO_VALIDATE",
    evidence,
    items: [],
    fields: [
      ...(header ? [{ name: "documentDate", rawValue: header }] : []),
      { name: "weekLabel", rawValue: `S${number}` },
      { name: "documentYear", rawValue: "2026" },
    ].map((f) => ({
      ...f,
      confidence: 1,
      evidence,
      validationStatus: "TO_VALIDATE",
    })),
  });
  return synchronizedCommercialVisualReadingSchema.parse({
    id: randomUUID(),
    storeId: randomUUID(),
    sourceDocumentId: randomUUID(),
    checksum: "sha256:test-week",
    pageNumber: 1,
    pageCount: 1,
    schemaVersion: COMMERCIAL_VISUAL_SCHEMA_VERSION,
    model: "test",
    remoteVersion: 1,
    status: "READY",
    errorCode: null,
    reading: {
      operations: [operation(44), operation(45)],
      tgIdeas: [],
      otherInformation: [],
      warnings: [],
    },
  });
}
const title = () =>
  tree!.root.findAll((n) => String(n.type) === "Card")[0]!.props.title;
const picker = () => tree!.root.find((n) => String(n.type) === "DateSelector");

it("opens the document's future week on Friday and keeps the explicit choice through Sunday/foreground", async () => {
  const page = source(),
    original = JSON.stringify(page);
  await act(() => {
    tree = create(createElement(CommercialVisualView, { readings: [page] }));
  });
  expect(title()).toContain("44");
  expect(picker().props.value).toBe("2026-10-26");
  await act(() => {
    picker().props.onConfirm("2026-11-03");
  });
  expect(title()).toContain("45");
  expect(picker().props.value).toBe("2026-11-02");
  await act(() => {
    vi.setSystemTime(new Date("2026-10-25T18:00:00Z"));
    runtime.active!("active");
  });
  expect(title()).toContain("45");
  expect(JSON.stringify(page)).toBe(original);
  await act(() => {
    tree!.update(createElement(CommercialVisualView, { readings: [source()] }));
  });
  expect(title()).toContain("44");
});

it("offers an explicit future-week selector when the document header is uncertain", async () => {
  await act(() => {
    tree = create(
      createElement(CommercialVisualView, { readings: [source("")] }),
    );
  });
  expect(JSON.stringify(tree!.toJSON())).toContain(
    "semaine principale du document n’est pas identifiée",
  );
  await act(() => {
    picker().props.onConfirm("2026-10-28");
  });
  expect(title()).toContain("44");
  expect(picker().props.value).toBe("2026-10-26");
});

// The navigation must follow the selected source period, never import time.
it("opens the preparation for the document week, then the explicit future week and a replacement document", async () => {
  const page = source();
  const open = async () => {
    const button = tree!.root
      .findAll((n) => String(n.type) === "Button")
      .find((n) => n.props.label.startsWith("Ouvrir la préparation"))!;
    await act(() => button.props.onPress());
    return runtime.push.mock.lastCall?.[0];
  };
  await act(() => {
    tree = create(createElement(CommercialVisualView, { readings: [page] }));
  });
  expect(await open()).toEqual({
    pathname: "/week-preparation",
    params: { weekStart: "2026-10-26" },
  });
  await act(() => picker().props.onConfirm("2026-11-03"));
  expect(await open()).toEqual({
    pathname: "/week-preparation",
    params: { weekStart: "2026-11-02" },
  });
  await act(() => {
    tree!.update(createElement(CommercialVisualView, { readings: [source()] }));
  });
  expect((await open()).params.weekStart).toBe("2026-10-26");
});

it("uses the intended Actions week before document defaults, while allowing a later manual choice", async () => {
  await act(() => {
    tree = create(
      createElement(CommercialVisualView, {
        readings: [source()],
        initialWeekStart: "2026-11-02",
      }),
    );
  });
  expect(picker().props.value).toBe("2026-11-02");
  expect(title()).toContain("45");
  await act(() => picker().props.onConfirm("2026-11-10"));
  expect(picker().props.value).toBe("2026-11-09");
  expect(title()).toContain("46");
});
it.each(["2026-02-30", "2026-11-03", "untrusted"])(
  "ignores an invalid intended week %s without modifying source data",
  async (initialWeekStart) => {
    const page = source(),
      before = JSON.stringify(page);
    await act(() => {
      tree = create(
        createElement(CommercialVisualView, {
          readings: [page],
          initialWeekStart,
        }),
      );
    });
    expect(picker().props.value).toBe("2026-10-26");
    expect(JSON.stringify(page)).toBe(before);
  },
);
