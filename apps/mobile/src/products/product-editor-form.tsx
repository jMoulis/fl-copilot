import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
  type FieldPath,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pressable, Text, TextInput, View } from "react-native";
import { z } from "zod";
import {
  InlineAlert,
  PrimaryButton,
  SecondaryButton,
  SectionCard,
} from "../components/ui";
import {
  emptyProductDraft,
  type ProductEditorDraft,
} from "./product-editor-service";

const editorSchema = z
  .object({
    label: z.string().trim().min(1, "Saisissez un libellé."),
    category: z.enum(["FRUIT", "VEGETABLE", "OTHER", "UNKNOWN"]),
    nature: z.enum(["BULK", "PACKAGED", "UNKNOWN"]),
    salesUnit: z.enum(["KG", "PIECE", "PACK", "UNKNOWN"]),
    packagingQuantity: z
      .string()
      .trim()
      .refine(
        (value) =>
          !value ||
          (/^\d+(?:[.,]\d+)?$/.test(value) &&
            Number(value.replace(",", ".")) > 0),
        "Saisissez une quantité positive, par exemple 1,5.",
      ),
    packagingUnit: z.enum([
      "KG",
      "G",
      "PIECE",
      "PACK",
      "BAG",
      "TRAY",
      "NET",
      "OTHER",
    ]),
    packagingSourceLabel: z.string(),
    identifiers: z.array(
      z.object({
        id: z.string().optional(),
        type: z.enum(["ITM8", "EAN", "PLU"]),
        value: z.string().trim().min(1, "Saisissez l’identifiant."),
      }),
    ),
    aliases: z.array(
      z.object({
        id: z.string().optional(),
        alias: z.string().trim().min(1, "Saisissez l’alias."),
      }),
    ),
  })
  .superRefine((value, context) => {
    const identities = new Set<string>();
    value.identifiers.forEach((identifier, index) => {
      const key = `${identifier.type}:${identifier.value.trim()}`;
      if (identities.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["identifiers", index, "value"],
          message: "Cet identifiant est déjà présent.",
        });
      }
      identities.add(key);
    });
  });

const categories = [
  ["FRUIT", "Fruit"],
  ["VEGETABLE", "Légume"],
  ["OTHER", "Autre"],
  ["UNKNOWN", "À préciser"],
] as const;
const natures = [
  ["BULK", "Vrac"],
  ["PACKAGED", "Conditionné"],
  ["UNKNOWN", "À préciser"],
] as const;
const salesUnits = [
  ["KG", "kg"],
  ["PIECE", "Pièce"],
  ["PACK", "Unité conditionnée"],
  ["UNKNOWN", "À préciser"],
] as const;
const packagingUnits = [
  ["KG", "kg"],
  ["G", "g"],
  ["PIECE", "pièce"],
  ["PACK", "lot"],
  ["BAG", "sachet"],
  ["TRAY", "barquette"],
  ["NET", "filet"],
  ["OTHER", "autre"],
] as const;

export function ProductEditorForm({
  initialValue,
  onSave,
  disabled = false,
  onStateChange,
}: {
  initialValue?: ProductEditorDraft;
  onSave(draft: ProductEditorDraft): Promise<void>;
  disabled?: boolean;
  onStateChange?(dirty: boolean, saving: boolean): void;
}) {
  const [saveError, setSaveError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const submitLock = useRef(false);
  const focusAfterValidation = useRef<
    FieldPath<ProductEditorDraft> | undefined
  >(undefined);
  const [expanded, setExpanded] = useState({
    packaging: false,
    identifiers: false,
    aliases: false,
  });
  const {
    control,
    handleSubmit,
    reset,
    setFocus,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProductEditorDraft>({
    resolver: zodResolver(editorSchema),
    defaultValues: initialValue ?? emptyProductDraft,
    shouldUnregister: false,
  });
  const identifiers = useFieldArray({ control, name: "identifiers" });
  const aliases = useFieldArray({ control, name: "aliases" });
  const [quantity, packagingUnit] = useWatch({
    control,
    name: ["packagingQuantity", "packagingUnit"],
  });

  useEffect(() => {
    onStateChange?.(isDirty, isSubmitting);
  }, [isDirty, isSubmitting, onStateChange]);
  useEffect(() => {
    const field = focusAfterValidation.current;
    if (field) {
      focusAfterValidation.current = undefined;
      setFocus(field);
    }
  }, [expanded, setFocus]);

  const validateAndSave = handleSubmit(
    async (draft) => {
      setSaveError(undefined);
      setSaved(false);
      try {
        await onSave(draft);
        reset(draft);
        setSaved(true);
      } catch (error) {
        const code = error instanceof Error ? error.message : "";
        setSaveError(
          code === "PRODUCT_EDITOR_SCOPE_CHANGED"
            ? "Le compte ou le magasin actif a changé. Aucun nouvel enregistrement n’a été confirmé. Rouvrez la fiche depuis le magasin souhaité."
            : code === "PRODUCT_EDITOR_CHANGED"
              ? "Cette fiche a changé pendant votre saisie. Vos modifications restent visibles. Relisez la version actuelle avant de réessayer."
              : code === "PRODUCT_EDITOR_CONFLICT"
                ? "Un conflit doit être résolu avant de modifier cette fiche. Votre saisie est conservée."
                : code === "PRODUCT_EDITOR_IDENTIFIER_CONFLICT"
                  ? "Ce code est déjà associé à un autre produit. Vérifiez l’identifiant sans déplacer l’association existante."
                  : code === "PRODUCT_EDITOR_UNAVAILABLE"
                    ? "Ce produit n’est plus disponible dans ce magasin. Votre saisie est conservée."
                    : "La modification n’a pas pu être enregistrée dans la base locale. Votre saisie est conservée.",
        );
      }
    },
    (invalid) => {
      const codeIndex = identifiers.fields.findIndex(
        (_, index) => invalid.identifiers?.[index]?.value,
      );
      const aliasIndex = aliases.fields.findIndex(
        (_, index) => invalid.aliases?.[index]?.alias,
      );
      focusAfterValidation.current = invalid.label
        ? "label"
        : invalid.packagingQuantity
          ? "packagingQuantity"
          : codeIndex >= 0
            ? `identifiers.${codeIndex}.value`
            : aliasIndex >= 0
              ? `aliases.${aliasIndex}.alias`
              : undefined;
      setExpanded((current) => ({
        packaging: current.packaging || Boolean(invalid.packagingQuantity),
        identifiers: current.identifiers || Boolean(invalid.identifiers),
        aliases: current.aliases || Boolean(invalid.aliases),
      }));
    },
  );
  async function submit() {
    if (disabled || submitLock.current) return;
    submitLock.current = true;
    try {
      await validateAndSave();
    } finally {
      submitLock.current = false;
    }
  }
  function toggle(section: keyof typeof expanded) {
    if (submitLock.current) return;
    setExpanded((current) => ({ ...current, [section]: !current[section] }));
  }

  return (
    <>
      {saveError ? (
        <InlineAlert title="Enregistrement impossible" message={saveError} />
      ) : null}
      {saved && !isDirty ? (
        <InlineAlert
          title="Produit enregistré"
          message="La modification est disponible hors connexion et sera synchronisée automatiquement."
        />
      ) : null}

      <SectionCard title="Identité">
        <FormLabel label="Libellé" />
        <Controller
          control={control}
          name="label"
          render={({ field: { onBlur, onChange, value, ref } }) => (
            <TextInput
              ref={ref}
              editable={!isSubmitting}
              value={value}
              onBlur={onBlur}
              onChangeText={onChange}
              accessibilityLabel="Libellé du produit"
              placeholder="Ex. Tomate ronde en grappe"
              className="min-h-12 rounded-2xl border border-line bg-surface px-4 py-3 text-base text-ink"
            />
          )}
        />
        <FieldError message={errors.label?.message} />
        <ChoiceController
          control={control}
          name="category"
          disabled={isSubmitting}
          label="Catégorie"
          choices={categories}
        />
        <ChoiceController
          control={control}
          name="nature"
          disabled={isSubmitting}
          label="Nature"
          choices={natures}
        />
        <ChoiceController
          control={control}
          name="salesUnit"
          disabled={isSubmitting}
          label="Unité de vente"
          choices={salesUnits}
        />
      </SectionCard>

      <ProductFormSection
        title="Conditionnement"
        summary={
          quantity.trim()
            ? `${quantity} ${packagingUnits.find(([unit]) => unit === packagingUnit)?.[1] ?? packagingUnit}`
            : "Facultatif : poids ou contenu d’un sachet, filet, barquette…"
        }
        expanded={expanded.packaging}
        invalid={Boolean(errors.packagingQuantity)}
        disabled={isSubmitting}
        onPress={() => toggle("packaging")}
      >
        <FormLabel label="Quantité" optional />
        <Controller
          control={control}
          name="packagingQuantity"
          render={({ field: { onBlur, onChange, value, ref } }) => (
            <TextInput
              ref={ref}
              editable={!isSubmitting}
              value={value}
              onBlur={onBlur}
              onChangeText={onChange}
              accessibilityLabel="Quantité du conditionnement"
              keyboardType="decimal-pad"
              placeholder="Ex. 1,5"
              className="min-h-12 rounded-2xl border border-line bg-surface px-4 py-3 text-base text-ink"
            />
          )}
        />
        <FieldError message={errors.packagingQuantity?.message} />
        <ChoiceController
          control={control}
          name="packagingUnit"
          disabled={isSubmitting}
          label="Unité du conditionnement"
          choices={packagingUnits}
        />
        <FormLabel label="Libellé source" optional />
        <Controller
          control={control}
          name="packagingSourceLabel"
          render={({ field: { onBlur, onChange, value, ref } }) => (
            <TextInput
              ref={ref}
              editable={!isSubmitting}
              value={value}
              onBlur={onBlur}
              onChangeText={onChange}
              accessibilityLabel="Libellé source du conditionnement"
              placeholder="Ex. sachet 1,5 kg"
              className="min-h-12 rounded-2xl border border-line bg-surface px-4 py-3 text-base text-ink"
            />
          )}
        />
      </ProductFormSection>

      <ProductFormSection
        title="Codes produit"
        summary={`${identifiers.fields.length} code${identifiers.fields.length === 1 ? "" : "s"} · ITM8, EAN ou PLU`}
        expanded={expanded.identifiers}
        invalid={Boolean(errors.identifiers)}
        disabled={isSubmitting}
        onPress={() => toggle("identifiers")}
      >
        <Text className="text-sm leading-5 text-muted">
          Les zéros placés au début d’un ITM8, EAN ou PLU sont conservés.
        </Text>
        {identifiers.fields.map((field, index) => (
          <View key={field.id} className="gap-3 border-t border-line pt-4">
            <ChoiceController
              control={control}
              name={`identifiers.${index}.type`}
              disabled={isSubmitting}
              label={`Type de l’identifiant ${index + 1}`}
              choices={[
                ["ITM8", "ITM8"],
                ["EAN", "EAN"],
                ["PLU", "PLU"],
              ]}
            />
            <Controller
              control={control}
              name={`identifiers.${index}.value`}
              render={({ field: input }) => (
                <TextInput
                  ref={input.ref}
                  editable={!isSubmitting}
                  value={input.value}
                  onBlur={input.onBlur}
                  onChangeText={input.onChange}
                  accessibilityLabel={`Valeur de l’identifiant ${index + 1}`}
                  autoCapitalize="characters"
                  className="min-h-12 rounded-2xl border border-line bg-surface px-4 py-3 text-base text-ink"
                />
              )}
            />
            <FieldError message={errors.identifiers?.[index]?.value?.message} />
            <SecondaryButton
              label={`Retirer l’identifiant ${index + 1}`}
              disabled={isSubmitting}
              onPress={() => identifiers.remove(index)}
            />
          </View>
        ))}
        <SecondaryButton
          label="Ajouter un identifiant"
          disabled={isSubmitting}
          onPress={() => identifiers.append({ type: "EAN", value: "" })}
        />
      </ProductFormSection>

      <ProductFormSection
        title="Autres libellés"
        summary={`${aliases.fields.length} alias pour retrouver ce produit`}
        expanded={expanded.aliases}
        invalid={Boolean(errors.aliases)}
        disabled={isSubmitting}
        onPress={() => toggle("aliases")}
      >
        <Text className="text-sm leading-5 text-muted">
          Ajoutez les libellés courts ou imprimés utilisés pour retrouver ce
          produit.
        </Text>
        {aliases.fields.map((field, index) => (
          <View key={field.id} className="gap-3 border-t border-line pt-4">
            <Controller
              control={control}
              name={`aliases.${index}.alias`}
              render={({ field: input }) => (
                <TextInput
                  ref={input.ref}
                  editable={!isSubmitting}
                  value={input.value}
                  onBlur={input.onBlur}
                  onChangeText={input.onChange}
                  accessibilityLabel={`Alias ${index + 1}`}
                  className="min-h-12 rounded-2xl border border-line bg-surface px-4 py-3 text-base text-ink"
                />
              )}
            />
            <FieldError message={errors.aliases?.[index]?.alias?.message} />
            <SecondaryButton
              label={`Retirer l’alias ${index + 1}`}
              disabled={isSubmitting}
              onPress={() => aliases.remove(index)}
            />
          </View>
        ))}
        <SecondaryButton
          label="Ajouter un alias"
          disabled={isSubmitting}
          onPress={() => aliases.append({ alias: "" })}
        />
      </ProductFormSection>

      <PrimaryButton
        label="Enregistrer le produit"
        loading={isSubmitting}
        disabled={disabled}
        onPress={submit}
      />
    </>
  );
}

function ProductFormSection({
  title,
  summary,
  expanded,
  invalid,
  disabled,
  onPress,
  children,
}: {
  title: string;
  summary: string;
  expanded: boolean;
  invalid: boolean;
  disabled: boolean;
  onPress(): void;
  children: ReactNode;
}) {
  return (
    <View className="gap-4 rounded-3xl border border-line bg-surface p-5">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? "Replier" : "Afficher"} ${title.toLowerCase()}`}
        accessibilityHint={`${summary}${invalid ? ". Des champs sont à corriger." : ""}`}
        accessibilityState={{ expanded, disabled }}
        disabled={disabled}
        onPress={onPress}
        className="min-h-12 flex-row items-center gap-3"
      >
        <View className="flex-1 gap-1">
          <Text className="text-base font-semibold text-ink">{title}</Text>
          <Text className="text-sm leading-5 text-muted">{summary}</Text>
          {invalid ? (
            <Text className="text-sm font-semibold text-critical">
              À corriger
            </Text>
          ) : null}
        </View>
        <Text accessible={false} className="text-xl text-forest">
          {expanded ? "−" : "+"}
        </Text>
      </Pressable>
      {expanded ? children : null}
    </View>
  );
}

function FormLabel({ label, optional }: { label: string; optional?: boolean }) {
  return (
    <Text className="text-base font-semibold text-ink">
      {label}
      {optional ? " (facultatif)" : ""}
    </Text>
  );
}

function FieldError({ message }: { message?: string }) {
  return message ? (
    <Text accessibilityRole="alert" className="text-sm text-critical">
      {message}
    </Text>
  ) : null;
}

function ChoiceController({
  control,
  name,
  label,
  choices,
  disabled = false,
}: {
  control: ReturnType<typeof useForm<ProductEditorDraft>>["control"];
  name:
    | "category"
    | "nature"
    | "salesUnit"
    | "packagingUnit"
    | `identifiers.${number}.type`;
  label: string;
  choices: readonly (readonly [string, string])[];
  disabled?: boolean;
}) {
  return (
    <View className="gap-2">
      <FormLabel label={label} />
      <Controller
        control={control}
        name={name}
        render={({ field: { onChange, value } }) => (
          <View className="flex-row flex-wrap gap-2">
            {choices.map(([choice, choiceLabel]) => {
              const selected = value === choice;
              return (
                <Pressable
                  key={choice}
                  accessibilityRole="radio"
                  aria-checked={selected}
                  accessibilityState={{ checked: selected, disabled }}
                  disabled={disabled}
                  accessibilityLabel={`${label} : ${choiceLabel}`}
                  onPress={() => onChange(choice)}
                  className={`min-h-12 justify-center rounded-2xl border px-4 py-3 ${selected ? "border-forest bg-forest" : "border-line bg-surface"}`}
                >
                  <Text
                    className={`text-sm font-semibold ${selected ? "text-on-accent" : "text-ink"}`}
                  >
                    {choiceLabel}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      />
    </View>
  );
}
