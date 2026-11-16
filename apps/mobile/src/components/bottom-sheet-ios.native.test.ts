import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BottomSheet } from "./bottom-sheet.ios";
import type { BottomSheetProps } from "./bottom-sheet-props";

vi.mock("react-native", () => ({
  Keyboard: { addListener: () => ({ remove: vi.fn() }) },
  View: "View",
  Text: "Text",
  ScrollView: "ScrollView",
  Pressable: "Pressable",
  useWindowDimensions: () => ({ width: 402, height: 874 }),
}));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Icon" }));
vi.mock("@expo/ui/swift-ui", () => ({
  Host: "Host",
  Group: "Group",
  BottomSheet: "NativeSheet",
  RNHostView: "RNHost",
}));
vi.mock("@expo/ui/swift-ui/modifiers", () => ({
  frame: (value: unknown) => ({ kind: "frame", value }),
  presentationBackground: (value: unknown) => ({ kind: "background", value }),
  presentationCornerRadius: (value: unknown) => ({ kind: "radius", value }),
  presentationDetents: (value: unknown) => ({ kind: "detents", value }),
  presentationDragIndicator: (value: unknown) => ({ kind: "grabber", value }),
  interactiveDismissDisabled: (value: unknown) => ({
    kind: "dismissDisabled",
    value,
  }),
}));
let tree: ReactTestRenderer;
let props: BottomSheetProps;
const sheet = () =>
  tree.root.find((node) => String(node.type) === "NativeSheet");
const modifier = (kind: string) =>
  tree.root
    .find((node) => String(node.type) === "Group")
    .props.modifiers.find((value: { kind: string }) => value.kind === kind)
    ?.value;
async function mount(extra: Partial<BottomSheetProps> = {}) {
  props = {
    visible: true,
    title: "Détail",
    onClose: vi.fn(),
    children: createElement("Detail", { selected: "source-1" }),
    ...extra,
  };
  await act(() => {
    tree = create(createElement(BottomSheet, props));
  });
}
async function update(extra: Partial<BottomSheetProps>) {
  props = { ...props, ...extra };
  await act(() => tree.update(createElement(BottomSheet, props)));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      original(...args);
  });
});
afterEach(async () => {
  await act(() => tree?.unmount());
  vi.unstubAllGlobals();
});

it("uses an actual native sheet and hosts existing RN content without a custom gesture or animation", async () => {
  await mount();
  expect(sheet().props.isPresented).toBe(true);
  expect(
    tree.root.find((node) => String(node.type) === "Host").props.style,
  ).toMatchObject({ width: 402, height: 874 });
  expect(sheet().props.fitToContents).toBeUndefined();
  expect(modifier("detents")).toEqual(["medium", "large"]);
  expect(
    tree.root
      .find((node) => String(node.type) === "RNHost")
      .find((node) => String(node.type) === "Detail").props.selected,
  ).toBe("source-1");
  expect(modifier("dismissDisabled")).toBe(false);
  expect(
    tree.root.findAll(
      (node) =>
        !!node.props.onPanResponderMove ||
        !!node.props.onPanResponderRelease ||
        String(node.type) === "Modal",
    ),
  ).toHaveLength(0);
});
it("keeps native interactive dismissal disabled for an existing guard but X still requests its confirmation", async () => {
  const close = vi.fn(),
    dismissed = vi.fn();
  await mount({ dismissible: false, onClose: close, onDismiss: dismissed });
  expect(modifier("dismissDisabled")).toBe(true);
  expect(modifier("grabber")).toBe("visible");
  const x = tree.root.find(
    (node) =>
      String(node.type) === "Pressable" &&
      node.props.accessibilityLabel === "Fermer le panneau : Détail",
  );
  await act(() => x.props.onPress());
  expect(close).toHaveBeenCalledOnce();
  expect(sheet().props.isPresented).toBe(true);
  expect(dismissed).not.toHaveBeenCalled();
  await update({ dismissible: true });
  expect(modifier("dismissDisabled")).toBe(false);
});
it("honours the explicit swipe opt-out independently of form guards", async () => {
  await mount({ swipeToClose: false });
  expect(modifier("dismissDisabled")).toBe(true);
  expect(modifier("grabber")).toBe("hidden");
});
it("keeps the selected content until actual native dismissal and then releases a queued action once", async () => {
  const dismissed = vi.fn();
  await mount({ onDismiss: dismissed });
  await update({ visible: false, title: "", children: null });
  expect(sheet().props.isPresented).toBe(false);
  expect(
    tree.root.find((node) => String(node.type) === "Detail").props.selected,
  ).toBe("source-1");
  expect(dismissed).not.toHaveBeenCalled();
  const nativeDismiss = sheet().props.onDismiss;
  await act(() => nativeDismiss());
  expect(tree.toJSON()).toBeNull();
  await act(() => nativeDismiss());
  expect(dismissed).toHaveBeenCalledOnce();
});

it("removes the native presenter after closing and creates it again on reopening", async () => {
  await mount({ visible: false });
  expect(tree.toJSON()).toBeNull();
  for (let i = 0; i < 3; i++) {
    await update({ visible: true });
    expect(sheet().props.isPresented).toBe(true);
    await update({ visible: false });
    expect(sheet().props.isPresented).toBe(false);
    await act(() => sheet().props.onDismiss());
    expect(tree.toJSON()).toBeNull();
  }
});
it("notifies the owner after native gesture dismissal starts, never from a fabricated gesture threshold", async () => {
  const close = vi.fn(),
    dismissed = vi.fn();
  await mount({ onClose: close, onDismiss: dismissed });
  await act(() => sheet().props.onIsPresentedChange(false));
  expect(close).toHaveBeenCalledOnce();
  expect(sheet().props.isPresented).toBe(false);
  expect(dismissed).not.toHaveBeenCalled();
  await update({ visible: false });
  await act(() => sheet().props.onDismiss());
  expect(dismissed).toHaveBeenCalledOnce();
});
it("finishes a swipe even when native dismissal arrives before the state-change event, ignoring late events after reopening", async () => {
  const close = vi.fn(),
    dismissed = vi.fn();
  await mount({
    onClose: () => {
      close();
      props = { ...props, visible: false };
      tree.update(createElement(BottomSheet, props));
    },
    onDismiss: dismissed,
  });
  const previous = sheet().props;
  await act(() => previous.onDismiss());
  expect(close).toHaveBeenCalledOnce();
  expect(dismissed).toHaveBeenCalledOnce();
  expect(tree.toJSON()).toBeNull();
  await act(() => previous.onIsPresentedChange(false));
  expect(close).toHaveBeenCalledOnce();
  await update({ visible: true });
  expect(sheet().props.isPresented).toBe(true);
  await act(() => {
    previous.onDismiss();
    previous.onIsPresentedChange(false);
  });
  expect(sheet().props.isPresented).toBe(true);
  expect(close).toHaveBeenCalledOnce();
  expect(dismissed).toHaveBeenCalledOnce();
});
it("holds a rapid reopen until the previous native sheet has really dismissed", async () => {
  const dismissed = vi.fn();
  await mount({ onDismiss: dismissed });
  await update({ visible: false });
  await update({
    visible: true,
    children: createElement("Detail", { selected: "source-2" }),
  });
  expect(sheet().props.isPresented).toBe(false);
  expect(
    tree.root.find((node) => String(node.type) === "Detail").props.selected,
  ).toBe("source-1");
  await act(() => sheet().props.onDismiss());
  expect(dismissed).toHaveBeenCalledOnce();
  expect(sheet().props.isPresented).toBe(true);
  expect(
    tree.root.find((node) => String(node.type) === "Detail").props.selected,
  ).toBe("source-2");
});
it("keeps fixed controls outside the scrollable body", async () => {
  await mount({ footer: createElement("Confirm"), avoidKeyboard: true });
  const scroll = tree.root.find((node) => String(node.type) === "ScrollView");
  expect(scroll.props.onFocus).toBeTypeOf("function");
  expect(scroll.props.onLayout).toBeTypeOf("function");
  expect(
    scroll.findAll((node) => String(node.type) === "Confirm"),
  ).toHaveLength(0);
  expect(
    scroll.findAll((node) => String(node.type) === "Pressable"),
  ).toHaveLength(0);
});
