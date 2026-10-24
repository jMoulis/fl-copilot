import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { ChoiceCreateCard } from "./choice-create-card";
import type { CopilotChoiceCreateController } from "./choice-create-controller";
import { choiceCreateFixture } from "../../../../scripts/test-choice-create-fixtures";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import { projectCommercialOriginalOffer } from "@fl-copilot/commercial-core";
import {
  copilotMessageSchema,
  readCopilotChoiceCreateProposal,
} from "@fl-copilot/domain";
import { buildChoiceCreateProposalMessages } from "../../../api/src/copilot/choice-create-messages";
vi.mock("react-native", () => ({
  ActivityIndicator: "Loader",
  Pressable: "Button",
  Switch: "Switch",
  View: "View",
}));
vi.mock("./chat-text", () => ({ ChatText: "Text" }));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../commercial/original-button", () => ({
  CommercialOriginalButton: "Original",
}));
vi.mock("@/dates/calendar", () => import("../dates/calendar"));
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
const button = (label: string) =>
  hosts("Button").find((n) =>
    n
      .findAll((c) => typeof c.type === "string" && String(c.type) === "Text")
      .some((c) => c.children.join("") === label),
  )!;
async function fixture() {
  const data = await choiceCreateFixture(),
    chat = chatFixture(randomUUID),
    source = {
      kind: "PDF_ORIGINAL" as const,
      sourceDocumentId: data.f.sourceDocumentId,
      checksum: `sha256:${"a".repeat(64)}`,
      pageNumber: 2,
      excerpt: "Offre du PDF original : Raisin blanc vrac moins de 2,20 €/kg",
    };
  const description = {
    operationKind: "PROSPECTUS" as const,
    operationLabel: "Prospectus semaine prochaine",
    rawProductLabel: "Raisin blanc vrac",
  };
  const assistant = copilotMessageSchema.parse({
    ...chat.message,
    storeId: data.f.storeId,
    id: randomUUID(),
    role: "ASSISTANT",
    replyToMessageId: chat.message.id,
    attachments: [],
  });
  const message = buildChoiceCreateProposalMessages(assistant, [
    {
      status: "READY",
      existingChoice: null,
      input: { ...data.input, source, originalDescription: description },
      basis: {
        ...data.basis,
        offer: projectCommercialOriginalOffer({ source, ...description }),
      },
      evidence: [
        {
          id: "proposal",
          sourceType: "DATA_QUALITY",
          sourceId: source.sourceDocumentId,
          sourceVersion: null,
          label: "À confirmer",
          value: "À confirmer",
          factKind: "QUALITY",
        },
      ],
    },
  ])[0]!;
  const state = {
    ...readCopilotChoiceCreateProposal(message),
    status: "READY" as const,
  };
  const open = vi.fn<CopilotChoiceCreateController["open"]>(async () => state),
    confirm = vi.fn<CopilotChoiceCreateController["confirm"]>(async () => ({
      ...state,
      status: "COMPLETED" as const,
    }));
  return {
    message,
    state,
    open,
    confirm,
    controller: { open, confirm } as unknown as CopilotChoiceCreateController,
    source,
  };
}
it("shows the original excerpt and real original-file action, and requires the explicit reviews before confirmation", async () => {
  const f = await fixture();
  await act(async () => {
    tree = create(
      createElement(ChoiceCreateCard, {
        message: f.message,
        controller: f.controller,
        canConfirm: true,
      }),
    );
  });
  expect(text()).toContain("Extrait du PDF original à vérifier");
  expect(text()).not.toContain("Source extraite");
  expect(hosts("Original")[0]?.props.sourceDocumentId).toBe(
    f.source.sourceDocumentId,
  );
  await act(async () => button("Voir l’extrait du PDF").props.onPress());
  expect(text()).toContain(f.source.excerpt);
  expect(button("Confirmer et retenir cette offre").props.disabled).toBe(true);
  for (const control of hosts("Switch"))
    await act(async () => control.props.onValueChange(true));
  await act(async () =>
    button("Confirmer et retenir cette offre").props.onPress(),
  );
  expect(f.confirm).toHaveBeenCalledWith(
    f.message,
    { criticalFieldsConfirmed: true, applicabilityConfirmed: true },
    expect.any(AbortSignal),
  );
  expect(text()).toContain("Offre retenue sur cet appareil");
});
it("discards a late previous-context confirmation and does not leak its completed state into the next card", async () => {
  const a = await fixture(),
    b = await fixture();
  let finish!: (
    value: Awaited<ReturnType<CopilotChoiceCreateController["confirm"]>>,
  ) => void;
  const pending = new Promise<
    Awaited<ReturnType<CopilotChoiceCreateController["confirm"]>>
  >((r) => (finish = r));
  a.confirm.mockImplementationOnce(() => pending);
  await act(async () => {
    tree = create(
      createElement(ChoiceCreateCard, {
        message: a.message,
        controller: a.controller,
        canConfirm: true,
      }),
    );
  });
  for (const control of hosts("Switch"))
    await act(async () => control.props.onValueChange(true));
  await act(async () =>
    button("Confirmer et retenir cette offre").props.onPress(),
  );
  const signal = a.confirm.mock.calls[0]![2] as AbortSignal;
  await act(async () =>
    tree!.update(
      createElement(ChoiceCreateCard, {
        message: b.message,
        controller: b.controller,
        canConfirm: true,
      }),
    ),
  );
  expect(signal.aborted).toBe(true);
  await act(async () => {
    finish({ ...a.state, status: "COMPLETED" });
    await pending;
  });
  expect(text()).not.toContain("Offre retenue sur cet appareil");
  expect(button("Confirmer et retenir cette offre").props.disabled).toBe(true);
  expect(hosts("Original")[0]?.props.sourceDocumentId).toBe(
    b.source.sourceDocumentId,
  );
});
