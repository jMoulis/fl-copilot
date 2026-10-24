import type { SyncConflict } from "@/sync/conflict-repository";
import { NeedFamilyConflict } from "./family-conflict";
export function ProductSubstitutionConflict({
  conflict,
}: {
  conflict: SyncConflict;
}) {
  return <NeedFamilyConflict kind="SUBSTITUTION" conflict={conflict} />;
}
