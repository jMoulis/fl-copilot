import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PreparationProposalCard } from "./preparation-proposal-card";
import type { CopilotPreparationProposalController } from "./preparation-proposal-controller";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import { buildPreparationProposalMessages } from "../../../api/src/copilot/preparation-proposal-messages";
import {
  copilotMessageSchema,
  readCopilotPreparationProposal,
} from "@fl-copilot/domain";
vi.mock("react-native", () => ({
  ActivityIndicator: "Loader",
  Pressable: "Button",
  View: "View",
}));
vi.mock("./chat-text", () => ({ ChatText: "Text" }));
vi.mock("expo-router", () => ({ Link: "Link" }));
let tree: ReactTestRenderer | undefined;
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
});
const hosts = (type: string) =>
  tree!.root.findAll(
    (n) => typeof n.type === "string" && String(n.type) === type,
  );
const text = () =>
  hosts("Text")
    .map((n) => n.children.filter((c) => typeof c === "string").join(""))
    .join("\n");
it.each([true, false])(
  "shows agreed offer-free TGs and notes together, saving only on authorized confirmation (%s)",
  async (canConfirm) => {
    const f = chatFixture(randomUUID);
    const assistant = copilotMessageSchema.parse({
      ...f.message,
      id: randomUUID(),
      role: "ASSISTANT",
      replyToMessageId: f.message.id,
    });
    const message = buildPreparationProposalMessages(assistant, [
      {
        input: {
          weekStart: "2026-11-09",
          create: { choiceIds: [] },
          patch: {
            tgCapacity: 2,
            note: "TG1 à l’entrée, présentation de masse. Pas de contre-promo.",
            tgAdditions: [
              { label: "TG1", theme: "Agrumes de saison", offerIds: [] },
              { label: "TG2", theme: "Potages", offerIds: [] },
            ],
          },
        },
        status: "READY",
        basis: { preparation: null, creationStoreId: f.storeId, choices: [] },
        evidence: [
          {
            id: "strategy",
            sourceId: f.storeId,
            sourceType: "DATA_QUALITY",
            sourceVersion: null,
            label: "Brouillon",
            value: "À confirmer",
            factKind: "QUALITY",
          },
        ],
      },
    ])[0]!;
    const read = readCopilotPreparationProposal(message);
    const confirm = vi.fn(async () => ({
      ...read,
      status: "COMPLETED" as const,
    }));
    const controller = {
      open: vi.fn(async () => ({ ...read, status: "READY" as const })),
      confirm,
    } as unknown as CopilotPreparationProposalController;
    await act(async () => {
      tree = create(
        createElement(PreparationProposalCard, {
          message,
          controller,
          canConfirm,
        }),
      );
    });
    expect(text()).toContain("Agrumes de saison");
    expect(text()).toContain("Potages");
    expect(text()).toContain(
      "TG1 à l’entrée, présentation de masse. Pas de contre-promo.",
    );
    expect(text()).not.toContain("Aucune offre");
    expect(text()).not.toContain("Avant :");
    expect(confirm).not.toHaveBeenCalled();
    const buttons = hosts("Button");
    expect(buttons).toHaveLength(canConfirm ? 1 : 0);
    if (canConfirm) {
      expect(text()).toContain("Enregistrer ces choix");
      await act(async () => {
        buttons[0]!.props.onPress();
        buttons[0]!.props.onPress();
      });
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(hosts("Button")).toHaveLength(0);
      expect(text()).toContain("Décision enregistrée sur cet appareil");
    }
  },
);
