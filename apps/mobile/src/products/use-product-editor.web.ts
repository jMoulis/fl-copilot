import type {
  ProductEditorState,
  ProductListState,
} from "./product-editor-hooks.types";

export function useProductList(): ProductListState {
  return {
    loading: false,
    storeMissing: false,
    products: [],
    refresh: async () => undefined,
  };
}

export function useProductEditor(productId?: string): ProductEditorState {
  return {
    loading: false,
    missing: Boolean(productId && productId !== "new"),
    storeMissing: false,
    save: async () => {
      return productId ?? "new";
    },
  };
}
