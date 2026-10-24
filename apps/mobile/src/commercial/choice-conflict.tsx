import type { SyncConflict } from "@/sync/conflict-repository";
import { CommercialFamilyConflict } from "./family-conflict";
export function CommercialChoiceConflict({
  conflict,
}: {
  conflict: SyncConflict;
}) {
  return (
    <CommercialFamilyConflict kind="COMMERCIAL_CHOICE" conflict={conflict} />
  );
}
