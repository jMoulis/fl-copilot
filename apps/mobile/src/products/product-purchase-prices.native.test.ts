import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, it, expect, vi } from "vitest";
import { ProductPurchasePrices } from "./product-purchase-prices";
import type { PurchasePriceRow } from "./purchase-price-repository";
const state = vi.hoisted(() => ({
  rows: [] as PurchasePriceRow[],
  manager: true,
  confirm: vi.fn(),
  alert: vi.fn(),
}));
vi.mock("react-native", () => ({
  Text: "Text",
  View: "View",
  Alert: { alert: state.alert },
}));
vi.mock("expo-router", () => ({
  useFocusEffect: (cb: () => void | (() => void)) => useEffect(cb, [cb]),
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "id" }));
vi.mock("../components/ui", () => ({
  SectionCard: "SectionCard",
  InlineAlert: "InlineAlert",
  SecondaryButton: "Button",
}));
vi.mock("../documents/source-original-button", () => ({
  SourceOriginalButton: "Source",
}));
vi.mock("../providers/database-provider", () => ({
  useLocalDatabase: () => ({ sqlite: mockDb }),
}));
vi.mock("../auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      user: { id: "owner" },
      stores: [
        { storeId: "store", role: state.manager ? "MANAGER" : "VIEWER" },
      ],
    },
  }),
}));
vi.mock("../sync/sync-provider", () => ({
  useSync: () => ({ status: "offline" }),
}));
vi.mock("./purchase-price-repository", () => ({
  PurchasePriceRepository: class {
    history = async () => state.rows;
    confirm = state.confirm;
  },
}));
const mockDb = {};
let tree: ReactTestRenderer | undefined;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(async () => {
  if (tree) await act(() => tree!.unmount());
  tree = undefined;
  state.rows = [];
  state.manager = true;
  vi.clearAllMocks();
});
const row: PurchasePriceRow = {
  id: "p",
  amount: "0.001",
  unit: "KG",
  business_date: "2026-11-14",
  price_status: "TO_VERIFY",
  source_document_id: "source",
  sync_state: "PENDING",
  version: 1,
};
it("retains precision, dated source and offline status, requires confirmation and hides it for viewers/unknown units", async () => {
  state.rows = [row];
  await act(async () => {
    tree = create(
      createElement(ProductPurchasePrices, {
        storeId: "store",
        productId: "product",
      }),
    );
  });
  const text = JSON.stringify(tree!.toJSON());
  expect(text).toContain("0,001");
  expect(text).toContain("exclu des calculs");
  expect(text).toContain("À synchroniser");
  expect(
    tree!.root.find((n) => String(n.type) === "Source").props.sourceDocumentId,
  ).toBe("source");
  const confirm = () =>
    tree!.root.findAll(
      (n) => String(n.type) === "Button" && n.props.label === "Confirmer ce PA",
    );
  await act(() => confirm()[0]!.props.onPress());
  expect(state.confirm).not.toHaveBeenCalled();
  expect(state.alert).toHaveBeenCalledOnce();
  state.manager = false;
  await act(() =>
    tree!.update(
      createElement(ProductPurchasePrices, {
        storeId: "store",
        productId: "product",
      }),
    ),
  );
  expect(confirm()).toHaveLength(0);
});
it("shows an honest empty state without a fabricated zero price", async () => {
  await act(async () => {
    tree = create(
      createElement(ProductPurchasePrices, {
        storeId: "store",
        productId: "product",
      }),
    );
  });
  expect(JSON.stringify(tree!.toJSON())).toContain("Aucun PA importé");
  expect(tree!.root.findAll((n) => String(n.type) === "Source")).toHaveLength(
    0,
  );
});
it("shows temporary off-base state without presenting 999 as a price or allowing confirmation", async () => {
  state.rows = [
    {
      ...row,
      amount: "0.01",
      selling_price_ttc: "999",
      vat_rate: "5.5",
      reference_status: "TEMPORARILY_UNAVAILABLE",
    },
  ];
  await act(async () => {
    tree = create(
      createElement(ProductPurchasePrices, {
        storeId: "store",
        productId: "product",
      }),
    );
  });
  const text = JSON.stringify(tree!.toJSON());
  expect(text).toContain("Prix indisponibles");
  expect(text).toContain("temporairement hors base");
  expect(text).not.toContain("999");
  expect(
    tree!.root.findAll(
      (n) => String(n.type) === "Button" && n.props.label === "Confirmer ce PA",
    ),
  ).toHaveLength(0);
});
