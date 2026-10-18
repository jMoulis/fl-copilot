import { Text, TextInput, View } from "react-native";
import {
  commercialExecutionActualsSchema,
  type CommercialExecutionActuals,
} from "@fl-copilot/domain";
import { DateSelector } from "../components/date-selector";
import { SecondaryButton } from "../components/ui";
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
    <View className="gap-3">
      <Text className="font-semibold text-ink">
        Réalisation déclarée (facultatif)
      </Text>
      <Text className="text-muted">
        Laissez inconnue une information que vous ne connaissez pas. Ces valeurs
        ne sont pas reprises du plan et ne confirment pas un prix en caisse.
      </Text>
      {(["start", "end"] as const).map((key) => (
        <View key={key} className="gap-2">
          <Text className="text-ink">
            {key === "start" ? "Début réel" : "Fin réelle"}
          </Text>
          <DateSelector
            label={key === "start" ? "Début réel" : "Fin réelle"}
            description="Date de réalisation constatée, distincte de la date de déclaration."
            value={value[key]}
            disabled={disabled}
            onConfirm={(date) => set({ [key]: date })}
          />
          {value[key] ? (
            <SecondaryButton
              label={
                key === "start"
                  ? "Effacer le début réel"
                  : "Effacer la fin réelle"
              }
              disabled={disabled}
              onPress={() => set({ [key]: "" })}
            />
          ) : null}
        </View>
      ))}
      <TextInput
        accessibilityLabel="Prix réel déclaré en euros"
        placeholder="Prix réel en euros, si connu"
        value={value.price}
        editable={!disabled}
        maxLength={16}
        keyboardType="decimal-pad"
        onChangeText={(price) => set({ price })}
        className="min-h-12 rounded-xl border border-line p-3 text-ink"
      />
      <Text className="text-muted">
        Unité du prix (aucune unité choisie par défaut)
      </Text>
      {(
        [
          ["KG", "kg"],
          ["PIECE", "pièce"],
          ["PACK", "unité conditionnée"],
        ] as const
      ).map(([priceUnit, label]) => (
        <SecondaryButton
          key={priceUnit}
          label={`${value.priceUnit === priceUnit ? "✓ " : ""}${label}`}
          disabled={disabled}
          onPress={() =>
            set({ priceUnit: value.priceUnit === priceUnit ? "" : priceUnit })
          }
        />
      ))}
      <TextInput
        accessibilityLabel="Emplacement réel déclaré"
        placeholder="Emplacement réel, par exemple TG entrée"
        value={value.location}
        editable={!disabled}
        maxLength={160}
        onChangeText={(location) => set({ location })}
        className="min-h-12 rounded-xl border border-line p-3 text-ink"
      />
      <SecondaryButton
        label="Effacer les détails de réalisation"
        disabled={disabled}
        onPress={() => onChange(executionActualsDraft(null))}
      />
      <Text className="text-muted">
        L’effacement prend effet uniquement après enregistrement ; les versions
        précédentes restent dans l’historique. Modifier les détails ne change
        pas automatiquement le statut.
      </Text>
    </View>
  );
}
