import { Pressable, Text, TextInput, View } from "react-native";
import {
  commercialExecutionActualsSchema,
  type CommercialExecutionActuals,
} from "@fl-copilot/domain";
import { DateSelector } from "../components/date-selector";
import { SecondaryButton } from "../components/ui";
import { colors } from "../design/tokens";
import { formatFrenchCalendarDate } from "../dates/calendar";
export type ExecutionActualsDraft = {
  start: string;
  end: string;
  price: string;
  priceUnit: "" | "KG" | "PIECE" | "PACK";
  location: string;
};
export function executionActualsDraft(
  v: CommercialExecutionActuals | null | undefined,
): ExecutionActualsDraft {
  return {
    start: v?.start ?? "",
    end: v?.end ?? "",
    price: v?.price?.replace(".", ",") ?? "",
    priceUnit: v?.priceUnit ?? "",
    location: v?.location ?? "",
  };
}
export function parseExecutionActualsDraft(v: ExecutionActualsDraft) {
  if (!Object.values(v).some((s) => s.trim())) return null;
  return commercialExecutionActualsSchema.parse({
    start: v.start || null,
    end: v.end || null,
    price: v.price.trim().replace(",", ".") || null,
    priceUnit: v.priceUnit || null,
    location: v.location.trim() || null,
  });
}
export function ExecutionActualsEditor({
  value,
  onChange,
  disabled,
}: {
  value: ExecutionActualsDraft;
  onChange(v: ExecutionActualsDraft): void;
  disabled: boolean;
}) {
  const set = (v: Partial<ExecutionActualsDraft>) =>
    onChange({ ...value, ...v });
  return (
    <View className="gap-5">
      <Text className="text-sm leading-5 text-muted">
        Renseigne uniquement ce que tu connais.
      </Text>
      <View className="flex-row flex-wrap gap-3">
        {(["start", "end"] as const).map((key) => (
          <View
            key={key}
            className="gap-2"
            style={{ flexGrow: 1, flexBasis: 140 }}
          >
            <Text className="text-sm font-semibold text-ink">
              {key === "start" ? "Début réel" : "Fin réelle"}
            </Text>
            <DateSelector
              label={key === "start" ? "Début réel" : "Fin réelle"}
              description="Date constatée sur le terrain, distincte de la déclaration."
              triggerLabel={
                value[key] ? formatFrenchCalendarDate(value[key]) : "Choisir"
              }
              value={value[key]}
              disabled={disabled}
              onConfirm={(date) => set({ [key]: date })}
            />
            {value[key] ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  key === "start"
                    ? "Effacer le début réel"
                    : "Effacer la fin réelle"
                }
                disabled={disabled}
                accessibilityState={{ disabled }}
                onPress={() => set({ [key]: "" })}
                className="min-h-11 justify-center px-1"
              >
                <Text className="text-sm font-semibold text-forest">
                  Effacer
                </Text>
              </Pressable>
            ) : null}
          </View>
        ))}
      </View>
      <View className="gap-3">
        <Text className="text-sm font-semibold text-ink">Prix pratiqué</Text>
        <View className="flex-row items-center gap-3 rounded-2xl border border-line bg-surface px-4">
          <TextInput
            accessibilityLabel="Prix réel déclaré en euros"
            placeholder="Montant en euros"
            placeholderTextColor={colors.muted}
            value={value.price}
            editable={!disabled}
            maxLength={16}
            keyboardType="decimal-pad"
            onChangeText={(price) => set({ price })}
            className="min-h-12 flex-1 py-3 text-base text-ink"
          />
          <Text accessible={false} className="text-base text-muted">
            €
          </Text>
        </View>
        <Text className="text-sm text-muted">Unité du prix</Text>
        <View className="flex-row flex-wrap gap-2">
          {(
            [
              ["KG", "kg"],
              ["PIECE", "pièce"],
              ["PACK", "conditionné"],
            ] as const
          ).map(([priceUnit, label]) => {
            const selected = value.priceUnit === priceUnit;
            return (
              <Pressable
                key={priceUnit}
                accessibilityRole="radio"
                accessibilityLabel={`Unité du prix : ${priceUnit === "PACK" ? "unité conditionnée" : label}`}
                accessibilityState={{ checked: selected, disabled }}
                aria-checked={selected}
                disabled={disabled}
                onPress={() => set({ priceUnit: selected ? "" : priceUnit })}
                className={`min-h-12 items-center justify-center rounded-full border px-4 py-3 ${selected ? "border-accent bg-accent" : "border-line bg-surface"}`}
              >
                <Text
                  className={`text-sm ${selected ? "font-semibold text-on-accent" : "text-ink"}`}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View className="gap-3">
        <Text className="text-sm font-semibold text-ink">Emplacement réel</Text>
        <TextInput
          accessibilityLabel="Emplacement réel déclaré"
          placeholder="Ex. TG à l’entrée"
          placeholderTextColor={colors.muted}
          value={value.location}
          editable={!disabled}
          maxLength={160}
          onChangeText={(location) => set({ location })}
          className="min-h-12 rounded-2xl border border-line bg-surface px-4 py-3 text-base text-ink"
        />
      </View>
      <SecondaryButton
        label="Effacer les détails de réalisation"
        disabled={disabled}
        onPress={() => onChange(executionActualsDraft(null))}
      />
    </View>
  );
}
