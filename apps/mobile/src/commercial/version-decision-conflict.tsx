import type { SyncConflict } from "@/sync/conflict-repository";
import { CommercialFamilyConflict } from "./family-conflict";
export function CommercialVersionDecisionConflict({
  conflict,
}: {
  conflict: SyncConflict;
}) {
  return (
    <CommercialFamilyConflict kind="COMMERCIAL_REFERENCE" conflict={conflict} />
  );
}
