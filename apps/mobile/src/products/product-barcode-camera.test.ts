import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ProductBarcodeCamera from "./product-barcode-camera";
import { CameraView } from "expo-camera";
import { InlineAlert } from "../components/ui";
import { Linking } from "react-native";
import type { BarcodeLookupResult } from "./product-barcode-lookup";

const native = vi.hoisted(() => ({
  permission: { granted: true, canAskAgain: true },
  request: vi.fn(async () => undefined),
  refresh: vi.fn(async () => undefined),
  change: undefined as ((state: string) => void) | undefined,
  remove: vi.fn(),
}));
vi.mock("react-native", () => ({
  Text: "Text",
  View: "View",
  ActivityIndicator: "ActivityIndicator",
  Modal: "Modal",
  AppState: {
    currentState: "active",
    addEventListener: (_: string, listener: (state: string) => void) => {
      native.change = listener;
      return { remove: native.remove };
    },
  },
  Linking: { openSettings: vi.fn(async () => undefined) },
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
}));
vi.mock("expo-camera", () => ({
  CameraView: "CameraView",
  useCameraPermissions: () => [
    native.permission,
    native.request,
    native.refresh,
  ],
}));
vi.mock("../components/ui", () => ({
  PrimaryButton: "PrimaryButton",
  SecondaryButton: "SecondaryButton",
  InlineAlert: "InlineAlert",
}));
vi.mock("../components/dashboard", () => ({ IconButton: "IconButton" }));
let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  native.permission = { granted: true, canAskAgain: true };
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      original(...args);
  });
});
afterEach(async () => {
  await act(() => tree?.unmount());
  tree = undefined;
  vi.unstubAllGlobals();
});
async function mount(lookup: (code: string) => Promise<BarcodeLookupResult>) {
  const onFound = vi.fn(),
    onClose = vi.fn();
  await act(() => {
    tree = create(
      createElement(ProductBarcodeCamera, { lookup, onFound, onClose }),
    );
  });
  return { onFound, onClose };
}
function camera() {
  return tree!.root.findByType(CameraView);
}
function deferred() {
  let resolve!: (result: BarcodeLookupResult) => void;
  const promise = new Promise<BarcodeLookupResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
it("opens a found product once despite repeated camera events", async () => {
  const task = deferred(),
    lookup = vi.fn(() => task.promise);
  const { onFound } = await mount(lookup);
  const read = camera().props.onBarcodeScanned;
  await act(() => {
    read({ data: "3250393062582" });
    read({ data: "3250393062582" });
  });
  expect(lookup).toHaveBeenCalledTimes(1);
  await act(async () => task.resolve({ status: "FOUND", productId: "banana" }));
  expect(onFound).toHaveBeenCalledExactlyOnceWith("banana");
});
it("shows an unknown code without navigation and can scan again", async () => {
  const lookup = vi.fn(async (): Promise<BarcodeLookupResult> => ({
    status: "UNKNOWN",
  }));
  const { onFound } = await mount(lookup);
  await act(async () =>
    camera().props.onBarcodeScanned({ data: "3250393062582" }),
  );
  expect(onFound).not.toHaveBeenCalled();
  expect(tree!.root.findByType(InlineAlert).props.message).toContain(
    "pas encore présent",
  );
  await act(() =>
    tree!.root.findByProps({ label: "Scanner un autre code" }).props.onPress(),
  );
  expect(camera()).toBeTruthy();
});
it.each(["close", "background", "unmount"])(
  "ignores a late database response after %s",
  async (action) => {
    const task = deferred();
    const { onFound, onClose } = await mount(() => task.promise);
    await act(() => camera().props.onBarcodeScanned({ data: "3250393062582" }));
    await act(() => {
      if (action === "close")
        tree!.root.findByProps({ label: "Fermer le scanner" }).props.onPress();
      if (action === "background") native.change?.("background");
      if (action === "unmount") {
        tree!.unmount();
        tree = undefined;
      }
    });
    await act(async () =>
      task.resolve({ status: "FOUND", productId: "banana" }),
    );
    expect(onFound).not.toHaveBeenCalled();
    if (action === "close") expect(onClose).toHaveBeenCalledOnce();
    if (action === "background") {
      await act(() => native.change?.("active"));
      expect(camera()).toBeTruthy();
    }
  },
);
it("requests camera access explicitly and provides settings after refusal", async () => {
  native.permission = { granted: false, canAskAgain: true };
  await mount(vi.fn());
  expect(tree!.root.findAllByType(CameraView)).toHaveLength(0);
  await act(() =>
    tree!.root.findByProps({ label: "Autoriser la caméra" }).props.onPress(),
  );
  expect(native.request).toHaveBeenCalled();
  native.permission = { granted: false, canAskAgain: false };
  await act(() =>
    tree!.update(
      createElement(ProductBarcodeCamera, {
        lookup: vi.fn(),
        onFound: vi.fn(),
        onClose: vi.fn(),
      }),
    ),
  );
  await act(() =>
    tree!.root.findByProps({ label: "Ouvrir les réglages" }).props.onPress(),
  );
  expect(Linking.openSettings).toHaveBeenCalled();
});
