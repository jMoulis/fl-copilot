import { createElement, type ElementType, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  EmailProcessingControls,
  type EmailProcessingControlsPort,
} from "./email-processing-controls";

vi.mock("react-native", () => ({ Text: "Text", View: "View" }));
vi.mock("../components/ui", () => ({
  SecondaryButton: (props: { label: string; children?: ReactNode }) =>
    createElement("Button", props),
  InlineAlert: (props: { title: string; message: string }) =>
    createElement("Alert", props),
}));
let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      original(...args);
  });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
  vi.restoreAllMocks();
});
const original = {
  conversationId: "conversation",
  receiptId: "receipt",
  fileId: "file",
};
function inbox() {
  return {
    processingState: vi.fn(
      async () =>
        ({
          status: "COMPLETED",
          attempts: 1,
          code: null,
          nextAttemptAt: null,
        }) as const,
    ),
    mercalysResult: vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValue("batch"),
    retryProcessing: vi.fn(async () => {}),
    setPurpose: vi.fn(async () => {}),
    cancelProcessing: vi.fn(async () => {}),
  } satisfies EmailProcessingControlsPort;
}
function link() {
  return renderer!.root
    .findAllByType("Button" as ElementType)
    .find((n) => n.props.label === "Ouvrir l’import Mercalys");
}
it("opens only a still-available result on demand without restarting processing, and hides an unavailable target", async () => {
  const port = inbox(),
    open = vi.fn();
  await act(async () => {
    renderer = create(
      createElement(EmailProcessingControls, {
        inbox: port,
        original,
        onOpenMercalys: open,
      }),
    );
  });
  expect(open).not.toHaveBeenCalled();
  await act(async () => link()!.props.onPress());
  expect(open).toHaveBeenCalledExactlyOnceWith("batch");
  expect(port.retryProcessing).not.toHaveBeenCalled();
  expect(port.setPurpose).not.toHaveBeenCalled();
  expect(port.cancelProcessing).not.toHaveBeenCalled();
  port.mercalysResult.mockResolvedValue(null);
  await act(async () => link()!.props.onPress());
  expect(open).toHaveBeenCalledTimes(1);
  expect(renderer!.root.findAllByType("Alert" as ElementType)).toHaveLength(1);
  await act(async () => {
    renderer!.update(
      createElement(EmailProcessingControls, {
        inbox: port,
        original,
        onOpenMercalys: open,
        revision: "refresh",
      }),
    );
  });
  expect(link()).toBeUndefined();
});
it("discards a delayed navigation and its reload when the inbox context changes", async () => {
  const old = inbox(),
    next = inbox(),
    open = vi.fn();
  next.mercalysResult.mockResolvedValue(null);
  await act(async () => {
    renderer = create(
      createElement(EmailProcessingControls, {
        inbox: old,
        original,
        onOpenMercalys: open,
      }),
    );
  });
  let release!: (value: string) => void;
  old.mercalysResult.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await act(async () => link()!.props.onPress());
  await act(async () => {
    renderer!.update(
      createElement(EmailProcessingControls, {
        inbox: next,
        original,
        onOpenMercalys: open,
      }),
    );
  });
  await act(async () => release("batch"));
  expect(open).not.toHaveBeenCalled();
  expect(old.mercalysResult).toHaveBeenCalledTimes(2);
  expect(next.mercalysResult).toHaveBeenCalledTimes(1);
  expect(link()).toBeUndefined();
});
it("keeps the existing result on a failed refresh and performs one read per explicit retry", async () => {
  const port = inbox();
  await act(async () => {
    renderer = create(
      createElement(EmailProcessingControls, {
        inbox: port,
        original,
        onOpenMercalys: vi.fn(),
      }),
    );
  });
  port.processingState.mockRejectedValueOnce(Error("offline"));
  await act(async () => {
    renderer!.update(
      createElement(EmailProcessingControls, {
        inbox: port,
        original,
        onOpenMercalys: vi.fn(),
        revision: "refresh",
      }),
    );
  });
  expect(link()).toBeDefined();
  const retry = () =>
    renderer!.root
      .findAllByType("Button" as ElementType)
      .find((n) => n.props.label === "Relire l’état du fichier")!;
  port.processingState.mockRejectedValueOnce(Error("still offline"));
  await act(async () => retry().props.onPress());
  expect(renderer!.root.findAllByType("Alert" as ElementType)).toHaveLength(1);
  await act(async () => retry().props.onPress());
  expect(renderer!.root.findAllByType("Alert" as ElementType)).toHaveLength(0);
  expect(port.processingState).toHaveBeenCalledTimes(4);
});
