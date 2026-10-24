import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import { nativeVisualChatConflictFixture } from "../../../../scripts/test-visual-chat-conflict-fixtures";
import { StoreConflictCard } from "./store-conflict-card";
const runtime = vi.hoisted(() => ({ database: undefined as unknown }));
vi.mock("react-native", () => ({
  Text: "Text",
  View: "View",
  Pressable: "Pressable",
  Switch: "Switch",
  Image: "Image",
  ActivityIndicator: "Spinner",
}));
vi.mock("expo-router", () => ({
  router: { push: vi.fn() },
  useFocusEffect: (fn: () => void | (() => void)) => useEffect(fn, [fn]),
}));
vi.mock("./chat-text", () => ({ ChatText: "Text" }));
vi.mock("../providers/database-provider", () => ({
  useLocalDatabase: () => runtime.database,
}));
vi.mock("../products/visual-file-storage", () => ({
  nativeVisualFileStorage: { uri: vi.fn(async () => null) },
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
vi.mock("../commercial/original-button", () => ({
  CommercialOriginalButton: () => null,
}));
vi.mock("../components/ui", () => ({
  SectionCard: ({ title, children }: { title: string; children: unknown }) =>
    createElement(
      "View",
      {},
      createElement("Text", {}, title),
      children as never,
    ),
  SecondaryButton: ({
    label,
    onPress,
  }: {
    label: string;
    onPress: () => void;
  }) =>
    createElement("Pressable", { onPress, accessibilityRole: "button" }, label),
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const flush = () =>
  act(async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
const ready = async (r: ReactTestRenderer) =>
  vi.waitFor(async () => {
    await flush();
    expect(r.root.findAllByProps({ accessibilityRole: "radio" })).toHaveLength(
      2,
    );
  });
const button = (r: ReactTestRenderer) =>
  r.root
    .findAllByProps({ accessibilityRole: "button" })
    .find(
      (n) =>
        n.findAll((t) => t.children.includes("Confirmer cette résolution"))
          .length > 0,
    )!;
it("requires upload-rights consent separately and uses the shared two-version visual presentation", async () => {
  const s = await nativeVisualChatConflictFixture("VISUAL_ASSET");
  runtime.database = { sqlite: s.a, deviceId: s.scope.deviceId };
  let r: ReactTestRenderer | undefined;
  try {
    await act(async () => {
      r = create(
        createElement(StoreConflictCard, {
          message: s.message,
          controller: s.controller,
        }),
      );
    });
    await ready(r!);
    expect(JSON.stringify(r!.toJSON())).toContain("Comparer l’image produit");
    expect(JSON.stringify(r!.toJSON())).toContain("Version synchronisée");
    await act(async () =>
      r!.root
        .findAllByProps({ accessibilityRole: "radio" })[0]!
        .props.onPress(),
    );
    await act(async () =>
      r!.root
        .findByProps({
          accessibilityLabel:
            "J’ai comparé les deux versions et je confirme mon choix",
        })
        .props.onValueChange(true),
    );
    expect(button(r!).props.disabled).toBe(true);
    const before = s.db.prepare("SELECT * FROM visual_assets").all();
    await act(async () => button(r!).props.onPress());
    await flush();
    expect(s.db.prepare("SELECT * FROM visual_assets").all()).toEqual(before);
    await act(async () =>
      r!.root
        .findByProps({
          accessibilityLabel:
            "Je confirme les droits d’utilisation de cette image",
        })
        .props.onValueChange(true),
    );
    expect(button(r!).props.disabled).toBe(false);
    await act(async () => button(r!).props.onPress());
    await vi.waitFor(async () => {
      await flush();
      expect(
        (await s.library.get(s.kind, s.scope.storeId, s.review.local.id))!
          .entity.version,
      ).toBe(3);
    });
  } finally {
    if (r) await act(async () => r!.unmount());
    s.db.close();
  }
});
it("clears distinct rights/reactivation consents when the selected side changes", async () => {
  const s = await nativeVisualChatConflictFixture(
    "VISUAL_ASSET",
    ":memory:",
    "REMOTE",
  );
  runtime.database = { sqlite: s.a, deviceId: s.scope.deviceId };
  let r: ReactTestRenderer | undefined;
  try {
    await act(async () => {
      r = create(
        createElement(StoreConflictCard, {
          message: s.message,
          controller: s.controller,
        }),
      );
    });
    await ready(r!);
    await act(async () =>
      r!.root
        .findAllByProps({ accessibilityRole: "radio" })[0]!
        .props.onPress(),
    );
    await act(async () => {
      r!.root
        .findByProps({
          accessibilityLabel:
            "Je confirme les droits d’utilisation de cette image",
        })
        .props.onValueChange(true);
      r!.root
        .findByProps({
          accessibilityLabel:
            "Je confirme explicitement le rétablissement de ce visuel",
        })
        .props.onValueChange(true);
    });
    await act(async () =>
      r!.root
        .findAllByProps({ accessibilityRole: "radio" })[1]!
        .props.onPress(),
    );
    await act(async () =>
      r!.root
        .findAllByProps({ accessibilityRole: "radio" })[0]!
        .props.onPress(),
    );
    expect(
      r!.root.findByProps({
        accessibilityLabel:
          "Je confirme les droits d’utilisation de cette image",
      }).props.value,
    ).toBe(false);
    expect(
      r!.root.findByProps({
        accessibilityLabel:
          "Je confirme explicitement le rétablissement de ce visuel",
      }).props.value,
    ).toBe(false);
    expect(button(r!).props.disabled).toBe(true);
  } finally {
    if (r) await act(async () => r!.unmount());
    s.db.close();
  }
});
