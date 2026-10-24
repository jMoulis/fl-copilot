import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import { ConversationMenuRow } from "./conversation-menu-row";

const native = vi.hoisted(() => ({
  alert: vi.fn(),
  close: vi.fn(),
  focused: true,
}));
vi.mock("expo-router", () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    const focused = native.focused;
    useEffect(() => (focused ? cb() : undefined), [cb, focused]);
  },
}));
vi.mock("react-native", () => ({
  Alert: { alert: native.alert },
  Pressable: "Pressable",
  View: "View",
  Text: "Text",
  StyleSheet: { create: (s: unknown) => s },
}));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Icon" }));
vi.mock("react-native-gesture-handler/ReanimatedSwipeable", () => ({
  default: "Swipeable",
}));
let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  native.focused = true;
  native.alert.mockReset();
  native.close.mockReset();
  const error = console.error;
  vi.spyOn(console, "error").mockImplementation((...args) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      error(...args);
  });
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
});
async function mount() {
  const f = chatFixture(randomUUID),
    remove = vi
      .fn<(signal: AbortSignal) => Promise<void>>()
      .mockResolvedValue(undefined);
  const props = {
    conversation: f.conversation,
    context: {},
    enabled: true,
    onOpen: vi.fn(),
    onDelete: remove,
  };
  await act(async () => {
    tree = create(createElement(ConversationMenuRow, props));
  });
  return { props, remove };
}
const button = () =>
  tree!.root.find(
    (n) =>
      typeof n.type === "string" &&
      String(n.type) === "Pressable" &&
      String(n.props.accessibilityLabel).startsWith(
        "Supprimer la conversation",
      ),
  );
const confirmation = () =>
  native.alert.mock.calls.at(-1)![2] as Array<{
    text: string;
    onPress(): void;
  }>;
async function request() {
  await act(async () => button().props.onPress());
  return confirmation();
}
function deferred() {
  let resolve!: () => void, reject!: (reason: Error) => void;
  const promise = new Promise<void>((a, b) => {
    resolve = a;
    reject = b;
  });
  return {
    promise,
    resolve: () => resolve(),
    reject: () => reject(Error("PRIVATE_SQL_DETAIL")),
  };
}
it("offers a visible labelled 48-point alternative and cancellation without deletion", async () => {
  const { props, remove } = await mount();
  expect(button().props.accessibilityLabel).toBe(
    `Supprimer la conversation ${props.conversation.title}`,
  );
  expect(button().props.accessibilityRole).toBe("button");
  expect(button().props.style).toMatchObject({ minWidth: 48, minHeight: 48 });
  const options = await request();
  expect(remove).not.toHaveBeenCalled();
  await act(async () => options[0]!.onPress());
  expect(remove).not.toHaveBeenCalled();
  await request();
  expect(native.alert).toHaveBeenCalledTimes(2);
});
it("keeps the swipe action and uses the same confirmation with one cancellable deletion", async () => {
  const { remove } = await mount();
  const swipe = tree!.root.find(
    (n) => typeof n.type === "string" && String(n.type) === "Swipeable",
  );
  const action = swipe.props.renderRightActions(undefined, undefined, {
    close: native.close,
  });
  await act(async () => action.props.onPress());
  expect(native.close).toHaveBeenCalledOnce();
  expect(remove).not.toHaveBeenCalled();
  await act(async () => confirmation()[1]!.onPress());
  expect(remove).toHaveBeenCalledOnce();
  expect(remove.mock.calls[0]![0].aborted).toBe(false);
});
it.each(["context", "hidden", "identity", "unmount"])(
  "rejects a retained native confirmation after %s replacement",
  async (change) => {
    const { props, remove } = await mount(),
      options = await request();
    await act(async () => {
      if (change === "unmount") tree!.unmount();
      else
        tree!.update(
          createElement(ConversationMenuRow, {
            ...props,
            context: change === "context" ? {} : props.context,
            enabled: change !== "hidden",
            conversation:
              change === "identity"
                ? { ...props.conversation, id: randomUUID() }
                : props.conversation,
          }),
        );
    });
    await act(async () => options[1]!.onPress());
    expect(remove).not.toHaveBeenCalled();
  },
);
it("cancels an in-flight queued write on context closure and hides late private failures", async () => {
  const { props, remove } = await mount(),
    job = deferred();
  remove.mockImplementationOnce(() => job.promise);
  const options = await request();
  await act(async () => options[1]!.onPress());
  const signal = remove.mock.calls[0]![0];
  expect(button().props.disabled).toBe(true);
  await act(async () =>
    tree!.update(createElement(ConversationMenuRow, { ...props, context: {} })),
  );
  expect(signal.aborted).toBe(true);
  await act(async () => job.reject());
  expect(JSON.stringify(tree!.toJSON())).not.toContain("PRIVATE_SQL_DETAIL");
  expect(JSON.stringify(tree!.toJSON())).not.toContain("Réessayez");
  expect(button().props.disabled).toBe(false);
});
it("coalesces duplicate confirmations and allows a deliberate retry after a safe French error", async () => {
  const { remove } = await mount(),
    job = deferred();
  remove.mockImplementationOnce(() => job.promise);
  const options = await request();
  await act(async () => {
    options[1]!.onPress();
    options[1]!.onPress();
  });
  expect(remove).toHaveBeenCalledOnce();
  await act(async () => job.reject());
  expect(JSON.stringify(tree!.toJSON())).toContain(
    "La conversation n’a pas pu être supprimée",
  );
  expect(JSON.stringify(tree!.toJSON())).not.toContain("PRIVATE_SQL_DETAIL");
  const retry = await request();
  await act(async () => retry[1]!.onPress());
  expect(remove).toHaveBeenCalledTimes(2);
});
it("keeps an ordinary rerender from cancelling the user's current confirmation", async () => {
  const { props, remove } = await mount(),
    options = await request();
  await act(async () =>
    tree!.update(createElement(ConversationMenuRow, { ...props })),
  );
  await act(async () => options[1]!.onPress());
  expect(remove).toHaveBeenCalledOnce();
});
it("refuses a retained confirmation after leaving the screen", async () => {
  const { props, remove } = await mount(),
    options = await request();
  native.focused = false;
  await act(async () =>
    tree!.update(createElement(ConversationMenuRow, props)),
  );
  await act(async () => {
    options[1]!.onPress();
    button().props.onPress();
  });
  expect(remove).not.toHaveBeenCalled();
  expect(native.alert).toHaveBeenCalledOnce();
});
it("returns from blur with a new review whose busy/error state cannot be changed by the old write", async () => {
  const { props, remove } = await mount(),
    old = deferred(),
    next = deferred();
  remove
    .mockImplementationOnce(() => old.promise)
    .mockImplementationOnce(() => next.promise);
  const first = await request();
  await act(async () => first[1]!.onPress());
  const oldSignal = remove.mock.calls[0]![0];
  native.focused = false;
  await act(async () =>
    tree!.update(createElement(ConversationMenuRow, props)),
  );
  expect(oldSignal.aborted).toBe(true);
  native.focused = true;
  await act(async () =>
    tree!.update(createElement(ConversationMenuRow, props)),
  );
  const second = await request();
  await act(async () => second[1]!.onPress());
  expect(remove).toHaveBeenCalledTimes(2);
  await act(async () => old.reject());
  expect(button().props.disabled).toBe(true);
  expect(JSON.stringify(tree!.toJSON())).not.toContain("Réessayez");
  await act(async () => next.resolve());
  expect(button().props.disabled).toBe(false);
});
