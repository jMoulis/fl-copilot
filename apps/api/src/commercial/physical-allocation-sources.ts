import type { Db, ClientSession } from "mongodb";
import {
  layoutScenarioInputSchema,
  layoutScenarioSourcesSchema,
  layoutScenarioInput,
  type StoreLayoutScenario,
} from "@fl-copilot/domain";
import { assertPhysicalAllocationCurrent } from "@fl-copilot/commercial-core";
import { readCopilotStoreLayoutSnapshot } from "../copilot/store-layout-tool";
import {
  serializeProductDocument,
  type ProductDocument,
} from "../products/product-master";
import {
  serializeCommercialChoice,
  type OfferChoiceDocument,
} from "./offer-choice-sync";
/** Exact authorized IDs only, bounded canonical reads with a final stability check. No business write. */
export async function readStoreLayoutScenarioSources(
  db: Db,
  storeId: string,
  raw: unknown,
  options: { session?: ClientSession } = {},
) {
  const input = layoutScenarioInputSchema.parse(raw),
    layout = await readCopilotStoreLayoutSnapshot(db, storeId, options),
    refs = input.assignments.flatMap((a) => a.items);
  const offerIds = [
    ...new Set(refs.filter((r) => r.kind === "OFFER").map((r) => r.id)),
  ].sort();
  const offers = async () =>
    offerIds.length
      ? (
          await db
            .collection<OfferChoiceDocument>("commercialOfferChoices")
            .find({ storeId, _id: { $in: offerIds } }, options)
            .sort({ _id: 1 })
            .maxTimeMS(2000)
            .limit(17)
            .toArray()
        ).map((r) => {
          const c = serializeCommercialChoice(r);
          if (c.id !== r._id) throw Error("LAYOUT_SCENARIO_SCOPE_INVALID");
          return c;
        })
      : [];
  const choices = await offers();
  const productIds = [
    ...new Set([
      ...refs.filter((r) => r.kind === "PRODUCT").map((r) => r.id),
      ...choices.map((c) => c.productId),
    ]),
  ].sort();
  const products = async () =>
    productIds.length
      ? (
          await db
            .collection<ProductDocument>("products")
            .find({ storeId, _id: { $in: productIds } }, options)
            .sort({ _id: 1 })
            .maxTimeMS(2000)
            .limit(17)
            .toArray()
        ).map(serializeProductDocument)
      : [];
  const first = await products();
  const headAgain = () =>
    db
      .collection<{
        _id: string;
        storeId: string;
        referenceRevisionId: string | null;
      }>("storeLayouts")
      .findOne(
        { _id: storeId, storeId },
        { ...options, projection: { referenceRevisionId: 1 }, maxTimeMS: 2000 },
      );
  // Mongo transactions do not support parallel operations on the same session.
  const [freshHead, freshProducts, freshChoices] = options.session
    ? [await headAgain(), await products(), await offers()]
    : await Promise.all([headAgain(), products(), offers()]);
  if (
    (freshHead?.referenceRevisionId ?? null) !==
      (layout.head?.referenceRevisionId ?? null) ||
    JSON.stringify(freshProducts) !== JSON.stringify(first) ||
    JSON.stringify(freshChoices) !== JSON.stringify(choices)
  )
    throw Error("LAYOUT_SCENARIO_SOURCE_CHANGED");
  return layoutScenarioSourcesSchema.parse({
    layout,
    products: first,
    choices,
  });
}

export async function assertRemotePhysicalAllocation(
  db: Db,
  storeId: string,
  scenario: StoreLayoutScenario,
  session: ClientSession,
) {
  const sources = await readStoreLayoutScenarioSources(
    db,
    storeId,
    layoutScenarioInput(scenario),
    { session },
  );
  if (
    !sources.layout.head ||
    sources.layout.head.version < scenario.physicalVersion ||
    scenario.items.some(
      (i) =>
        !sources.products.some(
          (p) => p.id === i.productId && p.version >= i.productVersion,
        ) ||
        (i.kind === "OFFER" &&
          !sources.choices.some(
            (c) => c.id === i.id && c.version >= i.version,
          )),
    )
  )
    throw Error("PHYSICAL_ALLOCATION_DEPENDENCIES_PENDING");
  return assertPhysicalAllocationCurrent(storeId, scenario, sources);
}
