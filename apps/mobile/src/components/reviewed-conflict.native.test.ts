import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nativeStoreConflictFixture } from "../../../../scripts/test-store-conflict-fixtures";
import { applyStoreContext } from "../store/context-repository";
import { StoreContextConflict } from "../store/context-conflict";
import { StoreEventConflict } from "../needs/store-event-conflict";
import { applyStoreProductEvent } from "../needs/store-event-repository";
import {
  nativeNeedConflictFixture,
  needConflictTables,
} from "../../../../scripts/test-need-conflict-fixtures";
import { NeedUnitConflict } from "../needs/conflict";
import { NeedMembershipConflict } from "../needs/membership-conflict";
import { ProductSubstitutionConflict } from "../needs/substitution-conflict";
import { applyNeedUnit } from "../needs/repository";
import { applyNeedMembership } from "../needs/membership-repository";
import { applyProductSubstitution } from "../needs/substitution-repository";
import {
  nativeCommercialConflictFixture,
  commercialConflictTables,
} from "../../../../scripts/test-commercial-conflict-fixtures";
import { nativeCommercialDecisionConflictFixture } from "../../../../scripts/test-commercial-decision-conflict-fixtures";
import { CommercialChoiceConflict } from "../commercial/choice-conflict";
import { CommercialPreparationConflict } from "../commercial/preparation-conflict";
import { CommercialPlanConflict } from "../commercial/plan-conflict";
import { CommercialVersionDecisionConflict } from "../commercial/version-decision-conflict";
import { CommercialExecutionConflict } from "../commercial/execution-conflict";
import { applyCommercialChoice } from "../commercial/offer-choice-repository";
import { applyCommercialPreparation } from "../commercial/week-preparation-repository";
import { applyCommercialPlan } from "../commercial/week-plan-repository";
import { applyCommercialVersionDecision } from "../commercial/version-decision-repository";
import { applyCommercialExecution } from "../commercial/execution-repository";
import { commercialWeekPlanSchema } from "@fl-copilot/domain";
import { buildCommercialWeekPlan } from "@fl-copilot/commercial-core";
import { readWeekPlanContext } from "../commercial/week-plan-context";
import { receiptReviewDigest } from "../../../../scripts/test-receipt-publication-sqlite";
const kinds = [
  "SETTINGS",
  "FIELD_EVENT",
  "NEED",
  "MEMBERSHIP",
  "SUBSTITUTION",
  "COMMERCIAL_CHOICE",
  "COMMERCIAL_PREPARATION",
  "COMMERCIAL_PLAN",
  "COMMERCIAL_REFERENCE",
  "COMMERCIAL_EXECUTION",
] as const;
type Kind = (typeof kinds)[number];
const fixture = (kind: Kind, refusal?: "LOCAL" | "REMOTE") => {
  if (kind === "SETTINGS" || kind === "FIELD_EVENT")
    return nativeStoreConflictFixture(kind);
  if (kind === "NEED" || kind === "MEMBERSHIP" || kind === "SUBSTITUTION")
    return nativeNeedConflictFixture(kind, ":memory:", refusal);
  if (kind === "COMMERCIAL_REFERENCE" || kind === "COMMERCIAL_EXECUTION")
    return nativeCommercialDecisionConflictFixture(kind);
  return nativeCommercialConflictFixture(kind, ":memory:", refusal);
};
const components = {
  SETTINGS: StoreContextConflict,
  FIELD_EVENT: StoreEventConflict,
  NEED: NeedUnitConflict,
  MEMBERSHIP: NeedMembershipConflict,
  SUBSTITUTION: ProductSubstitutionConflict,
  COMMERCIAL_CHOICE: CommercialChoiceConflict,
  COMMERCIAL_PREPARATION: CommercialPreparationConflict,
  COMMERCIAL_PLAN: CommercialPlanConflict,
  COMMERCIAL_REFERENCE: CommercialVersionDecisionConflict,
  COMMERCIAL_EXECUTION: CommercialExecutionConflict,
};
const component = (kind: Kind) => components[kind];
const entityTables = {
  SETTINGS: "store_context_settings",
  FIELD_EVENT: "store_product_events",
  ...needConflictTables,
  ...commercialConflictTables,
  COMMERCIAL_REFERENCE: "commercial_version_decisions",
  COMMERCIAL_EXECUTION: "commercial_execution_tasks",
};
const histories = {
  SETTINGS: "store_context_history",
  FIELD_EVENT: "store_product_event_history",
  NEED: "need_unit_history",
  MEMBERSHIP: "need_membership_history",
  SUBSTITUTION: "product_substitution_history",
  COMMERCIAL_CHOICE: "commercial_choice_history",
  COMMERCIAL_PREPARATION: "commercial_preparation_history",
  COMMERCIAL_PLAN: "commercial_plan_history",
  COMMERCIAL_REFERENCE: "commercial_version_decision_history",
  COMMERCIAL_EXECUTION: "commercial_execution_history",
};
const readable = {
  SETTINGS: "Asnières",
  FIELD_EVENT: "Rupture",
  NEED: "Besoin local",
  MEMBERSHIP: "compatibilité déclarée",
  SUBSTITUTION: "observation",
  COMMERCIAL_CHOICE: "Retenue",
  COMMERCIAL_PREPARATION: "Brouillon",
  COMMERCIAL_PLAN: "Version",
  COMMERCIAL_REFERENCE: "Référence",
  COMMERCIAL_EXECUTION: "plan version",
};
const pulls = {
  SETTINGS: applyStoreContext,
  FIELD_EVENT: applyStoreProductEvent,
  NEED: applyNeedUnit,
  MEMBERSHIP: applyNeedMembership,
  SUBSTITUTION: applyProductSubstitution,
  COMMERCIAL_CHOICE: applyCommercialChoice,
  COMMERCIAL_PREPARATION: applyCommercialPreparation,
  COMMERCIAL_PLAN: applyCommercialPlan,
  COMMERCIAL_REFERENCE: applyCommercialVersionDecision,
  COMMERCIAL_EXECUTION: applyCommercialExecution,
};
const runtime = vi.hoisted(() => ({
  session: undefined as unknown,
  database: undefined as unknown,
  focused: true,
  back: vi.fn(),
  sync: vi.fn(),
  hold: undefined as
    undefined | { entered: () => void; promise: Promise<void> },
}));
vi.mock("@/dates/calendar", () => import("../dates/calendar"));
vi.mock("../commercial/original-button", () => ({
  CommercialOriginalButton: "OriginalButton",
}));
vi.mock("@/auth/auth-provider", () => ({
  useAuth: () => ({ session: runtime.session }),
}));
vi.mock("@/providers/database-provider", () => ({
  useLocalDatabase: () => runtime.database,
}));
vi.mock("@/sync/sync-provider", () => ({
  useSync: () => ({ syncNow: runtime.sync }),
}));
vi.mock("@/components/ui", () => ({
  SectionCard: "Card",
  SecondaryButton: "Button",
  InlineAlert: "Alert",
}));
vi.mock("react-native", () => ({
  Text: "Text",
  View: "View",
  Switch: "Switch",
}));
vi.mock("expo-router", () => ({
  router: { back: runtime.back },
  useFocusEffect: (cb: () => void | (() => void)) => {
    const focus = runtime.focused;
    useEffect(() => (focus ? cb() : undefined), [cb, focus]);
  },
}));
vi.mock("expo-crypto", async () => {
  const { randomUUID, createHash } = await import("node:crypto");
  return {
    randomUUID,
    CryptoDigestAlgorithm: { SHA256: "SHA256" },
    digestStringAsync: async (_algorithm: string, text: string) => {
      if (runtime.hold) {
        const hold = runtime.hold;
        runtime.hold = undefined;
        hold.entered();
        await hold.promise;
      }
      return createHash("sha256").update(text).digest("hex");
    },
  };
});
let tree: ReactTestRenderer | undefined;
const fixtures: Array<Awaited<ReturnType<typeof fixture>>> = [];
async function setup(kind: Kind, refusal?: "LOCAL" | "REMOTE") {
  const s = await fixture(kind, refusal);
  fixtures.push(s);
  runtime.database = { sqlite: s.a, deviceId: s.scope.deviceId };
  runtime.session = {
    user: { id: s.scope.ownerId },
    stores: [{ storeId: s.scope.storeId, role: "MANAGER" }],
  };
  await act(async () => {
    tree = create(
      createElement(component(kind), { conflict: s.review.conflict }),
    );
  });
  return s;
}
function hosts(tag: string) {
  return tree!.root.findAll(
    (node) => typeof node.type === "string" && node.type === tag,
  );
}
function host(tag: string) {
  return hosts(tag)[0]!;
}
function button(label: string) {
  return hosts("Button").find((n) => n.props.label === label)!;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
it.each(["MEMBERSHIP", "SUBSTITUTION"] as const)(
  "%s manual reactivation needs its own consent, cleared on reread",
  async (kind) => {
    const s = await setup(kind, "REMOTE"),
      before = s.count("sync_conflicts");
    const keep = "Conserver ma version locale";
    expect(hosts("Switch")).toHaveLength(2);
    await act(async () => host("Switch").props.onValueChange(true));
    expect(button(keep).props.disabled).toBe(true);
    await act(async () => hosts("Switch")[1]!.props.onValueChange(true));
    expect(button(keep).props.disabled).toBe(false);
    await act(async () => button("Relire la comparaison").props.onPress());
    expect(hosts("Switch").every((n) => n.props.value === false)).toBe(true);
    await act(async () => host("Switch").props.onValueChange(true));
    expect(button(keep).props.disabled).toBe(true);
    await act(async () => hosts("Switch")[1]!.props.onValueChange(true));
    await act(async () => button(keep).props.onPress());
    expect(s.count("sync_conflicts")).toBe(before);
    expect(runtime.back).toHaveBeenCalledTimes(1);
  },
);
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  runtime.focused = true;
  runtime.hold = undefined;
  runtime.sync.mockReset().mockResolvedValue(undefined);
  runtime.back.mockClear();
  const error = console.error;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      error(...args);
  });
});
it.each(["LOCAL", "REMOTE"] as const)(
  "manual withdrawn offer needs a separate confirmation (%s)",
  async (withdrawal) => {
    await setup("COMMERCIAL_CHOICE", withdrawal);
    const label =
      withdrawal === "REMOTE"
        ? "Conserver ma version locale"
        : "Adopter la version synchronisée";
    await act(async () => host("Switch").props.onValueChange(true));
    expect(button(label).props.disabled).toBe(true);
    await act(async () => hosts("Switch")[1]!.props.onValueChange(true));
    expect(button(label).props.disabled).toBe(false);
    await act(async () => button("Relire la comparaison").props.onPress());
    expect(hosts("Switch").every((n) => n.props.value === false)).toBe(true);
    await act(async () => host("Switch").props.onValueChange(true));
    await act(async () => hosts("Switch")[1]!.props.onValueChange(true));
    await act(async () => button(label).props.onPress());
    expect(runtime.back).toHaveBeenCalledTimes(1);
  },
);
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
  for (const s of fixtures.splice(0)) s.db.close();
  runtime.hold = undefined;
});
describe.each(kinds)("%s native comparison", (kind) => {
  const table = entityTables[kind],
    historyTable = histories[kind],
    keepLabel =
      kind === "SETTINGS"
        ? "Conserver mes réglages locaux"
        : kind === "FIELD_EVENT"
          ? "Confirmer mon heure de fin"
          : "Conserver ma version locale",
    adoptLabel =
      kind === "SETTINGS"
        ? "Adopter les réglages synchronisés"
        : "Adopter la version synchronisée",
    pull = pulls[kind];
  it("requires a comparison and accepts a double press only once through the real SQLite writer", async () => {
    const s = await setup(kind),
      before = s.count(historyTable);
    expect(button(keepLabel).props.disabled).toBe(true);
    await act(async () => host("Switch").props.onValueChange(true));
    const action = button(keepLabel);
    expect(action.props.disabled).toBe(false);
    await act(async () => {
      action.props.onPress();
      action.props.onPress();
    });
    expect(s.count(historyTable)).toBe(before + 1);
    expect(runtime.back).toHaveBeenCalledTimes(1);
    expect(runtime.sync).toHaveBeenCalledTimes(1);
  });
  it("shows a targeted stale error, clears consent and requires rereading before another choice", async () => {
    const s = await setup(kind);
    await act(async () => host("Switch").props.onValueChange(true));
    let remote = { ...s.review.remote, version: 3 };
    if (kind === "COMMERCIAL_PLAN") {
      const p = commercialWeekPlanSchema.parse(s.review.remote);
      remote = await buildCommercialWeekPlan(
        {
          preparation: p.preparation,
          createdAt: p.createdAt,
          version: 3,
          validatedAt: "2026-10-11T14:00:00.000Z",
        },
        await readWeekPlanContext(s.a, p.preparation),
        receiptReviewDigest,
      );
    }
    await pull(s.a, s.scope.storeId, remote);
    await act(async () => button(adoptLabel).props.onPress());
    expect(
      hosts("Alert").some((n) =>
        /comparaison.*changé/.test(String(n.props.message)),
      ),
    ).toBe(true);
    expect(host("Switch").props.value).toBe(false);
    expect(button(adoptLabel).props.disabled).toBe(true);
    await act(async () => button("Relire la comparaison").props.onPress());
    expect(host("Switch").props.value).toBe(false);
    await act(async () => host("Switch").props.onValueChange(true));
    await act(async () => button(adoptLabel).props.onPress());
    expect(
      s.db.prepare(`SELECT remote_version FROM ${table}`).get()!.remote_version,
    ).toBe(3);
    expect(runtime.back).toHaveBeenCalledTimes(1);
  });
  it.each([
    "OWNER",
    "STORE",
    "DATABASE",
    "DEVICE",
    "BLUR",
    "UNMOUNT",
    ...(kind === "SETTINGS" || kind === "FIELD_EVENT"
      ? []
      : (["ROLE"] as const)),
  ] as const)(
    "cancels a delayed decision when its native context changes (%s)",
    async (mode) => {
      const s = await setup(kind),
        before = [table, "sync_conflicts", "sync_outbox", historyTable].map(
          (t) => s.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
        );
      await act(async () => host("Switch").props.onValueChange(true));
      const entered = deferred(),
        release = deferred();
      runtime.hold = { entered: entered.resolve, promise: release.promise };
      await act(async () => {
        button(keepLabel).props.onPress();
        await entered.promise;
      });
      await act(async () => {
        if (mode === "OWNER")
          runtime.session = {
            user: { id: "another-owner" },
            stores: [{ storeId: s.scope.storeId, role: "MANAGER" }],
          };
        if (mode === "ROLE")
          runtime.session = {
            user: { id: s.scope.ownerId },
            stores: [{ storeId: s.scope.storeId, role: "VIEWER" }],
          };
        if (mode === "STORE")
          runtime.session = {
            user: { id: s.scope.ownerId },
            stores: [{ storeId: "another-store" }],
          };
        if (mode === "DATABASE") {
          const other = await fixture(kind);
          fixtures.push(other);
          runtime.database = { sqlite: other.a, deviceId: s.scope.deviceId };
        }
        if (mode === "DEVICE")
          runtime.database = { sqlite: s.a, deviceId: "another-device" };
        if (mode === "BLUR") runtime.focused = false;
        if (mode === "UNMOUNT") {
          tree!.unmount();
          tree = undefined;
        } else
          tree!.update(
            createElement(component(kind), { conflict: s.review.conflict }),
          );
      });
      await act(async () => {
        release.resolve();
        await release.promise;
      });
      expect(
        [table, "sync_conflicts", "sync_outbox", historyTable].map((t) =>
          s.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
        ),
      ).toEqual(before);
      expect(runtime.sync).not.toHaveBeenCalled();
      expect(runtime.back).not.toHaveBeenCalled();
    },
  );
  it("keeps the readable local data after a failed reread and retries without accepting a stale comparison", async () => {
    const s = await setup(kind),
      before = s.count(historyTable);
    vi.spyOn(s.a, "getFirstAsync").mockRejectedValueOnce(
      Error("TEMPORARY_READ"),
    );
    await act(async () => button("Relire la comparaison").props.onPress());
    expect(
      hosts("Text").some((n) =>
        String(n.props.children).includes(readable[kind]),
      ),
    ).toBe(true);
    expect(button(keepLabel).props.disabled).toBe(true);
    expect(
      hosts("Alert").some((n) =>
        String(n.props.message).includes("ne peut pas être relue"),
      ),
    ).toBe(true);
    await act(async () => button("Relire la comparaison").props.onPress());
    expect(host("Switch").props.value).toBe(false);
    expect(host("Switch").props.disabled).toBe(false);
    expect(s.count(historyTable)).toBe(before);
    expect(runtime.sync).not.toHaveBeenCalled();
  });
  it("rejects an old rendered button callback after replacing the operational SQLite connection", async () => {
    const s = await setup(kind);
    await act(async () => host("Switch").props.onValueChange(true));
    const oldAction = button(keepLabel).props.onPress,
      before = [table, "sync_outbox", historyTable, "sync_conflicts"].map((t) =>
        s.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
      );
    const other = await fixture(kind);
    fixtures.push(other);
    runtime.database = { sqlite: other.a, deviceId: s.scope.deviceId };
    await act(async () =>
      tree!.update(
        createElement(component(kind), { conflict: s.review.conflict }),
      ),
    );
    await act(async () => oldAction());
    expect(
      [table, "sync_outbox", historyTable, "sync_conflicts"].map((t) =>
        s.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
      ),
    ).toEqual(before);
    expect(runtime.sync).not.toHaveBeenCalled();
    expect(runtime.back).not.toHaveBeenCalled();
  });
  it("preserves a committed local choice when the subsequent synchronization fails", async () => {
    const s = await setup(kind),
      before = s.count(historyTable);
    runtime.sync.mockRejectedValueOnce(Error("OFFLINE"));
    await act(async () => host("Switch").props.onValueChange(true));
    await act(async () => button(keepLabel).props.onPress());
    expect(s.count(historyTable)).toBe(before + 1);
    expect(
      s.db
        .prepare(`SELECT sync_state FROM ${table} WHERE store_id=?`)
        .get(s.scope.storeId)!.sync_state,
    ).toBe("PENDING");
    expect(hosts("Alert")).toHaveLength(0);
    expect(runtime.back).toHaveBeenCalledTimes(1);
  });
});
