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
      tree.root.findAll(
        (n) => typeof n.type === "string" && String(n.type) === type,
      );
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

function journeyPlacement() {
  return {
    id: randomUUID(),
    label: "Légumes d’automne",
    theme:
      "Patate douce en accroche, panais et topinambour en blocs distincts ; conserver les instructions complètes sans les transformer en titre.",
    offerIds: [],
    sourceIdea: null,
    presentation: {
      zones: [
        { label: "Patate douce vrac", sharePct: 95, role: "ACCROCHE" as const },
        {
          label: "Panais vrac, référence secondaire complète",
          sharePct: 3,
          role: "RELAIS" as const,
        },
        {
          label: "Topinambour vrac, référence secondaire complète",
          sharePct: 2,
          role: "GAMME" as const,
        },
      ],
      reason: "Trois blocs lisibles, à adapter au mobilier disponible.",
      counterPromotion: null,
    },
  };
}

function journeyHosts(tree: ReactTestRenderer, type: string) {
  return tree.root.findAll(
    (node) => typeof node.type === "string" && String(node.type) === type,
  );
}

it("opens the requested placement from either card entry point without entering the share editor", async () => {
  const placement = journeyPlacement();
  const before = structuredClone(placement);
  const onOpenPlacement = vi.fn(),
    onSharesChange = vi.fn();
  const renderFooter = vi.fn(() => createElement("Footer"));
  let tree: ReactTestRenderer;
  await act(async () => {
    tree = create(
      createElement(TgPresentationView, {
        placements: [placement],
        layout: "cards",
        onOpenPlacement,
        onSharesChange,
        renderFooter,
      }),
    );
  });
  try {
    const entries = tree!.root.findAll(
      (n) =>
        typeof n.type === "string" &&
        String(n.type) === "Button" &&
        n.props.accessibilityLabel?.startsWith("Ouvrir"),
    );
    expect(entries).toHaveLength(2);
    for (const entry of entries) await act(async () => entry.props.onPress());
    expect(onOpenPlacement.mock.calls).toEqual([
      [placement.id],
      [placement.id],
    ]);
    expect(onSharesChange).not.toHaveBeenCalled();
    expect(journeyHosts(tree!, "Input")).toHaveLength(0);
    expect(journeyHosts(tree!, "Sheet")[0]!.props.visible).toBe(false);
    expect(journeyHosts(tree!, "Footer")).toHaveLength(1);
    expect(renderFooter).toHaveBeenCalledWith(placement);
    expect(placement).toEqual(before);
  } finally {
    await act(async () => tree!.unmount());
  }
});

it("discloses full detail instructions on demand while keeping the map and its tiny zones read-only", async () => {
  const placement = journeyPlacement(),
    onSharesChange = vi.fn();
  let tree: ReactTestRenderer;
  await act(async () => {
    tree = create(
      createElement(TgPresentationView, {
        placements: [placement],
        layout: "detail",
        onSharesChange,
      }),
    );
  });
  try {
    const sheet = () => journeyHosts(tree!, "Sheet")[0]!;
    const surface = tree!.root.find(
      (n) =>
        typeof n.type === "string" &&
        String(n.type) === "View" &&
        typeof n.props.onLayout === "function",
    );
    await act(async () =>
      surface.props.onLayout({ nativeEvent: { layout: { width: 250 } } }),
    );
    expect(sheet().props.visible).toBe(false);
    expect(journeyHosts(tree!, "Button")).toHaveLength(0);
    expect(journeyHosts(tree!, "Input")).toHaveLength(0);
    for (const zone of placement.presentation.zones) {
      const legend = tree!.root.find(
        (n) =>
          typeof n.type === "string" &&
          String(n.type) === "Text" &&
          n.children.includes(zone.label),
      );
      expect(legend.props.numberOfLines).toBeUndefined();
    }
    await act(async () => journeyHosts(tree!, "Secondary")[0]!.props.onPress());
    expect(sheet().props.visible).toBe(true);
    expect(
      tree!.root.findAll(
        (n) =>
          typeof n.type === "string" &&
          String(n.type) === "Text" &&
          n.children.includes(placement.theme),
      ),
    ).toHaveLength(1);
    await act(async () => sheet().props.onClose());
    expect(sheet().props.visible).toBe(false);
    expect(onSharesChange).not.toHaveBeenCalled();
    expect(placement.presentation.zones.map((z) => z.sharePct)).toEqual([
      95, 3, 2,
    ]);
  } finally {
    await act(async () => tree!.unmount());
  }
});

it("keeps an unallocated placement and its host footer reachable without inventing a surface", async () => {
  const placement = { ...journeyPlacement(), presentation: null };
  const onOpenPlacement = vi.fn(),
    renderFooter = vi.fn(() => createElement("Footer"));
  let tree: ReactTestRenderer;
  await act(async () => {
    tree = create(
      createElement(TgPresentationView, {
        placements: [placement],
        layout: "cards",
        onOpenPlacement,
        renderFooter,
      }),
    );
  });
  try {
    const entries = journeyHosts(tree!, "Button");
    expect(entries).toHaveLength(1);
    await act(async () => entries[0]!.props.onPress());
    expect(onOpenPlacement).toHaveBeenCalledExactlyOnceWith(placement.id);
    expect(
      tree!.root.findAll(
        (n) =>
          typeof n.type === "string" &&
          String(n.type) === "View" &&
          typeof n.props.onLayout === "function",
      ),
    ).toHaveLength(0);
    expect(renderFooter).toHaveBeenCalledWith(placement);
    expect(journeyHosts(tree!, "Footer")).toHaveLength(1);
  } finally {
    await act(async () => tree!.unmount());
  }
});
