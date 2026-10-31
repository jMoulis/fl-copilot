import { createElement, useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { it, expect, vi } from "vitest";
import { analyzeExplorerProducts } from "@fl-copilot/analytics-core";
import {
  defaultAnalyticsProductList,
  emptyExplorerFilters,
  type AnalyticsProductList,
} from "@fl-copilot/domain";
import { ExplorerBreakdown } from "./explorer-breakdown";
vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
}));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Icon" }));
vi.mock("../components/ui", () => ({
  InlineAlert: "Alert",
  SecondaryButton: "Button",
}));
vi.mock("../products/linked-product-visual", () => ({
  LinkedProductVisual: () => null,
}));
it("uses accessible real controls to select declines, percentage and reverse order while retaining the selected scope", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const priorError = console.error;
  const silence = vi
    .spyOn(console, "error")
    .mockImplementation((...args: unknown[]) => {
      if (!String(args[0]).includes("react-test-renderer is deprecated"))
        priorError(...args);
    });
  const storeId = "00000000-0000-4000-8000-000000000001",
    productId = "00000000-0000-4000-8000-000000000002";
  const changes = vi.fn(),
    onProduct = vi.fn();
  let tree: ReactTestRenderer | undefined;
  function Harness() {
    const [productList, setList] = useState<AnalyticsProductList>(
      defaultAnalyticsProductList(),
    );
    const points = [
      {
        storeId,
        productId,
        businessDate: "2026-10-23",
        sales: { value: "50", status: "AVAILABLE" as const },
        margin: { value: null, status: "UNAVAILABLE" as const },
        waste: { value: null, status: "UNAVAILABLE" as const },
      },
      {
        storeId,
        productId,
        businessDate: "2025-10-24",
        sales: { value: "100", status: "AVAILABLE" as const },
        margin: { value: null, status: "UNAVAILABLE" as const },
        waste: { value: null, status: "UNAVAILABLE" as const },
      },
    ];
    const filters = emptyExplorerFilters();
    const details = analyzeExplorerProducts({
      storeId,
      period: { kind: "day", date: "2026-10-23" },
      today: "2026-10-31",
      metric: "sales",
      filters,
      products: [
        { id: productId, label: "Poire", category: "FRUIT", nature: "BULK" },
      ],
      points,
      productList,
    });
    return createElement(ExplorerBreakdown, {
      data: {
        ...details.analysis,
        details,
        filters,
        detailsUnavailable: false,
      },
      productList,
      onProductList: (next) => {
        changes(next);
        setList(next);
      },
      onCategory: vi.fn(),
      onProduct,
      onOpenProduct: vi.fn(),
      onPage: vi.fn(),
    });
  }
  try {
    await act(() => {
      tree = create(createElement(Harness));
    });
    const find = (label: string) =>
      tree!.root.findAll(
        (n) =>
          String(n.type) === "Pressable" &&
          n.props.accessibilityLabel === label,
      )[0];
    await act(() => find("Évolution des produits : En baisse").props.onPress());
    expect(changes).toHaveBeenLastCalledWith({
      trend: "DOWN",
      sort: "DIFFERENCE",
      direction: "ASC",
    });
    expect(JSON.stringify(tree!.toJSON())).toContain("−50");
    await act(() =>
      find("Trier les produits par : Évolution %").props.onPress(),
    );
    expect(changes).toHaveBeenLastCalledWith({
      trend: "DOWN",
      sort: "PERCENTAGE",
      direction: "ASC",
    });
    await act(() =>
      tree!.root
        .findAll(
          (n) =>
            String(n.type) === "Button" &&
            n.props.accessibilityLabel === "Inverser l’ordre des produits",
        )[0]
        .props.onPress(),
    );
    expect(changes).toHaveBeenLastCalledWith({
      trend: "DOWN",
      sort: "PERCENTAGE",
      direction: "DESC",
    });
    await act(() =>
      tree!.root
        .findAll(
          (n) =>
            String(n.type) === "Pressable" &&
            String(n.props.accessibilityLabel).startsWith("Explorer : Poire"),
        )[0]
        .props.onPress(),
    );
    expect(onProduct).toHaveBeenCalledWith(productId);
    await act(() =>
      find("Évolution des produits : Sans comparaison").props.onPress(),
    );
    expect(JSON.stringify(tree!.toJSON())).toContain(
      "Aucun produit ne correspond",
    );
  } finally {
    await act(() => tree?.unmount());
    silence.mockRestore();
    vi.unstubAllGlobals();
  }
});
