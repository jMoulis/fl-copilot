import {
  layoutScenarioSourcesSchema,
  type StoreLayoutScenario,
} from "@fl-copilot/domain";
import { assertPhysicalAllocationCurrent } from "@fl-copilot/commercial-core";
import { StoreLayoutRepository } from "../store/layout-repository";
import { ProductMasterRepository } from "../products/product-master-repository";
import { readCommercialChoice } from "./choice-read";
import { joinedProductToolDatabase } from "../copilot/product-tool-transaction";
import type { OutboxDatabase } from "../sync/outbox-repository";
/** Call within the caller's transaction when authorizing a save. Does not write. */
export async function readPhysicalAllocationSources(
  db: OutboxDatabase,
  storeId: string,
  scenario: StoreLayoutScenario,
) {
  if (scenario.storeId !== storeId)
    throw Error("PHYSICAL_ALLOCATION_SCOPE_INVALID");
  const joined = joinedProductToolDatabase(db),
    layouts = new StoreLayoutRepository(joined, () => {
      throw Error("READ_ONLY");
    }),
    products = new ProductMasterRepository(joined);
  const head = await layouts.get(storeId),
    reference = head?.entity.referenceRevisionId
      ? await layouts.getRevision(storeId, head.entity.referenceRevisionId)
      : null;
  const rows = await Promise.all(
      [...new Set(scenario.items.map((i) => i.productId))].map((id) =>
        products.getProduct(id),
      ),
    ),
    choices = await Promise.all(
      scenario.items
        .filter((i) => i.kind === "OFFER")
        .map((i) => readCommercialChoice(db, storeId, i.id)),
    );
  if (
    [head, ...rows, ...choices].some(
      (r) => r && ["ERROR", "CONFLICT"].includes(r.syncState),
    )
  )
    throw Error("PHYSICAL_ALLOCATION_SYNC_CONFLICT");
  return layoutScenarioSourcesSchema.parse({
    layout: { head: head?.entity ?? null, reference },
    products: rows.flatMap((r) => (r ? [r.entity] : [])),
    choices: choices.flatMap((r) => (r ? [r.entity] : [])),
  });
}
export async function assertLocalPhysicalAllocation(
  db: OutboxDatabase,
  storeId: string,
  scenario: StoreLayoutScenario,
) {
  return assertPhysicalAllocationCurrent(
    storeId,
    scenario,
    await readPhysicalAllocationSources(db, storeId, scenario),
  );
}
