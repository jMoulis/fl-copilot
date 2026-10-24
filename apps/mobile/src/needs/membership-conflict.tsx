import type { SyncConflict } from "@/sync/conflict-repository";
import { NeedFamilyConflict } from "./family-conflict";
export function NeedMembershipConflict({
  conflict,
}: {
  conflict: SyncConflict;
}) {
  return <NeedFamilyConflict kind="MEMBERSHIP" conflict={conflict} />;
}
