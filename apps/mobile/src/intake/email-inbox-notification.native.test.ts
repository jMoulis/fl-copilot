import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import { EmailInbox } from "./email-inbox";
vi.mock("react-native", async () => {
  const { createElement } = await import("react");
  return {
    Text: "Text",
    View: "View",
    TextInput: "Input",
    Pressable: "Pressable",
    FlatList: (props: { ListHeaderComponent: import("react").ReactNode }) =>
      createElement("List", {}, props.ListHeaderComponent),
  };
});
vi.mock("react-native-safe-area-context", () => ({ SafeAreaView: "SafeArea" }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "unused" }));
vi.mock("../components/ui", () => ({
  PrimaryButton: "Button",
  SecondaryButton: "Button",
  InlineAlert: "Alert",
}));
vi.mock("./email-sender-settings", () => ({ EmailSenderSettings: () => null }));
vi.mock("./email-processing-controls", () => ({
  EmailProcessingControls: () => null,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let tree: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => tree?.unmount());
  tree = undefined;
});
it("rereads the existing inbox after a notification without remounting its unsaved input", async () => {
  const inbox = {
    status: vi.fn(async () => true),
    list: vi.fn(async () => ({ bindings: [], receipts: [] })),
    refresh: vi.fn(async () => null),
  } as unknown as Parameters<typeof EmailInbox>[0]["inbox"];
  const props = {
    inbox,
    conversationId: "11111111-1111-4111-8111-111111111111",
    initialSender: "owner@example.test",
    onClose: () => {},
    onOpenSync: () => {},
  };
  await act(async () => {
    tree = create(createElement(EmailInbox, props));
  });
  const input = () =>
    tree!.root.findAll(
      (n) => typeof n.type === "string" && String(n.type) === "Input",
    )[0]!;
  await act(async () => input().props.onChangeText("draft@example.test"));
  expect(inbox.refresh).toHaveBeenCalledTimes(1);
  await act(async () =>
    tree!.update(
      createElement(EmailInbox, {
        ...props,
        refreshKey: "22222222-2222-4222-8222-222222222222",
      }),
    ),
  );
  expect(inbox.refresh).toHaveBeenCalledTimes(2);
  expect(input().props.value).toBe("draft@example.test");
  await act(async () =>
    tree!.update(
      createElement(EmailInbox, {
        ...props,
        refreshKey: "22222222-2222-4222-8222-222222222222",
      }),
    ),
  );
  expect(inbox.refresh).toHaveBeenCalledTimes(2);
  let release!: (value: null) => void;
  vi.mocked(inbox.refresh).mockReturnValueOnce(
    new Promise<null>((resolve) => {
      release = resolve;
    }),
  );
  const button = () =>
    tree!.root
      .findAll((n) => typeof n.type === "string" && String(n.type) === "Button")
      .find((n) => n.props.label === "Actualiser la réception")!;
  await act(async () => button().props.onPress());
  expect(inbox.refresh).toHaveBeenCalledTimes(3);
  await act(async () =>
    tree!.update(
      createElement(EmailInbox, {
        ...props,
        refreshKey: "33333333-3333-4333-8333-333333333333",
      }),
    ),
  );
  expect(inbox.refresh).toHaveBeenCalledTimes(3);
  await act(async () => release(null));
  expect(inbox.refresh).toHaveBeenCalledTimes(4);
  expect(input().props.value).toBe("draft@example.test");
});
