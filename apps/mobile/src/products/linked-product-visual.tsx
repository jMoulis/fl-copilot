import type { VisualAsset } from "@fl-copilot/domain";
import { ProductVisual } from "./product-visual";
import {
  resolveLibraryProduct,
  type VisualLibraryState,
} from "./visual-library-state";
export interface SharedProductVisuals {
  state: VisualLibraryState | null;
  readUri(asset: VisualAsset): Promise<string | null>;
}
/** The screen supplies one shared library. Rows never start subscriptions or remote requests. */
export function LinkedProductVisual({
  productId,
  storeId,
  visuals,
  size = 64,
}: {
  productId: string;
  storeId: string;
  visuals: SharedProductVisuals;
  size?: number;
}) {
  const resolution = resolveLibraryProduct(visuals.state, storeId, productId);
  return (
    <ProductVisual
      size={size}
      resolution={resolution}
      category={
        resolution.kind === "PLACEHOLDER"
          ? resolution.category
          : (visuals.state?.products.get(productId)?.entity.category ??
            "UNKNOWN")
      }
      readUri={visuals.readUri}
    />
  );
}
