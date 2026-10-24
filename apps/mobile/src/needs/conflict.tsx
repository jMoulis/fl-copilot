import type { SyncConflict } from "@/sync/conflict-repository";
import { NeedFamilyConflict } from "./family-conflict";
export function NeedUnitConflict({ conflict }: { conflict: SyncConflict }) {
  return <NeedFamilyConflict kind="NEED" conflict={conflict} />;
}
