import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import { EmailSenderSettings } from "./email-sender-settings";
vi.mock("react-native", () => ({
  Text: "Text",
  View: "View",
  TextInput: "Input",
}));
vi.mock("../components/ui", () => ({
  PrimaryButton: "Button",
  SecondaryButton: "Button",
  InlineAlert: "Alert",
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let tree: ReactTestRenderer | undefined;
const id = "00000000-0000-4000-8000-000000000001";
const policy = {
  storeId: id,
  bindingId: id,
  version: 0,
  allowedSenders: ["personal@example.test"],
};
const hosts = (tag: string) =>
  tree!.root.findAll((n) => typeof n.type === "string" && n.type === tag);
const button = (label: string) =>
  hosts("Button").find((n) => n.props.label === label)!;
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
});
it("loads settings on demand, validates exact addresses and saves the observed policy version", async () => {
  const inbox = {
    senderPolicy: vi.fn(async () => policy),
    updateSenderPolicy: vi.fn(async (input) => ({
      ...policy,
      version: 1,
      allowedSenders: input.allowedSenders,
    })),
  };
  await act(async () => {
    tree = create(createElement(EmailSenderSettings, { inbox, bindingId: id }));
  });
  expect(inbox.senderPolicy).not.toHaveBeenCalled();
  await act(async () =>
    button("Gérer les expéditeurs autorisés").props.onPress(),
  );
  await act(async () =>
    hosts("Input")[0]!.props.onChangeText("*@example.test"),
  );
  await act(async () => button("Enregistrer les expéditeurs").props.onPress());
  expect(inbox.updateSenderPolicy).not.toHaveBeenCalled();
  await act(async () =>
    hosts("Input")[0]!.props.onChangeText(
      "personal@example.test\nWork@Example.test",
    ),
  );
  await act(async () => button("Enregistrer les expéditeurs").props.onPress());
  expect(inbox.updateSenderPolicy).toHaveBeenCalledExactlyOnceWith({
    bindingId: id,
    expectedVersion: 0,
    allowedSenders: ["personal@example.test", "work@example.test"],
  });
  expect(JSON.stringify(tree!.toJSON())).toContain("Expéditeurs enregistrés.");
});
it("preserves an unsaved draft after a rejected save and ignores an old binding's delayed response", async () => {
  let resolve!: (value: typeof policy) => void;
  const inbox = {
    senderPolicy: vi.fn(async () => policy),
    updateSenderPolicy: vi.fn(async () => {
      throw Error("conflict");
    }),
  };
  await act(async () => {
    tree = create(createElement(EmailSenderSettings, { inbox, bindingId: id }));
  });
  await act(async () =>
    button("Gérer les expéditeurs autorisés").props.onPress(),
  );
  await act(async () =>
    hosts("Input")[0]!.props.onChangeText("work@example.test"),
  );
  await act(async () => button("Enregistrer les expéditeurs").props.onPress());
  expect(hosts("Input")[0]!.props.value).toBe("work@example.test");
  expect(hosts("Alert")).toHaveLength(1);
  inbox.senderPolicy.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await act(async () => button("Actualiser la liste").props.onPress());
  await act(async () => {
    tree!.update(
      createElement(EmailSenderSettings, {
        inbox,
        bindingId: "00000000-0000-4000-8000-000000000002",
      }),
    );
  });
  await act(async () => resolve(policy));
  expect(hosts("Input")).toHaveLength(0);
  expect(button("Gérer les expéditeurs autorisés")).toBeDefined();
});
