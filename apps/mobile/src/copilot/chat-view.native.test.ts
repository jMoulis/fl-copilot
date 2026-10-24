import { createElement, Fragment } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CopilotMessage } from "@fl-copilot/domain";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import { CopilotChatView } from "./chat-view";

const native = vi.hoisted(() => ({ sheet: vi.fn(), alert: vi.fn() }));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  ActionSheetIOS: { showActionSheetWithOptions: native.sheet },
  Alert: { alert: native.alert },
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: "Text",
  View: "View",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  TextInput: "TextInput",
  KeyboardAvoidingView: "KeyboardAvoidingView",
  FlatList: ({
    data,
    renderItem,
  }: {
    data: CopilotMessage[];
    renderItem: (row: {
      item: CopilotMessage;
    }) => ReturnType<typeof createElement>;
  }) =>
    createElement(
      Fragment,
      {},
      ...data.map((item) =>
        createElement(Fragment, { key: item.id }, renderItem({ item })),
      ),
    ),
}));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Icon" }));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("expo-crypto", () => ({ randomUUID }));
vi.mock("../components/ui", () => ({
  BottomSheet: "BottomSheet",
  SecondaryButton: "Button",
}));
vi.mock("./activity-trail", () => ({ CopilotActivityTrail: "ActivityTrail" }));

let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  native.sheet.mockReset();
  native.alert.mockReset();
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
function buttons() {
  return tree!.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      String(node.type) === "Pressable" &&
      /Actions (de votre message|de la réponse du copilote)/.test(
        node.props.accessibilityLabel ?? "",
      ),
  );
}
async function mount(
  overrides: Partial<Parameters<typeof CopilotChatView>[0]> = {},
) {
  const f = chatFixture(randomUUID);
  const remove = vi.fn();
  const messages = [
    f.message,
    {
      ...f.message,
      id: randomUUID(),
      role: "ASSISTANT" as const,
      text: "| Produit | CA |\n| --- | ---: |\n| Tomate | 12 € |",
    },
  ];
  await act(async () => {
    tree = create(
      createElement(CopilotChatView, {
        title: "Rayon",
        messages,
        draft: "",
        status: "IDLE",
        onDraftChange: vi.fn(),
        onSend: vi.fn(),
        onConversations: vi.fn(),
        onDeleteMessage: remove,
        ...overrides,
      }),
    );
  });
  return { messages, remove };
}
it("opens the existing native menu from a labelled visible 48-point button for either message, without immediately deleting", async () => {
  const { messages, remove } = await mount();
  expect(buttons()).toHaveLength(2);
  for (const [index, button] of buttons().entries()) {
    expect(button.props.accessibilityRole).toBe("button");
    expect(button.props.style).toMatchObject({ minWidth: 48, minHeight: 48 });
    let ancestor = button.parent;
    while (ancestor) {
      if (
        typeof ancestor.type === "string" &&
        String(ancestor.type) === "Pressable"
      )
        expect(ancestor.props.accessible).toBe(false);
      ancestor = ancestor.parent;
    }
    await act(async () => button.props.onPress());
    const [options, choose] = native.sheet.mock.calls.at(-1)!;
    expect(options.options).toEqual(["Copier", "Supprimer", "Annuler"]);
    choose(2);
    expect(remove).not.toHaveBeenCalled();
    choose(1);
    expect(remove).toHaveBeenCalledWith(messages[index]);
    remove.mockClear();
  }
});
it("retains a native horizontal table without a whole-message press responder", async () => {
  await mount();
  const table = tree!.root.find(
    (node) =>
      typeof node.type === "string" &&
      String(node.type) === "ScrollView" &&
      node.props.horizontal,
  );
  let ancestor = table.parent;
  while (ancestor) {
    expect(ancestor.type).not.toBe("Pressable");
    ancestor = ancestor.parent;
  }
  expect(buttons()).toHaveLength(2);
});
it("keeps attachment-only messages actionable without offering an empty copy", async () => {
  const { message } = chatFixture(randomUUID);
  const remove = vi.fn();
  await mount({
    messages: [{ ...message, text: "" }],
    onDeleteMessage: remove,
  });
  expect(buttons()).toHaveLength(1);
  await act(async () => buttons()[0]!.props.onPress());
  const [options, choose] = native.sheet.mock.calls.at(-1)!;
  expect(options.options).toEqual(["Supprimer", "Annuler"]);
  choose(1);
  expect(remove).not.toHaveBeenCalled();
});
it("does not expose message actions during generation", async () => {
  await mount({ status: "GENERATING" });
  expect(buttons()).toHaveLength(0);
});
it("does not offer actions without the host deletion handler", async () => {
  await mount({ onDeleteMessage: undefined });
  expect(buttons()).toHaveLength(0);
});
