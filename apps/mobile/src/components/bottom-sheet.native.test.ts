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
const runtime = vi.hoisted(() => ({ responders: [] as Handlers[] }));
vi.mock("react-native", () => ({
  Text: "Text",
  View: "View",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Modal: "Modal",
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Platform: { OS: "web" },
  PanResponder: {
    create: (handlers: Handlers) => {
      runtime.responders.push(handlers);
      return { panHandlers: handlers };
    },
  },
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
}));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Icon" }));
let tree: ReactTestRenderer;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  runtime.responders.length = 0;
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
async function mount(props: Partial<Parameters<typeof BottomSheet>[0]> = {}) {
  await act(() => {
    tree = create(
      createElement(
        BottomSheet,
        {
          title: "Détail du fichier",
          visible: true,
          onClose: vi.fn(),
          ...props,
        },
        createElement("Text", {}, "Une longue liste de lignes"),
      ),
    );
  });
}
it("keeps close and footer outside the scrolling body and defers completion to native dismissal", async () => {
  const close = vi.fn(),
    dismissed = vi.fn();
  await mount({
    onClose: close,
    onDismiss: dismissed,
    footer: createElement("Button", { label: "Appliquer" }),
  });
  expect(
    tree.root.find((n) => String(n.type) === "Modal").props.animationType,
  ).toBe("fade");
  const scroll = tree.root.find((n) => String(n.type) === "ScrollView");
  expect(scroll.findAll((n) => String(n.type) === "Pressable")).toHaveLength(0);
  expect(scroll.findAll((n) => String(n.type) === "Button")).toHaveLength(0);
  const x = tree.root.find(
    (n) =>
      String(n.type) === "Pressable" &&
      n.props.accessibilityLabel === "Fermer le panneau : Détail du fichier",
  );
  await act(() => x.props.onPress());
  expect(close).toHaveBeenCalledOnce();
  // The owner can reject closing (dirty/busy); a gesture never forces visibility or completion.
  expect(tree.root.find((n) => String(n.type) === "Modal").props.visible).toBe(
    true,
  );
  expect(dismissed).not.toHaveBeenCalled();
  tree.root.find((n) => String(n.type) === "Modal").props.onDismiss();
  expect(dismissed).toHaveBeenCalledOnce();
});
it("preserves a guarded backdrop close and reports completion only after native dismissal", async () => {
  const close = vi.fn(),
    dismissed = vi.fn();
  await mount({ onClose: close, onDismiss: dismissed });
  const backdrop = tree.root.find(
    (n) =>
      String(n.type) === "Pressable" &&
      n.props.accessibilityLabel === "Fermer : Détail du fichier",
  );
  await act(() => backdrop.props.onPress());
  expect(close).toHaveBeenCalledOnce();
  expect(tree.root.find((n) => String(n.type) === "Modal").props.visible).toBe(
    true,
  );
  await act(() =>
    tree.update(
      createElement(BottomSheet, {
        title: "Détail du fichier",
        visible: false,
        onClose: close,
        onDismiss: dismissed,
      }),
    ),
  );
  expect(dismissed).not.toHaveBeenCalled();
  const modal = tree.root.find((n) => String(n.type) === "Modal");
  expect(modal.props.visible).toBe(false);
  await act(() => modal.props.onDismiss());
  expect(dismissed).toHaveBeenCalledOnce();
});
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
  expect(close).toHaveBeenCalledOnce();
  header.onPanResponderRelease(null, horizontal);
  expect(close).toHaveBeenCalledOnce();
});
it("preserves keyboard-form scrolling and explicit swipe opt-out", async () => {
  await mount({ avoidKeyboard: true });
  expect(
    tree.root.find((n) => String(n.type) === "KeyboardAvoidingView").props
      .enabled,
  ).toBe(false);
  await act(() =>
    tree.update(
      createElement(BottomSheet, {
        title: "Fiche",
        visible: true,
        onClose: vi.fn(),
        swipeToClose: false,
      }),
    ),
  );
  expect(
    tree.root.findAll(
      (n) => n.props.accessibilityLabel === "Glisser vers le bas pour fermer",
    ),
  ).toHaveLength(0);
});
