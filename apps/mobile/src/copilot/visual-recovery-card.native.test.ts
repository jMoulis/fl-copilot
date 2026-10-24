import { createElement, useEffect, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { visualRecoveryActionFixture } from "../../../../scripts/test-visual-recovery-action-fixtures";
import { VisualRecoveryCard } from "./visual-recovery-card";
const runtime = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
  Image: "Image",
  ActivityIndicator: "Spinner",
}));
vi.mock("expo-router", () => ({
  useFocusEffect: (fn: () => void | (() => void)) => useEffect(fn, [fn]),
}));
vi.mock("../providers/database-provider", () => ({
  useLocalDatabase: () => ({ sqlite: runtime.db }),
}));
vi.mock("../components/ui", () => ({
  InlineAlert: ({ title, message }: { title: string; message: string }) =>
    createElement("Text", {}, `${title}: ${message}`),
  SectionCard: ({ title, children }: { title: string; children: ReactNode }) =>
    createElement("View", {}, title, children),
  PrimaryButton: ({ label, ...props }: { label: string }) =>
    createElement("Pressable", { ...props, accessibilityLabel: label }, label),
  SecondaryButton: ({ label, ...props }: { label: string }) =>
    createElement("Pressable", { ...props, accessibilityLabel: label }, label),
}));
let tree: ReactTestRenderer | undefined,
  s: Awaited<ReturnType<typeof visualRecoveryActionFixture>> | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const error = console.error;
  vi.spyOn(console, "error").mockImplementation((...args) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      error(...args);
  });
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
  s?.db.raw.close();
  s = undefined;
  vi.restoreAllMocks();
});
function button(label: string) {
  return tree!.root.findAll(
    (n) =>
      String(n.type) === "Pressable" && n.props.accessibilityLabel === label,
  )[0]!;
}
async function press(label: string) {
  await act(async () => {
    button(label).props.onPress();
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
}
async function mount() {
  s = await visualRecoveryActionFixture();
  runtime.db = s.db;
  const props = {
    message: s.message,
    controller: s.controller,
    canConfirm: true,
    onSaved: vi.fn(),
    retryFile: vi.fn(async () => {}),
  };
  await act(async () => {
    tree = create(createElement(VisualRecoveryCard, props));
  });
  await vi.waitFor(() => expect(button("Photo à reprendre")).toBeDefined());
  return props;
}
async function selectRetry() {
  await press("Photo à reprendre");
  await press("Retenter ce choix");
}
async function authorize() {
  await press("Je confirme disposer des droits d’utilisation de cette photo.");
  await press("J’ai relu ce choix et je confirme cette reprise.");
}
it("reuses the manual choices and requires separate rights and comparison before canonical recovery", async () => {
  const props = await mount();
  await selectRetry();
  expect(button("Confirmer la reprise").props.disabled).toBe(true);
  await press("J’ai relu ce choix et je confirme cette reprise.");
  expect(button("Confirmer la reprise").props.disabled).toBe(true);
  await press("Je confirme disposer des droits d’utilisation de cette photo.");
  expect(button("Confirmer la reprise").props.disabled).toBe(false);
  await press("Confirmer la reprise");
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
    expect(
      s!.db.raw.prepare("SELECT COUNT(*) n FROM copilot_tool_results").get()!.n,
      JSON.stringify(tree!.toJSON()),
    ).toBe(1);
  });
  expect(props.onSaved).toHaveBeenCalledTimes(1);
  expect(props.retryFile).toHaveBeenCalledWith(s!.targetId);
  expect(JSON.stringify(tree!.toJSON())).toContain("Reprise enregistrée");
});
it("refuses a retained confirmation after role loss and ABA return without changing the pending failure", async () => {
  const props = await mount();
  await selectRetry();
  await authorize();
  const old = button("Confirmer la reprise").props.onPress;
  await act(async () =>
    tree!.update(
      createElement(VisualRecoveryCard, { ...props, canConfirm: false }),
    ),
  );
  await act(async () => old());
  expect(
    s!.db.raw.prepare("SELECT COUNT(*) n FROM copilot_tool_results").get()!.n,
  ).toBe(0);
  await act(async () => tree!.update(createElement(VisualRecoveryCard, props)));
  await vi.waitFor(() => expect(button("Photo à reprendre")).toBeDefined());
  await act(async () => old());
  expect(
    s!.db.raw.prepare("SELECT COUNT(*) n FROM copilot_tool_results").get()!.n,
  ).toBe(0);
  expect(
    (await s!.library.get("visual_asset", s!.f.storeId, s!.targetId))!
      .syncState,
  ).toBe("ERROR");
});
it("keeps a committed decision successful when subsequent file retry or notification fails", async () => {
  const props = await mount();
  props.onSaved.mockImplementation(() => {
    throw Error("NAVIGATION_FAILED");
  });
  props.retryFile.mockRejectedValueOnce(Error("UPLOAD_UNAVAILABLE"));
  await selectRetry();
  await authorize();
  await press("Confirmer la reprise");
  await vi.waitFor(() =>
    expect(JSON.stringify(tree!.toJSON())).toContain(
      "Fichier encore en attente",
    ),
  );
  expect(JSON.stringify(tree!.toJSON())).toContain("Reprise enregistrée");
  expect(JSON.stringify(tree!.toJSON())).not.toContain(
    "La reprise n’a pas été appliquée",
  );
  expect(
    s!.db.raw.prepare("SELECT COUNT(*) n FROM visual_conflict_history").get()!
      .n,
  ).toBe(1);
});
it("does not reuse a checkbox from a previous local comparison", async () => {
  await mount();
  await selectRetry();
  const old = button("J’ai relu ce choix et je confirme cette reprise.").props
    .onPress;
  await press("Relire les choix locaux");
  await vi.waitFor(() =>
    expect(button("Photo à reprendre").props.disabled).toBe(false),
  );
  await selectRetry();
  await act(async () => old());
  expect(button("Confirmer la reprise").props.disabled).toBe(true);
  expect(
    s!.db.raw.prepare("SELECT COUNT(*) n FROM copilot_tool_results").get()!.n,
  ).toBe(0);
});
it("preserves the selected review and consents on an identical message reread, without another SQLite review", async () => {
  const props = await mount();
  await selectRetry();
  await authorize();
  const read = vi.spyOn(props.controller, "openRecovery");
  expect(button("Confirmer la reprise").props.disabled).toBe(false);
  await act(async () => {
    tree!.update(
      createElement(VisualRecoveryCard, {
        ...props,
        message: { ...props.message },
      }),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
  expect(read).not.toHaveBeenCalled();
  expect(button("Confirmer la reprise").props.disabled).toBe(false);
});
