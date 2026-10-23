import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyProductDraft } from "./product-editor-service";
import { useProductEditor } from "./use-product-editor";

const runtime = vi.hoisted(() => ({
  session: { user: { id: "owner-a" }, stores: [{ storeId: "store-a" }] } as {
    user: { id: string };
    stores: { storeId: string }[];
  } | null,
  sqlite: { getFirstAsync: vi.fn(async () => null) },
  productId: undefined as string | undefined,
  save: vi.fn(),
}));
vi.mock("expo-router", () => ({
  useFocusEffect: (cb: () => void | (() => void)) => useEffect(cb, [cb]),
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "unused" }));
vi.mock("../auth/auth-provider", () => ({
  useAuth: () => ({ session: runtime.session }),
}));
vi.mock("../providers/database-provider", () => ({
  useLocalDatabase: () => ({ sqlite: runtime.sqlite, deviceId: "device-a" }),
}));
vi.mock("../sync/sync-provider", () => ({
  useSync: () => ({ status: "offline", pendingCount: 0 }),
}));
vi.mock("./product-editor-service", async (original) => ({
  ...(await original<typeof import("./product-editor-service")>()),
  saveProductEditorLocally: runtime.save,
}));

let value: ReturnType<typeof useProductEditor>,
  renderer: ReactTestRenderer | undefined;
function Probe() {
  value = useProductEditor(runtime.productId);
  return null;
}
async function render() {
  await act(async () => {
    if (renderer) renderer.update(createElement(Probe));
    else renderer = create(createElement(Probe));
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      original(...args);
  });
  runtime.session = {
    user: { id: "owner-a" },
    stores: [{ storeId: "store-a" }],
  };
  runtime.save.mockReset();
  runtime.productId = undefined;
  runtime.save.mockResolvedValue("saved-id");
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

it.each(["owner", "store", "logout", "unmount", "product"] as const)(
  "rejects a retained save handler after %s changes instead of writing through its stale session",
  async (mode) => {
    await render();
    const oldSave = value.save;
    if (mode === "unmount") {
      await act(async () => renderer!.unmount());
      renderer = undefined;
    } else {
      if (mode === "product") runtime.productId = "other-product";
      runtime.session =
        mode === "logout"
          ? null
          : {
              user: { id: mode === "owner" ? "owner-b" : "owner-a" },
              stores: [{ storeId: mode === "store" ? "store-b" : "store-a" }],
            };
      await render();
    }
    await expect(
      oldSave({ ...emptyProductDraft, label: "Poire" }),
    ).rejects.toThrow("PRODUCT_EDITOR_SCOPE_CHANGED");
    expect(runtime.save).not.toHaveBeenCalled();
  },
);

it("passes current-session authority into a delayed writer and cancels it after a same-store owner switch", async () => {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  runtime.save.mockImplementation(async (_db, _draft, options) => {
    await wait;
    options.assertCurrentScope();
    return "saved-id";
  });
  await render();
  const pending = value.save({ ...emptyProductDraft, label: "Poire" });
  const rejected = expect(pending).rejects.toThrow(
    "PRODUCT_EDITOR_SCOPE_CHANGED",
  );
  runtime.session!.user = { id: "owner-b" };
  await render();
  release();
  await rejected;
  expect(runtime.save).toHaveBeenCalledTimes(1);
});

it("allows an unchanged offline session to save without a network or token check", async () => {
  await render();
  const retainedSave = value.save;
  runtime.session = {
    user: { id: "owner-a" },
    stores: [{ storeId: "store-a" }],
  };
  await render();
  await expect(
    retainedSave({ ...emptyProductDraft, label: "Poire" }),
  ).resolves.toBe("saved-id");
  expect(runtime.save).toHaveBeenCalledTimes(1);
  const options = runtime.save.mock.calls[0]![2];
  expect(options.storeId).toBe("store-a");
  expect(() => options.assertCurrentScope()).not.toThrow();
});
