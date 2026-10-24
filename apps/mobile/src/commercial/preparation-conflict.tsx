import type { SyncConflict } from "@/sync/conflict-repository";
import { CommercialFamilyConflict } from "./family-conflict";
export function CommercialPreparationConflict({
  conflict,
}: {
  conflict: SyncConflict;
}) {
  return (
    <CommercialFamilyConflict
      kind="COMMERCIAL_PREPARATION"
      conflict={conflict}
    />
  );
}
