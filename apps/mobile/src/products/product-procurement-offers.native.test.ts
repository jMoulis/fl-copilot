import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { procurementLinksFixture } from "../../../../scripts/test-procurement-links-fixtures";
import { ProductProcurementOffers } from "./product-procurement-offers";
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  storeId: "",
  ownerId: "",
  manager: true,
  push: vi.fn(),
}));
vi.mock("react-native", () => ({
  Text: "Text",
  View: "View",
  Pressable: "Pressable",
}));
vi.mock("expo-router", () => ({
  useIsFocused: () => true,
  router: { push: state.push },
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => randomUUID() }));
vi.mock("../auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      user: { id: state.ownerId },
      stores: [
        { storeId: state.storeId, role: state.manager ? "MANAGER" : "VIEWER" },
      ],
    },
  }),
}));
vi.mock("../providers/database-provider", () => ({
  useLocalDatabase: () => ({ sqlite: state.db, deviceId: state.storeId }),
}));
vi.mock("../sync/sync-provider", () => ({
  useSync: () => ({ lastSyncedAt: null }),
}));
vi.mock("../sync/outbox-repository", async (original) => ({
  ...(await original<object>()),
  subscribeOutboxChanges: () => () => {},
}));
vi.mock("../components/ui", () => ({
  SectionCard: "Card",
  InlineAlert: "Alert",
  PrimaryButton: "Button",
  SecondaryButton: "Button",
  BottomSheet: ({
    children,
    visible,
    footer,
    ...props
  }: {
    children: ReactNode;
    visible: boolean;
    footer: ReactNode;
  }) =>
    createElement(
      "Sheet",
      { ...props, visible },
      visible ? [children, footer] : null,
    ),
}));
vi.mock("../documents/source-original-button", () => ({
  SourceOriginalButton: "Source",
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let tree: ReactTestRenderer | undefined,
  dispose: (() => void) | undefined,
  client: QueryClient;
afterEach(async () => {
  if (tree) await act(() => tree!.unmount());
  client?.clear();
  dispose?.();
  tree = undefined;
  state.manager = true;
  vi.clearAllMocks();
});
const button = (label: string) =>
  tree!.root.find(
    (n) => String(n.type) === "Button" && n.props.label === label,
  );
it("reads dated offers offline, reopens dismissed sheets and saves only chosen enrichment with historical unit preserved", async () => {
  const f = await procurementLinksFixture();
  dispose = () => f.device.raw.close();
  await f.links.confirmBatch([f.link], f.context());
  f.device.raw
    .prepare("UPDATE products SET nature='UNKNOWN',category='UNKNOWN'")
    .run();
  state.db = f.device;
  state.storeId = f.product.storeId;
  state.ownerId = f.ownerId;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const changed = vi.fn(async () => {});
  await act(async () => {
    tree = create(
      createElement(
        QueryClientProvider,
        { client },
        createElement(ProductProcurementOffers, {
          storeId: state.storeId,
          productId: f.product.id,
          onChanged: changed,
        }),
      ),
    );
  });
  const rows = () =>
    tree!.root.findAll(
      (n) =>
        String(n.type) === "Pressable" &&
        n.props.accessibilityLabel?.startsWith("Détails de"),
    );
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(rows()).toHaveLength(2);
  });
  const text = JSON.stringify(tree!.toJSON());
  expect(text).toContain("Tarif de commande");
  expect(text).not.toContain("€/kg");
  await act(() => rows()[0]!.props.onPress());
  expect(tree!.root.find((n) => String(n.type) === "Sheet").props.visible).toBe(
    true,
  );
  await act(() =>
    tree!.root.find((n) => String(n.type) === "Sheet").props.onClose(),
  );
  await act(() => rows()[1]!.props.onPress());
  expect(tree!.root.find((n) => String(n.type) === "Sheet").props.visible).toBe(
    true,
  );
  await act(() =>
    tree!.root.find((n) => String(n.type) === "Sheet").props.onClose(),
  );
  await act(() => button("Compléter cette fiche").props.onPress());
  await act(async () => {
    button("Confirmer ces attributs").props.onPress();
    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
  });
  expect(
    f.device.raw.prepare("SELECT nature,sales_unit FROM products").get(),
  ).toEqual({ nature: "BULK", sales_unit: "KG" });
  expect(
    f.device.raw
      .prepare("SELECT COUNT(*) n FROM purchase_price_observations")
      .get(),
  ).toEqual({ n: 0 });
});
