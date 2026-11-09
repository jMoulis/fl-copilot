import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { TgPresentationView } from "./tg-presentation-view";
vi.mock("react-native", () => ({
  Pressable: "Button",
  Text: "Text",
  View: "View",
  TextInput: "Input",
}));
vi.mock("../components/ui", () => ({
  BottomSheet: "Sheet",
  PrimaryButton: "Primary",
  SecondaryButton: "Secondary",
}));
it("lets a manager adjust a colored zone, keeps counter-promo separate and never saves a business action", async () => {
  const id = randomUUID(),
    onSharesChange = vi.fn(),
    placements = [
      {
        id,
        label: "TG1",
        theme: "Vitamines",
        offerIds: [],
        sourceIdea: null,
        presentation: {
          zones: [
            { label: "Clémentine", sharePct: 60, role: "ACCROCHE" as const },
            { label: "Orange", sharePct: 40, role: "RELAIS" as const },
          ],
          reason: "Saison",
          counterPromotion: { label: "Banane", reason: "Alternative" },
        },
      },
    ];
  let tree: ReactTestRenderer;
  await act(async () => {
    tree = create(
      createElement(TgPresentationView, { placements, onSharesChange }),
    );
  });
  try {
    const hosts = (type: string) =>
      tree.root.findAll((n) => typeof n.type === "string" && n.type === type);
    const label = (text: string) =>
      hosts("Text").find((n) => n.children.includes(text));
    expect(label("À proximité, hors TG")).toBeTruthy();
    expect(onSharesChange).not.toHaveBeenCalled();
    await act(async () =>
      hosts("Button")
        .find((n) => n.props.accessibilityLabel?.startsWith("Clémentine,"))!
        .props.onPress(),
    );
    expect(hosts("Sheet")[0]!.props.visible).toBe(true);
    await act(async () => hosts("Input")[0]!.props.onChangeText("99"));
    await act(async () => hosts("Primary")[0]!.props.onPress());
    expect(onSharesChange).toHaveBeenCalledWith(id, [99, 1]);
    expect(placements[0]!.presentation.zones[0]!.sharePct).toBe(60);
    expect(hosts("Sheet")).toHaveLength(0);
    await act(async () =>
      tree.update(createElement(TgPresentationView, { placements })),
    );
    expect(hosts("Button").every((n) => n.props.disabled)).toBe(true);
  } finally {
    await act(async () => tree.unmount());
  }
});
