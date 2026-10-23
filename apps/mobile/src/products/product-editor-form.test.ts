import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProductEditorForm } from "./product-editor-form";
import {
  emptyProductDraft,
  type ProductEditorDraft,
} from "./product-editor-service";

vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  TextInput: "Input",
  Pressable: "Pressable",
}));
vi.mock("../components/ui", () => ({
  SectionCard: ({ children }: { children: ReactNode }) => children,
  InlineAlert: "Alert",
  PrimaryButton: "Button",
  SecondaryButton: "Button",
}));
const save = vi.fn(),
  formState = vi.fn(),
  focused = vi.fn();
let rendered: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      original(...args);
  });
  save.mockReset().mockResolvedValue(undefined);
  formState.mockReset();
  focused.mockReset();
});
afterEach(async () => {
  await act(async () => rendered?.unmount());
  rendered = undefined;
  vi.unstubAllGlobals();
});
const draft = (): ProductEditorDraft => ({
  ...emptyProductDraft,
  label: "PERSIL BOTTE",
  category: "VEGETABLE",
  nature: "BULK",
  salesUnit: "PIECE",
  packagingQuantity: "1,5",
  packagingUnit: "KG",
  packagingSourceLabel: "source conservée",
  identifiers: [{ id: "code-existing", type: "ITM8", value: "000000123" }],
  aliases: [{ id: "alias-existing", alias: "PERSIL" }],
});
async function mount(initialValue = draft(), disabled = false) {
  await act(async () => {
    rendered = create(
      createElement(ProductEditorForm, {
        initialValue,
        disabled,
        onSave: save,
        onStateChange: formState,
      }),
      {
        createNodeMock: (element) => {
          const props = element.props;
          return element.type === "Input" &&
            props &&
            typeof props === "object" &&
            "accessibilityLabel" in props
            ? { focus: () => focused(props.accessibilityLabel) }
            : null;
        },
      },
    );
  });
}
const input = (label: string) =>
  rendered!.root
    .findAllByType("Input" as never)
    .find((n) => n.props.accessibilityLabel === label)!;
const control = (label: string) =>
  rendered!.root.findAll(
    (n) =>
      (n.type === ("Button" as never) && n.props.label === label) ||
      (n.type === ("Pressable" as never) &&
        n.props.accessibilityLabel === label),
  )[0]!;
async function press(label: string) {
  await act(async () => control(label).props.onPress());
}
async function change(label: string, value: string) {
  await act(async () => input(label).props.onChangeText(value));
}

it("starts with essential fields only and preserves exact optional drafts and IDs through repeated folding and explicit save", async () => {
  await mount();
  expect(rendered!.root.findAllByType("Input" as never)).toHaveLength(1);
  await press("Afficher conditionnement");
  await change("Quantité du conditionnement", "");
  await press("Replier conditionnement");
  await press("Afficher codes produit");
  await change("Valeur de l’identifiant 1", "000000456");
  await press("Replier codes produit");
  await press("Afficher autres libellés");
  await change("Alias 1", "PERSIL BOTTE CAISSE");
  await press("Replier autres libellés");
  for (let i = 0; i < 10; i++) {
    await press("Afficher codes produit");
    expect(input("Valeur de l’identifiant 1").props.value).toBe("000000456");
    await press("Replier codes produit");
  }
  expect(save).not.toHaveBeenCalled();
  expect(formState).toHaveBeenLastCalledWith(true, false);
  await press("Enregistrer le produit");
  expect(save).toHaveBeenCalledExactlyOnceWith({
    ...draft(),
    packagingQuantity: "",
    identifiers: [{ id: "code-existing", type: "ITM8", value: "000000456" }],
    aliases: [{ id: "alias-existing", alias: "PERSIL BOTTE CAISSE" }],
  });
  expect(formState).toHaveBeenLastCalledWith(false, false);
});

it("opens every optional section containing a blocking validation error and never calls the writer", async () => {
  const initial = draft();
  initial.packagingQuantity = "0";
  initial.identifiers[0]!.value = "";
  initial.aliases[0]!.alias = "";
  await mount(initial);
  await press("Enregistrer le produit");
  expect(
    control("Replier conditionnement").props.accessibilityState.expanded,
  ).toBe(true);
  expect(input("Valeur de l’identifiant 1").props.value).toBe("");
  expect(input("Alias 1").props.value).toBe("");
  expect(
    rendered!.root.findAll((n) => n.props.accessibilityRole === "alert"),
  ).toHaveLength(3);
  expect(save).not.toHaveBeenCalled();
  expect(focused).toHaveBeenLastCalledWith("Quantité du conditionnement");
});

it.each(["code", "alias"])(
  "focuses the invalid hidden %s after mounting its section",
  async (kind) => {
    const initial = draft();
    if (kind === "code") initial.identifiers[0]!.value = "";
    else initial.aliases[0]!.alias = "";
    await mount(initial);
    await press("Enregistrer le produit");
    expect(focused).toHaveBeenLastCalledWith(
      kind === "code" ? "Valeur de l’identifiant 1" : "Alias 1",
    );
    expect(save).not.toHaveBeenCalled();
  },
);

it("admits one save, locks edits and structural controls until it settles, and retains input after a local failure", async () => {
  let fail!: (reason: Error) => void;
  save.mockImplementationOnce(
    () =>
      new Promise<void>((_, reject) => {
        fail = reject;
      }),
  );
  await mount();
  await press("Afficher conditionnement");
  await press("Afficher codes produit");
  await press("Afficher autres libellés");
  await change("Libellé du produit", "PERSIL BOTTE CORRIGÉ");
  await act(async () => {
    control("Enregistrer le produit").props.onPress();
  });
  await act(async () => {
    await control("Enregistrer le produit").props.onPress();
  });
  expect(save).toHaveBeenCalledTimes(1);
  for (const node of rendered!.root.findAllByType("Input" as never))
    expect(node.props.editable).toBe(false);
  for (const node of rendered!.root.findAllByType("Pressable" as never))
    expect(node.props.disabled).toBe(true);
  for (const label of [
    "Ajouter un identifiant",
    "Retirer l’identifiant 1",
    "Ajouter un alias",
    "Retirer l’alias 1",
  ])
    expect(control(label).props.disabled).toBe(true);
  expect(formState).toHaveBeenLastCalledWith(true, true);
  await act(async () => {
    fail(Error("PRODUCT_EDITOR_IDENTIFIER_CONFLICT"));
  });
  expect(input("Libellé du produit").props.value).toBe("PERSIL BOTTE CORRIGÉ");
  expect(input("Valeur de l’identifiant 1").props.value).toBe("000000123");
  expect(input("Alias 1").props.value).toBe("PERSIL");
  expect(input("Libellé du produit").props.editable).toBe(true);
  expect(rendered!.root.findByType("Alert" as never).props.title).toBe(
    "Enregistrement impossible",
  );
  expect(formState).toHaveBeenLastCalledWith(true, false);
  await press("Enregistrer le produit");
  expect(save).toHaveBeenCalledTimes(2);
});

it("refuses a stale/conflicted form's save handler while preserving editable drafts", async () => {
  await mount(draft(), true);
  await change("Libellé du produit", "SAISIE CONSERVÉE");
  expect(control("Enregistrer le produit").props.disabled).toBe(true);
  await press("Enregistrer le produit");
  expect(save).not.toHaveBeenCalled();
  expect(input("Libellé du produit").props.value).toBe("SAISIE CONSERVÉE");
});
