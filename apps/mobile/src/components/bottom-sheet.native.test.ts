import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BottomSheet } from "./ui";

type Gesture = { dx: number; dy: number };
type Handlers = {
  onMoveShouldSetPanResponder?: (event: null, gesture: Gesture) => boolean;
  onMoveShouldSetPanResponderCapture?: (
    event: null,
    gesture: Gesture,
  ) => boolean;
  onPanResponderRelease: (event: null, gesture: Gesture) => void;
};
type Motion = {
  value: unknown;
  config: { toValue: number; useNativeDriver: boolean };
  done?: (result: { finished: boolean }) => void;
  stopped: boolean;
};
const runtime = vi.hoisted(() => ({
  responders: [] as Handlers[],
  motions: [] as Motion[],
  platform: { OS: "ios" },
}));
vi.mock("react-native", () => ({
  Text: "Text",
  View: "View",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Modal: "Modal",
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Platform: runtime.platform,
  AccessibilityInfo: { setAccessibilityFocus: vi.fn() },
  findNodeHandle: () => null,
  Easing: { cubic: "cubic", in: () => "in", out: () => "out" },
  Animated: {
    View: "AnimatedView",
    Value: class {
      constructor(readonly value: number) {}
      interpolate(config: unknown) {
        return { value: this, config };
      }
    },
    timing(value: unknown, config: Motion["config"]) {
      const motion: Motion = { value, config, stopped: false };
      runtime.motions.push(motion);
      return {
        start(done: Motion["done"]) {
          motion.done = done;
        },
        stop() {
          motion.stopped = true;
          motion.done?.({ finished: false });
        },
      };
    },
  },
  PanResponder: {
    create(handlers: Handlers) {
      runtime.responders.push(handlers);
      return { panHandlers: handlers };
    },
  },
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
  useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 }),
}));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Icon" }));
let tree: ReactTestRenderer;
let props: Parameters<typeof BottomSheet>[0];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  runtime.responders.length = 0;
  runtime.motions.length = 0;
  runtime.platform.OS = "ios";
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
const modal = () => tree.root.find((n) => String(n.type) === "Modal");
const panel = () =>
  tree.root.find(
    (n) => String(n.type) === "AnimatedView" && !!n.props.onLayout,
  );
async function mount(extra: Partial<typeof props> = {}) {
  props = {
    title: "Détail du fichier",
    visible: true,
    onClose: vi.fn(),
    children: createElement("Text", {}, "Une longue liste de lignes"),
    ...extra,
  };
  await act(() => {
    tree = create(createElement(BottomSheet, props));
  });
}
async function update(extra: Partial<typeof props>) {
  props = { ...props, ...extra };
  await act(() => tree.update(createElement(BottomSheet, props)));
}
async function show() {
  await act(() => {
    panel().props.onLayout({ nativeEvent: { layout: { height: 420 } } });
    modal().props.onShow();
  });
}
async function complete(motion = runtime.motions.at(-1)!) {
  await act(() => motion.done?.({ finished: true }));
}
it("slides the measured panel independently of the stationary fading scrim", async () => {
  await mount();
  expect(modal().props.animationType).toBe("none");
  expect(runtime.motions).toHaveLength(0);
  await show();
  const scrim = tree.root.find(
    (n) =>
      String(n.type) === "AnimatedView" && n.props.pointerEvents === "none",
  );
  expect(scrim.props.style.position).toBe("absolute");
  expect(scrim.props.style.transform).toBeUndefined();
  expect(scrim.props.style.opacity).toBe(runtime.motions[0].value);
  expect(panel().props.style.transform[0].translateY).toEqual({
    value: runtime.motions[0].value,
    config: { inputRange: [0, 1], outputRange: [420, 0] },
  });
  expect(runtime.motions[0].config.useNativeDriver).toBe(true);
});
it("keeps close and footer outside the scrolling body and lets the owner reject closing", async () => {
  const close = vi.fn(),
    dismissed = vi.fn();
  await mount({
    onClose: close,
    onDismiss: dismissed,
    footer: createElement("Button", { label: "Appliquer" }),
  });
  await show();
  await complete();
  const scroll = tree.root.find((n) => String(n.type) === "ScrollView");
  expect(scroll.findAll((n) => String(n.type) === "Pressable")).toHaveLength(0);
  expect(scroll.findAll((n) => String(n.type) === "Button")).toHaveLength(0);
  const closeButton = tree.root.find(
    (n) =>
      String(n.type) === "Pressable" &&
      n.props.accessibilityLabel === "Fermer le panneau : Détail du fichier",
  );
  await act(() => closeButton.props.onPress());
  expect(close).toHaveBeenCalledOnce();
  expect(modal().props.visible).toBe(true);
  expect(runtime.motions).toHaveLength(1);
  expect(dismissed).not.toHaveBeenCalled();
});
it("keeps selected content through the exit and defers queues until actual iOS dismissal", async () => {
  const close = vi.fn(),
    dismissed = vi.fn();
  await mount({ onClose: close, onDismiss: dismissed });
  await show();
  await complete();
  const backdrop = tree.root.find(
    (n) =>
      String(n.type) === "Pressable" &&
      n.props.accessibilityLabel === "Fermer : Détail du fichier",
  );
  await act(() => backdrop.props.onPress());
  expect(close).toHaveBeenCalledOnce();
  expect(runtime.motions).toHaveLength(1);
  await update({ visible: false, title: "", children: null });
  expect(modal().props.visible).toBe(true);
  expect(
    tree.root.findAll((n) => n.children.includes("Une longue liste de lignes")),
  ).toHaveLength(1);
  expect(
    tree.root.find((n) => String(n.type) === "KeyboardAvoidingView").props
      .pointerEvents,
  ).toBe("none");
  expect(dismissed).not.toHaveBeenCalled();
  await complete();
  expect(modal().props.visible).toBe(false);
  expect(dismissed).not.toHaveBeenCalled();
  await act(() => modal().props.onDismiss());
  await act(() => modal().props.onDismiss());
  expect(dismissed).toHaveBeenCalledOnce();
});
it("cancels a stale close when reopened and does not let its callback dismiss the new panel", async () => {
  const dismissed = vi.fn();
  await mount({ onDismiss: dismissed });
  await show();
  await complete();
  await update({ visible: false });
  const closing = runtime.motions.at(-1)!;
  await update({ visible: true, title: "Autre fichier" });
  expect(closing.stopped).toBe(true);
  await complete(closing);
  expect(modal().props.visible).toBe(true);
  expect(dismissed).not.toHaveBeenCalled();
  expect(runtime.motions.at(-1)!.config.toValue).toBe(1);
});
it("waits for a native dismissal already in flight before presenting again", async () => {
  const dismissed = vi.fn();
  await mount({ onDismiss: dismissed });
  await show();
  await complete();
  await update({ visible: false });
  await complete();
  expect(modal().props.visible).toBe(false);
  await update({ visible: true });
  expect(modal().props.visible).toBe(false);
  await act(() => modal().props.onDismiss());
  expect(dismissed).toHaveBeenCalledOnce();
  expect(modal().props.visible).toBe(true);
  await show();
  expect(runtime.motions.at(-1)!.config.toValue).toBe(1);
});
it("does not complete a queued close after unmount", async () => {
  const dismissed = vi.fn();
  await mount({ onDismiss: dismissed });
  await show();
  await complete();
  await update({ visible: false });
  const closing = runtime.motions.at(-1)!;
  await act(() => tree.unmount());
  await complete(closing);
  expect(dismissed).not.toHaveBeenCalled();
});
it.each(["web", "android"])(
  "completes exit and can reopen on %s without an iOS-only native event",
  async (os) => {
    runtime.platform.OS = os;
    const dismissed = vi.fn();
    await mount({ onDismiss: dismissed });
    await show();
    await complete();
    await update({ visible: false });
    await complete();
    expect(modal().props.visible).toBe(false);
    expect(dismissed).toHaveBeenCalledOnce();
    await update({ visible: true });
    await show();
    expect(modal().props.visible).toBe(true);
    expect(runtime.motions.at(-1)!.config.toValue).toBe(1);
  },
);
it("recognizes a downward header gesture without taking horizontal gestures or the scrolling body", async () => {
  const close = vi.fn();
  await mount({ onClose: close });
  const [header] = runtime.responders;
  const downward = { dx: 2, dy: 100 },
    horizontal = { dx: 100, dy: 20 };
  expect(header.onMoveShouldSetPanResponder!(null, downward)).toBe(true);
  expect(header.onMoveShouldSetPanResponder!(null, horizontal)).toBe(false);
  const scroll = tree.root.find((n) => String(n.type) === "ScrollView");
  expect(
    scroll.parent!.props.onMoveShouldSetPanResponderCapture,
  ).toBeUndefined();
  header.onPanResponderRelease(null, downward);
  header.onPanResponderRelease(null, horizontal);
  expect(close).toHaveBeenCalledOnce();
});
it("preserves keyboard-form scrolling and explicit swipe opt-out", async () => {
  await mount({ avoidKeyboard: true });
  expect(
    tree.root.find((n) => String(n.type) === "KeyboardAvoidingView").props
      .enabled,
  ).toBe(true);
  await update({ title: "Fiche", swipeToClose: false });
  expect(
    tree.root.findAll(
      (n) => n.props.accessibilityLabel === "Glisser vers le bas pour fermer",
    ),
  ).toHaveLength(0);
});
