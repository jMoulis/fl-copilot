import { useEffect, useState } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pressable, Text, TextInput, View } from "react-native";
import { z } from "zod";
import {
  InlineAlert,
  PrimaryButton,
  SecondaryButton,
  SectionCard,
} from "@/components/ui";
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
  ["PACK", "Lot"],
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
}: {
  initialValue?: ProductEditorDraft;
  onSave(draft: ProductEditorDraft): Promise<void>;
  disabled?: boolean;
}) {
  const [saveError, setSaveError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ProductEditorDraft>({
    resolver: zodResolver(editorSchema),
    defaultValues: initialValue ?? emptyProductDraft,
  });
  const identifiers = useFieldArray({ control, name: "identifiers" });
  const aliases = useFieldArray({ control, name: "aliases" });

  useEffect(() => {
    reset(initialValue ?? emptyProductDraft);
  }, [initialValue, reset]);

  const submit = handleSubmit(async (draft) => {
    setSaveError(undefined);
    setSaved(false);
    try {
      await onSave(draft);
      setSaved(true);
    } catch {
      setSaveError(
        "La modification n’a pas pu être enregistrée dans la base locale.",
      );
    }
  });

  return (
    <>
      {saveError ? (
        <InlineAlert title="Enregistrement impossible" message={saveError} />
      ) : null}
      {saved ? (
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
          render={({ field: { onBlur, onChange, value } }) => (
            <TextInput
              value={value}
              onBlur={onBlur}
              onChangeText={onChange}
              accessibilityLabel="Libellé du produit"
              placeholder="Ex. Tomate ronde en grappe"
              className="min-h-12 rounded-2xl border border-line bg-white px-4 py-3 text-base text-ink"
            />
          )}
        />
        <FieldError message={errors.label?.message} />
        <ChoiceController
          control={control}
          name="category"
          label="Catégorie"
          choices={categories}
        />
        <ChoiceController
          control={control}
          name="nature"
          label="Nature"
          choices={natures}
        />
        <ChoiceController
          control={control}
          name="salesUnit"
          label="Unité de vente"
          choices={salesUnits}
        />
      </SectionCard>

      <SectionCard title="Conditionnement">
        <FormLabel label="Quantité" optional />
        <Controller
          control={control}
          name="packagingQuantity"
          render={({ field: { onBlur, onChange, value } }) => (
            <TextInput
              value={value}
              onBlur={onBlur}
              onChangeText={onChange}
              accessibilityLabel="Quantité du conditionnement"
              keyboardType="decimal-pad"
              placeholder="Ex. 1,5"
              className="min-h-12 rounded-2xl border border-line bg-white px-4 py-3 text-base text-ink"
            />
          )}
        />
        <FieldError message={errors.packagingQuantity?.message} />
        <ChoiceController
          control={control}
          name="packagingUnit"
          label="Unité du conditionnement"
          choices={packagingUnits}
        />
        <FormLabel label="Libellé source" optional />
        <Controller
          control={control}
          name="packagingSourceLabel"
          render={({ field: { onBlur, onChange, value } }) => (
            <TextInput
              value={value}
              onBlur={onBlur}
              onChangeText={onChange}
              accessibilityLabel="Libellé source du conditionnement"
              placeholder="Ex. sachet 1,5 kg"
              className="min-h-12 rounded-2xl border border-line bg-white px-4 py-3 text-base text-ink"
            />
          )}
        />
      </SectionCard>

      <SectionCard title="Identifiants">
        <Text className="text-sm leading-5 text-muted">
          Les zéros placés au début d’un ITM8, EAN ou PLU sont conservés.
        </Text>
        {identifiers.fields.map((field, index) => (
          <View key={field.id} className="gap-3 border-t border-line pt-4">
            <ChoiceController
              control={control}
              name={`identifiers.${index}.type`}
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
                  value={input.value}
                  onBlur={input.onBlur}
                  onChangeText={input.onChange}
                  accessibilityLabel={`Valeur de l’identifiant ${index + 1}`}
                  autoCapitalize="characters"
                  className="min-h-12 rounded-2xl border border-line bg-white px-4 py-3 text-base text-ink"
                />
              )}
            />
            <FieldError message={errors.identifiers?.[index]?.value?.message} />
            <SecondaryButton
              label={`Retirer l’identifiant ${index + 1}`}
              onPress={() => identifiers.remove(index)}
            />
          </View>
        ))}
        <SecondaryButton
          label="Ajouter un identifiant"
          onPress={() => identifiers.append({ type: "EAN", value: "" })}
        />
      </SectionCard>

      <SectionCard title="Aliases">
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
                  value={input.value}
                  onBlur={input.onBlur}
                  onChangeText={input.onChange}
                  accessibilityLabel={`Alias ${index + 1}`}
                  className="min-h-12 rounded-2xl border border-line bg-white px-4 py-3 text-base text-ink"
                />
              )}
            />
            <FieldError message={errors.aliases?.[index]?.alias?.message} />
            <SecondaryButton
              label={`Retirer l’alias ${index + 1}`}
              onPress={() => aliases.remove(index)}
            />
          </View>
        ))}
        <SecondaryButton
          label="Ajouter un alias"
          onPress={() => aliases.append({ alias: "" })}
        />
      </SectionCard>

      <PrimaryButton
        label="Enregistrer le produit"
        loading={isSubmitting}
        disabled={disabled}
        onPress={() => void submit()}
      />
    </>
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
    <Text accessibilityRole="alert" className="text-sm text-red-700">
      {message}
    </Text>
  ) : null;
}

function ChoiceController({
  control,
  name,
  label,
  choices,
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
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${label} : ${choiceLabel}`}
                  onPress={() => onChange(choice)}
                  className={`min-h-12 justify-center rounded-2xl border px-4 py-3 ${selected ? "border-forest bg-forest" : "border-line bg-white"}`}
                >
                  <Text
                    className={`text-sm font-semibold ${selected ? "text-white" : "text-ink"}`}
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
