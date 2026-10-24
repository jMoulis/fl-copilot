import type { SyncConflict } from "@/sync/conflict-repository";
import { CommercialFamilyConflict } from "./family-conflict";
export function CommercialExecutionConflict({
  conflict,
}: {
  conflict: SyncConflict;
}) {
  return (
    <CommercialFamilyConflict kind="COMMERCIAL_EXECUTION" conflict={conflict} />
  );
}
