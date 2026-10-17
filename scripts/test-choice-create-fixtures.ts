import { sourceOffersFixture } from "./test-source-offers-fixtures";
export async function choiceCreateFixture(storeId?: string) {
  const { f, result } = await sourceOffersFixture(storeId);
  return {
    f,
    input: {
      source: f.choice.source,
      productId: f.product.id,
      saleStart: f.choice.saleStart,
      saleEnd: f.choice.saleEnd,
      mechanism: f.choice.mechanism,
      note: f.choice.note,
    },
    basis: { storeId: f.storeId, offer: result.offers[0]!, product: f.product },
  };
}
