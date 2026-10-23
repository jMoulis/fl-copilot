import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useReceiptIssueNavigation } from "./receipt-issue-summary";
import type { LayoutChangeEvent } from "react-native";
vi.mock("react-native", () => ({
  Text: "Text",
  View: "View",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
}));
vi.mock("../components/ui", () => ({
  SectionCard: () => null,
  SecondaryButton: () => null,
}));
const frames = new Map<number, FrameRequestCallback>();
let frameId = 0,
  navigation: ReturnType<typeof useReceiptIssueNavigation>,
  renderer: ReactTestRenderer;
const scroll = vi.fn();
function Probe() {
  navigation = useReceiptIssueNavigation();
  return null;
}
const layout = (y: number) =>
  ({
    nativeEvent: { layout: { y, x: 0, width: 300, height: 100 } },
  }) as LayoutChangeEvent;
async function frame() {
  await act(() => {
    const next = [...frames.values()];
    frames.clear();
    for (const fn of next) fn(0);
  });
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    frames.set(++frameId, fn);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      original(...args);
  });
  scroll.mockReset();
  await act(() => {
    renderer = create(createElement(Probe));
  });
  navigation.scrollRef.current = { scrollTo: scroll } as never;
});
afterEach(async () => {
  await act(() => renderer.unmount());
  expect(frames.size).toBe(0);
  vi.unstubAllGlobals();
});
it("waits for the newly expanded group layout instead of using a former position and coalesces layout updates", async () => {
  navigation.linesAnchor(layout(600));
  navigation.groupAnchor(["line-a"])(layout(700));
  navigation.locate(
    { lineId: "line-a", field: "totalPrice", message: "Montant" },
    { waitForGroupLayout: true },
  );
  await frame();
  expect(scroll).not.toHaveBeenCalled();
  navigation.groupAnchor(["line-a"])(layout(120));
  navigation.linesAnchor(layout(620));
  expect(frames.size).toBe(1);
  await frame();
  expect(scroll).toHaveBeenLastCalledWith({ y: 728, animated: true });
  // Selecting another field in the already open group needs no further layout event.
  navigation.locate({ lineId: "line-a", field: "weight", message: "Poids" });
  await frame();
  expect(scroll).toHaveBeenCalledTimes(2);
});
it("locates header issues and cancels a pending frame when the receipt closes", async () => {
  navigation.anchor("date")(layout(300));
  navigation.locate({ field: "date", message: "Date" });
  await frame();
  expect(scroll).toHaveBeenLastCalledWith({ y: 288, animated: true });
  navigation.locate(
    { lineId: "line-b", field: "product", message: "Produit" },
    { waitForGroupLayout: true },
  );
  expect(frames.size).toBe(1);
});
