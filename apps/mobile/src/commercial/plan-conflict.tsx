import type { SyncConflict } from "@/sync/conflict-repository";
import { CommercialFamilyConflict } from "./family-conflict";
export function CommercialPlanConflict({
  conflict,
}: {
  conflict: SyncConflict;
}) {
  return (
    <CommercialFamilyConflict kind="COMMERCIAL_PLAN" conflict={conflict} />
  );
}
