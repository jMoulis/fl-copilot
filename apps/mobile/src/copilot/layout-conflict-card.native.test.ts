vi.mock("../products/visual-conflict-preview", () => ({
  VisualVersion: () => null,
}));
import { randomUUID } from "node:crypto";
import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import { nativeLayoutChatConflictFixture } from "../../../../scripts/test-layout-chat-conflict-fixtures";
import { receiptReviewDigest } from "../../../../scripts/test-receipt-publication-sqlite";
import { CopilotStoreConflictController } from "./store-conflict-controller";
import { StoreConflictCard } from "./store-conflict-card";
vi.mock("react-native", () => ({
  Text: "Text",
  View: "View",
  Pressable: "Pressable",
  Switch: "Switch",
  ActivityIndicator: "Spinner",
}));
vi.mock("expo-router", () => ({
  router: { push: vi.fn() },
  useFocusEffect: (fn: () => void | (() => void)) => useEffect(fn, [fn]),
}));
vi.mock("../commercial/choice-presentation", () => ({
  commercialChoiceSummary: () => "",
}));
vi.mock("../commercial/execution-presentation", () => ({
  commercialExecutionSummary: () => "",
}));
vi.mock("../commercial/preparation-presentation", () => ({
  commercialPreparationSummary: () => "",
}));
vi.mock("../commercial/plan-presentation", () => ({
  commercialPlanSummary: () => "",
}));
vi.mock("./chat-text", () => ({ ChatText: "Text" }));
vi.mock("../commercial/original-button", () => ({
  CommercialOriginalButton: () => null,
}));
vi.mock("../components/ui", () => ({
  SecondaryButton: ({
    label,
    onPress,
  }: {
    label: string;
    onPress: () => void;
  }) => createElement("Pressable", { onPress }, label),
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const flush = () =>
  act(async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
async function choose(renderer: ReactTestRenderer, local = true) {
  await act(async () =>
    renderer.root
      .findAllByProps({ accessibilityRole: "radio" })
      [local ? 0 : 1]!.props.onPress(),
  );
  await act(async () =>
    renderer.root
      .findByProps({
        accessibilityLabel:
          "J’ai comparé les deux versions et je confirme mon choix",
      })
      .props.onValueChange(true),
  );
  return renderer.root
    .findAllByProps({ accessibilityRole: "button" })
    .find(
      (n) =>
        n.findAll((t) => t.children.includes("Confirmer cette résolution"))
          .length > 0,
    )!.props.onPress as () => void;
}
it.each([true, false])(
  "mounts the actual chat comparison and resolves local=%s",
  async (local) => {
    const s = await nativeLayoutChatConflictFixture();
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        renderer = create(
          createElement(StoreConflictCard, {
            message: s.message,
            controller: s.controller,
          }),
        );
      });
      await flush();
      expect(JSON.stringify(renderer!.toJSON())).toContain(
        "Comparer le plan magasin",
      );
      expect(JSON.stringify(renderer!.toJSON())).toContain(
        "Conserver comme nouveau brouillon",
      );
      const confirm = await choose(renderer!, local);
      await act(async () => confirm());
      await flush();
      const row = (await s.repository.get(s.scope.storeId))!;
      expect(row.entity.content).toEqual(
        local ? s.review.local.content : s.review.remote.content,
      );
      expect(row.entity.referenceRevisionId).toBe(
        s.review.remote.referenceRevisionId,
      );
      expect(JSON.stringify(renderer!.toJSON())).toContain(
        local
          ? "un nouveau brouillon du plan a été conservé"
          : "la version synchronisée a été adoptée",
      );
    } finally {
      if (renderer) await act(async () => renderer!.unmount());
      s.db.close();
    }
  },
);
it.each(["ROLE", "UNMOUNT"] as const)(
  "rejects a retained old confirm callback after %s",
  async (change) => {
    const s = await nativeLayoutChatConflictFixture();
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        renderer = create(
          createElement(StoreConflictCard, {
            message: s.message,
            controller: s.controller,
          }),
        );
      });
      await flush();
      const confirm = await choose(renderer!);
      const tables = [
          "store_layouts",
          "store_layout_revisions",
          "store_layout_operations",
          "sync_outbox",
          "sync_conflicts",
          "copilot_tool_results",
        ],
        snapshot = () =>
          tables.map((t) =>
            s.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
          ),
        before = snapshot();
      if (change === "UNMOUNT") {
        await act(async () => renderer!.unmount());
        renderer = undefined;
      } else {
        const controller = new CopilotStoreConflictController(
          s.a,
          { ...s.chatScope, canManageStoreLayout: false },
          receiptReviewDigest,
          randomUUID,
        );
        await act(async () =>
          renderer!.update(
            createElement(StoreConflictCard, {
              message: s.message,
              controller,
            }),
          ),
        );
        await flush();
      }
      await act(async () => confirm());
      await flush();
      expect(snapshot()).toEqual(before);
    } finally {
      if (renderer) await act(async () => renderer!.unmount());
      s.db.close();
    }
  },
);
