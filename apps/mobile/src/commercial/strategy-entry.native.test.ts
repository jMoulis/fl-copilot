import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CommercialStrategyEntry } from "./strategy-entry";
const runtime = vi.hoisted(() => ({
  sqlite: {},
  focused: true,
  push: vi.fn(),
  create: vi.fn(),
  open: vi.fn(),
  attachPdf: vi.fn(),
  appendIntakeQuestion: vi.fn(),
}));
vi.mock("react-native", () => ({ Text: "Text" }));
vi.mock("expo-router", () => ({
  router: { push: runtime.push },
  useFocusEffect: (callback: () => void | (() => void)) => {
    const focused = runtime.focused;
    useEffect(() => (focused ? callback() : undefined), [callback, focused]);
  },
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000001",
}));
vi.mock("../providers/database-provider", () => ({
  useLocalDatabase: () => ({ sqlite: runtime.sqlite, deviceId: "device" }),
}));
vi.mock("../copilot/conversation-repository", () => ({
  CopilotConversationRepository: class {},
}));
vi.mock("../copilot/local-chat-controller", () => ({
  CopilotLocalChatController: class {
    create = runtime.create;
    open = runtime.open;
    attachPdf = runtime.attachPdf;
    appendIntakeQuestion = runtime.appendIntakeQuestion;
  },
}));
vi.mock("../components/ui", () => ({
  SectionCard: "Card",
  PrimaryButton: "Primary",
  SecondaryButton: "Secondary",
  InlineAlert: "Alert",
}));
vi.mock("../components/date-selector", () => ({
  DateSelector: "DateSelector",
}));
let tree: ReactTestRenderer | undefined;
const props = {
  sourceDocumentId: "00000000-0000-4000-8000-000000000002",
  storeId: "store",
  ownerId: "owner",
  initialWeekStart: "2026-11-02",
  onDetails: vi.fn(),
};
const primary = () => tree!.root.find((n) => String(n.type) === "Primary");
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  runtime.focused = true;
  for (const mock of [
    runtime.push,
    runtime.create,
    runtime.open,
    runtime.attachPdf,
    runtime.appendIntakeQuestion,
  ])
    mock.mockReset();
  runtime.create.mockResolvedValue({ id: "conversation" });
  runtime.open.mockResolvedValue({});
  runtime.attachPdf.mockResolvedValue({});
  runtime.appendIntakeQuestion.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  await act(() => tree?.unmount());
  tree = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("opens one editable exact-source conversation for a chosen week and never creates work during render", async () => {
  await act(() => {
    tree = create(createElement(CommercialStrategyEntry, props));
  });
  expect(runtime.create).not.toHaveBeenCalled();
  await act(() =>
    tree!.root
      .find((n) => String(n.type) === "DateSelector")
      .props.onConfirm("2026-11-17"),
  );
  await act(async () => {
    primary().props.onPress();
    primary().props.onPress();
  });
  expect(runtime.create).toHaveBeenCalledTimes(1);
  expect(runtime.attachPdf).toHaveBeenCalledWith(
    "conversation",
    props.sourceDocumentId,
  );
  expect(runtime.appendIntakeQuestion.mock.calls[0]![1]).toContain(
    "16/11/2026",
  );
  expect(runtime.push).toHaveBeenCalledWith({
    pathname: "/copilot",
    params: { conversationId: "conversation" },
  });
});
it("does not navigate after leaving while local preparation is pending and permits reopening the same draft", async () => {
  let release!: (value: unknown) => void;
  runtime.attachPdf.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await act(() => {
    tree = create(createElement(CommercialStrategyEntry, props));
  });
  await act(async () => primary().props.onPress());
  runtime.focused = false;
  await act(() => tree!.update(createElement(CommercialStrategyEntry, props)));
  await act(async () => release({}));
  expect(runtime.push).not.toHaveBeenCalled();
  runtime.focused = true;
  await act(() => tree!.update(createElement(CommercialStrategyEntry, props)));
  await act(async () => primary().props.onPress());
  expect(runtime.create).toHaveBeenCalledTimes(1);
  expect(runtime.push).toHaveBeenCalledTimes(1);
});
