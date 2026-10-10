import { randomUUID } from "node:crypto";
import { prepareStoreProductEvent } from "../packages/domain/src/index";
export function storeEventFixture() {
  const at = "2026-10-09T10:00:00Z",
    storeId = randomUUID(),
    product = {
      id: randomUUID(),
      storeId,
      label: "Produit test",
      category: "UNKNOWN" as const,
      nature: "UNKNOWN" as const,
      salesUnit: "UNKNOWN" as const,
      status: "ACTIVE" as const,
      version: 1,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    };
  const event = prepareStoreProductEvent(storeId, {
    event: {
      id: randomUUID(),
      productId: product.id,
      type: "OUT_OF_STOCK",
      startedAt: "2026-10-09T09:30:00Z",
      clientCapturedAt: at,
    },
  });
  return { product, event };
}
