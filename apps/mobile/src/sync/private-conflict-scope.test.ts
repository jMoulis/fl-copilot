import { expect, it } from "vitest";
import { canDisplayConflict } from "./private-conflict-scope";
import type { SyncConflict } from "./conflict-repository";
it("hides private payloads immediately after switching user or store, including a mismatched remote version", () => {
  const c = {
    storeId: "store",
    entityType: "copilot_knowledge",
    localPayload: { storeId: "store", ownerId: "owner" },
    remotePayload: null,
  } as SyncConflict;
  expect(canDisplayConflict(c, "store", "owner")).toBe(true);
  expect(canDisplayConflict(c, "store", "other")).toBe(false);
  expect(canDisplayConflict(c, "other", "owner")).toBe(false);
  expect(
    canDisplayConflict(
      { ...c, remotePayload: { storeId: "store", ownerId: "other" } },
      "store",
      "owner",
    ),
  ).toBe(false);
  expect(
    canDisplayConflict({ ...c, localPayload: null }, "store", "owner"),
  ).toBe(false);
  expect(
    canDisplayConflict({ ...c, entityType: "product" }, "store", "other"),
  ).toBe(true);
});
