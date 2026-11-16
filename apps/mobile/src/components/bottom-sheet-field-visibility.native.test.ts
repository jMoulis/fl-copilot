import { createElement, createRef } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { ScrollView } from "react-native";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BottomSheetContent } from "./bottom-sheet-content";

type Measurement = (
  x: number,
  y: number,
  width: number,
  height: number,
) => void;
type Field = { measureInWindow(callback: Measurement): void };
type ScrollHost = {
  getNativeScrollRef(): { measureInWindow(callback: Measurement): void };
  scrollTo(options: { y: number; animated: boolean }): void;
};
const runtime = vi.hoisted(() => ({
  focused: null as Field | null,
  scroll: null as ScrollHost | null,
  keyboardListeners: new Set<() => void>(),
  subscriptions: [] as {
    event: string;
    callback: () => void;
    remove: () => void;
  }[],
}));
vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  TextInput: { State: { currentlyFocusedInput: () => runtime.focused } },
  Keyboard: {
    addListener(event: string, callback: () => void) {
      runtime.keyboardListeners.add(callback);
      const subscription = {
        event,
        callback,
        remove: vi.fn(() => runtime.keyboardListeners.delete(callback)),
      };
      runtime.subscriptions.push(subscription);
      return subscription;
    },
  },
}));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Icon" }));

let tree: ReactTestRenderer | undefined;
let props: Parameters<typeof BottomSheetContent>[0];
const body = () =>
  tree!.root.find((node) => String(node.type) === "ScrollView");
function scrollHost(bounds = { top: 137, height: 329 }) {
  return {
    getNativeScrollRef: () => ({
      measureInWindow: (callback: Measurement) =>
        callback(0, bounds.top, 402, bounds.height),
    }),
    scrollTo: vi.fn(),
  };
}
function field(top: number, height = 26) {
  return {
    measureInWindow: vi.fn((callback: Measurement) =>
      callback(20, top, 362, height),
    ),
  };
}
function delayedField() {
  const callbacks: Measurement[] = [];
  const input = {
    measureInWindow: vi.fn((callback: Measurement) => callbacks.push(callback)),
  };
  return { input, callbacks };
}
async function mount(extra: Partial<typeof props> = {}) {
  props = {
    title: "Déclarer l’installation",
    onClose: vi.fn(),
    fill: true,
    avoidKeyboard: true,
    footer: createElement("Confirm"),
    children: createElement("Form"),
    ...extra,
  };
  await act(() => {
    tree = create(createElement(BottomSheetContent, props), {
      createNodeMock: (element) =>
        element.type === "ScrollView" ? runtime.scroll : null,
    });
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  runtime.focused = null;
  runtime.scroll = scrollHost();
  runtime.keyboardListeners.clear();
  runtime.subscriptions.length = 0;
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      original(...args);
  });
});
afterEach(async () => {
  await act(() => tree?.unmount());
  tree = undefined;
  vi.unstubAllGlobals();
});

it("reveals a field below the fixed footer using the body bounds and preserves the parent's scroll ref", async () => {
  const parentRef = createRef<ScrollView>();
  await mount({ scrollRef: parentRef });
  expect(parentRef.current).toBe(runtime.scroll);
  await act(() =>
    body().props.onScroll({ nativeEvent: { contentOffset: { y: 80 } } }),
  );
  runtime.focused = field(512);
  await act(() => body().props.onFocus());
  // The body ends at 466, above the footer: the field's bottom must reach 446.
  expect(runtime.scroll!.scrollTo).toHaveBeenCalledExactlyOnceWith({
    y: 172,
    animated: false,
  });
  await act(() => tree!.unmount());
  tree = undefined;
  expect(parentRef.current).toBeNull();
});

it("leaves an already visible field and the user's scroll position unchanged", async () => {
  await mount();
  runtime.focused = field(210, 60);
  await act(() => body().props.onFocus());
  await act(() => body().props.onLayout());
  expect(runtime.scroll!.scrollTo).not.toHaveBeenCalled();
});

it("scrolls upward when the focused field is hidden above the body", async () => {
  await mount();
  await act(() =>
    body().props.onScroll({ nativeEvent: { contentOffset: { y: 120 } } }),
  );
  runtime.focused = field(100);
  await act(() => body().props.onFocus());
  expect(runtime.scroll!.scrollTo).toHaveBeenCalledExactlyOnceWith({
    y: 63,
    animated: false,
  });
});

it("does not follow focus that belongs to a different surface during a layout change", async () => {
  await mount();
  const outside = field(512);
  runtime.focused = outside;
  await act(() => body().props.onLayout());
  expect(outside.measureInWindow).not.toHaveBeenCalled();
  runtime.focused = field(210);
  await act(() => body().props.onFocus());
  runtime.focused = outside;
  await act(() => body().props.onLayout());
  expect(outside.measureInWindow).not.toHaveBeenCalled();
  expect(runtime.scroll!.scrollTo).not.toHaveBeenCalled();
});

it("ignores measurements that finish after blur or after the content unmounts", async () => {
  await mount();
  const { input, callbacks } = delayedField();
  runtime.focused = input;
  await act(() => body().props.onFocus());
  expect(callbacks).toHaveLength(1);
  runtime.focused = null;
  await act(() => body().props.onBlur());
  await act(() => callbacks[0]!(20, 512, 362, 26));
  expect(runtime.scroll!.scrollTo).not.toHaveBeenCalled();
  runtime.focused = input;
  await act(() => body().props.onFocus());
  expect(callbacks).toHaveLength(2);
  await act(() => tree!.unmount());
  tree = undefined;
  await act(() => callbacks[1]!(20, 512, 362, 26));
  expect(runtime.scroll!.scrollTo).not.toHaveBeenCalled();
});

it("forwards a replacement parent ref and rejects measurements from the previous scroll host", async () => {
  const firstRef = vi.fn(),
    nextRef = vi.fn();
  await mount({ scrollRef: firstRef });
  const previousScroll = runtime.scroll!;
  expect(firstRef).toHaveBeenLastCalledWith(previousScroll);
  const { input, callbacks } = delayedField();
  runtime.focused = input;
  await act(() => body().props.onFocus());
  expect(callbacks).toHaveLength(1);
  const nextScroll = scrollHost();
  runtime.scroll = nextScroll;
  props = { ...props, scrollRef: nextRef };
  await act(() => tree!.update(createElement(BottomSheetContent, props)));
  expect(firstRef).toHaveBeenLastCalledWith(null);
  expect(nextRef).toHaveBeenLastCalledWith(nextScroll);
  await act(() => callbacks[0]!(20, 512, 362, 26));
  expect(previousScroll.scrollTo).not.toHaveBeenCalled();
  expect(nextScroll.scrollTo).not.toHaveBeenCalled();
});

it("remeasures after UIKit's final keyboard scroll and removes the keyboard listener on unmount", async () => {
  const bounds = { top: 137, height: 600 };
  runtime.scroll = scrollHost(bounds);
  let fieldTop = 511;
  const input = {
    measureInWindow: vi.fn((callback: Measurement) =>
      callback(20, fieldTop, 362, 70),
    ),
  };
  await mount();
  runtime.focused = input;
  await act(() => body().props.onFocus());
  await act(() => body().props.onLayout());
  expect(runtime.scroll.scrollTo).not.toHaveBeenCalled();
  expect(runtime.subscriptions).toHaveLength(1);
  const subscription = runtime.subscriptions[0]!;
  expect(subscription.event).toBe("keyboardDidShow");

  // UIKit settles after those early events: the visible body now ends at 523.
  bounds.top = 194;
  bounds.height = 329;
  await act(() =>
    body().props.onScroll({ nativeEvent: { contentOffset: { y: 301 } } }),
  );
  await act(() => subscription.callback());
  expect(input.measureInWindow).toHaveBeenCalledTimes(3);
  expect(runtime.scroll.scrollTo).toHaveBeenCalledExactlyOnceWith({
    y: 379,
    animated: false,
  });

  fieldTop = 433;
  await act(() =>
    body().props.onScroll({ nativeEvent: { contentOffset: { y: 379 } } }),
  );
  await act(() => subscription.callback());
  expect(runtime.scroll.scrollTo).toHaveBeenCalledTimes(1);
  expect(runtime.subscriptions).toHaveLength(1);

  await act(() => tree!.unmount());
  tree = undefined;
  expect(subscription.remove).toHaveBeenCalledOnce();
  expect(runtime.keyboardListeners.size).toBe(0);
  await act(() => subscription.callback());
  expect(runtime.scroll.scrollTo).toHaveBeenCalledTimes(1);
});
