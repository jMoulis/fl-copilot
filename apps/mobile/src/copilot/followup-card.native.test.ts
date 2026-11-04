import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import { executionLinkFixture } from "../../../../scripts/test-execution-link-fixtures";
import { actionExecutionFixture } from "../../../../scripts/test-action-execution-fixtures";
import { ExecutionLinkCard } from "./execution-link-card";
import { ActionExecutionCard } from "./action-execution-card";
vi.mock("react-native", () => ({
  Text: "Text",
  View: "View",
  Pressable: "Pressable",
  ActivityIndicator: "Spinner",
}));
vi.mock("./chat-text", () => ({ ChatText: "Text" }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let tree: ReactTestRenderer | undefined;
const close: Array<() => void> = [];
const hosts = (tag: string) =>
  tree!.root.findAll((n) => typeof n.type === "string" && n.type === tag);
const text = () => JSON.stringify(tree!.toJSON());
const button = (label: string) =>
  hosts("Pressable").find(
    (n) =>
      n.findAll(
        (c) =>
          typeof c.type === "string" &&
          String(c.type) === "Text" &&
          c.props.children === label,
      ).length,
  )!;
const checkbox = () =>
  hosts("Pressable").find((n) => n.props.accessibilityRole === "checkbox");
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
  for (const fn of close.splice(0)) fn();
});
async function fixture(kind: "LINK" | "REALIZATION", confirmed = true) {
  if (kind === "LINK") {
    const f = await executionLinkFixture();
    close.push(() => f.db.db.close());
    if (confirmed) {
      const s = await f.repository.open(f.linkCard);
      await f.repository.save(f.linkCard, s.review);
    }
    return {
      db: f.db,
      read: () => f.repository.open(f.linkCard),
      save: vi.spyOn(f.repository, "save"),
      open: vi.spyOn(f.repository, "open"),
      element: (canConfirm = true) =>
        createElement(ExecutionLinkCard, {
          message: f.linkCard,
          repository: f.repository,
          canConfirm,
        }),
      confirm: "Confirmer l’association",
      withdraw: "Retirer le lien",
      history: "Choix du",
    };
  }
  const f = await actionExecutionFixture();
  close.push(() => f.db.db.close());
  if (confirmed) {
    const s = await f.repository.open(f.actionCard);
    await f.repository.save(f.actionCard, s.review);
  }
  return {
    db: f.db,
    read: () => f.repository.open(f.actionCard),
    save: vi.spyOn(f.repository, "save"),
    open: vi.spyOn(f.repository, "open"),
    element: (canConfirm = true) =>
      createElement(ActionExecutionCard, {
        message: f.actionCard,
        repository: f.repository,
        canConfirm,
      }),
    confirm: "Enregistrer la réalisation",
    withdraw: "Retirer la déclaration",
    history: "Conseil d’origine",
  };
}
async function mount(
  f: Awaited<ReturnType<typeof fixture>>,
  canConfirm = true,
) {
  await act(async () => {
    tree = create(f.element(canConfirm));
  });
}
async function business(f: Awaited<ReturnType<typeof fixture>>) {
  return {
    tasks: await f.db.getAllAsync(
      "SELECT * FROM commercial_execution_tasks ORDER BY id",
    ),
    choices: await f.db.getAllAsync(
      "SELECT * FROM copilot_decisions ORDER BY id",
    ),
  };
}
it.each(["LINK", "REALIZATION"] as const)(
  "keeps confirmed %s compact and makes withdrawal deliberate without mutating business facts",
  async (kind) => {
    const f = await fixture(kind),
      before = await business(f);
    const outbox = await f.db.getAllAsync(
      "SELECT * FROM sync_outbox ORDER BY local_sequence",
    );
    await mount(f);
    expect(checkbox()).toBeUndefined();
    expect(text()).not.toContain(f.history);
    expect(text()).toContain("À synchroniser");
    if (kind === "LINK") {
      expect(text()).toContain("Semaine du");
      expect(text()).toContain("modifié");
    }
    expect(
      button(kind === "LINK" ? "Actualiser le suivi" : "Vérifier à nouveau"),
    ).toBeDefined();
    expect(text()).toContain(
      kind === "LINK" ? "non renseignés" : "Îlot entrée",
    );
    expect(button("Voir les détails").props.accessibilityState.expanded).toBe(
      false,
    );
    await act(async () => button("Voir les détails").props.onPress());
    expect(text()).toContain(f.history);
    expect(button(f.withdraw).props.disabled).toBe(true);
    await act(async () => checkbox()!.props.onPress());
    await act(async () => button("Masquer les détails").props.onPress());
    await act(async () => button("Voir les détails").props.onPress());
    expect(checkbox()!.props.accessibilityState.checked).toBe(false);
    expect(f.save).not.toHaveBeenCalled();
    expect(
      await f.db.getAllAsync(
        "SELECT * FROM sync_outbox ORDER BY local_sequence",
      ),
    ).toEqual(outbox);
    await act(async () => checkbox()!.props.onPress());
    await act(async () => button(f.withdraw).props.onPress());
    expect(f.save).toHaveBeenCalledTimes(1);
    expect(f.save.mock.calls[0]?.[2]).toBe(true);
    expect((await f.read()).status).toBe("WITHDRAWN");
    expect((await f.read()).link?.version).toBe(2);
    expect(checkbox()).toBeUndefined();
    expect(button("Voir les détails")).toBeDefined();
    expect(await business(f)).toEqual(before);
  },
);
it.each(["LINK", "REALIZATION"] as const)(
  "keeps pending %s information and explicit confirmation visible before collapsing success",
  async (kind) => {
    const f = await fixture(kind, false),
      before = await business(f);
    await mount(f);
    expect((await f.read()).status).toBe("READY");
    expect(text()).toContain(
      kind === "LINK"
        ? "Relier le choix à la mise en place"
        : "Réalisation à confirmer",
    );
    expect(text()).toContain(f.history);
    expect(button(f.confirm).props.disabled).toBe(true);
    expect(f.save).not.toHaveBeenCalled();
    await act(async () => checkbox()!.props.onPress());
    await act(async () => button(f.confirm).props.onPress());
    expect((await f.read()).status).toBe("CONFIRMED");
    expect(f.save).toHaveBeenCalledTimes(1);
    expect(checkbox()).toBeUndefined();
    expect(text()).not.toContain(f.history);
    expect(await business(f)).toEqual(before);
  },
);
it.each(["LINK", "REALIZATION"] as const)(
  "keeps %s history readable with no write controls for a read-only caller",
  async (kind) => {
    const f = await fixture(kind);
    await mount(f, false);
    await act(async () => button("Voir les détails").props.onPress());
    expect(text()).toContain(f.history);
    expect(checkbox()).toBeUndefined();
    expect(f.save).not.toHaveBeenCalled();
  },
);
it.each(["LINK", "REALIZATION"] as const)(
  "keeps %s load errors and read-only retry reachable",
  async (kind) => {
    const f = await fixture(kind, false);
    f.open.mockRejectedValueOnce(Error("Unavailable"));
    await mount(f);
    expect(
      hosts("Text").some((n) => n.props.accessibilityLiveRegion === "polite"),
    ).toBe(true);
    await act(async () =>
      button(
        kind === "LINK" ? "Actualiser la comparaison" : "Vérifier à nouveau",
      ).props.onPress(),
    );
    expect((await f.read()).status).toBe("READY");
    expect(checkbox()).toBeDefined();
    expect(f.save).not.toHaveBeenCalled();
  },
);
