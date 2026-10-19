import {
  commercialWeekPreparationSchema,
  layoutScenarioInput,
  storeLayoutScenarioSchema,
  type StoreLayoutScenario,
  type CommercialWeekPreparation,
} from "@fl-copilot/domain";
import { prepareStoreLayoutScenario } from "./store-layout-scenario";

/** Same source check on both runtimes. No guessed surface, stock, or refreshed offer version. */
export function assertPhysicalAllocationCurrent(
  storeId: string,
  raw: unknown,
  sources: unknown,
) {
  const scenario = storeLayoutScenarioSchema.parse(raw);
  if (scenario.storeId !== storeId)
    throw Error("PHYSICAL_ALLOCATION_SCOPE_INVALID");
  const derived = prepareStoreLayoutScenario(
    storeId,
    layoutScenarioInput(scenario),
    sources,
  );
  if (
    derived.status !== "READY" ||
    JSON.stringify(derived.scenario) !== JSON.stringify(scenario)
  )
    throw Error("PHYSICAL_ALLOCATION_SOURCES_CHANGED");
  if (scenario.geometry.status === "BLOCKED")
    throw Error("PHYSICAL_ALLOCATION_GEOMETRY_BLOCKED");
  return scenario;
}
/** Preserve the existing weekly draft in full and add only absent offer references. The canonical writer owns IDs/time/version. */
export function preparePhysicalAllocationDraft(
  raw: StoreLayoutScenario,
  previous: CommercialWeekPreparation | null,
  identity: { id: string; now: string },
) {
  const s = storeLayoutScenarioSchema.parse(raw);
  if (
    previous &&
    (previous.storeId !== s.storeId || previous.weekStart !== s.weekStart)
  )
    throw Error("PHYSICAL_ALLOCATION_SCOPE_INVALID");
  const refs = s.items
    .filter((i) => i.kind === "OFFER")
    .map((i) => ({ choiceId: i.id, choiceVersion: i.version }));
  if (
    refs.some((r) =>
      previous?.offerRefs.some(
        (p) => p.choiceId === r.choiceId && p.choiceVersion !== r.choiceVersion,
      ),
    )
  )
    throw Error("PHYSICAL_ALLOCATION_OFFER_REFRESH_REQUIRED");
  return commercialWeekPreparationSchema.parse({
    ...(previous ?? {
      id: identity.id,
      storeId: s.storeId,
      weekStart: s.weekStart,
      weekEnd: new Date(Date.parse(s.weekStart + "T00:00:00Z") + 6 * 86400000)
        .toISOString()
        .slice(0, 10),
      status: "DRAFT",
      tgCapacity: null,
      offerRefs: [],
      placements: [],
      note: "",
      createdAt: identity.now,
    }),
    physicalAllocation: s,
    offerRefs: [
      ...(previous?.offerRefs ?? []),
      ...refs.filter(
        (r) => !previous?.offerRefs.some((p) => p.choiceId === r.choiceId),
      ),
    ],
    version: (previous?.version ?? 0) + 1,
    updatedAt: identity.now,
  });
}
