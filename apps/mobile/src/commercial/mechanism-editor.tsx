import { useEffect, useMemo, useState } from "react";
import { Text, TextInput, View } from "react-native";
import type { CommercialMechanism } from "@fl-copilot/domain";
import { SecondaryButton } from "@/components/ui";
const types = {
  FIXED_PRICE: "Prix fixe",
  PRICE_CEILING: "Prix plafond",
  CARD_BENEFIT: "Avantage carte",
  THRESHOLD_PRICE: "Prix dégressif",
  LOT: "Lot",
};
const units = {
  KG: "kg",
  PIECE: "pièce",
  PACK: "unité conditionnée",
  LOT: "lot",
};
function numeric(value: string | undefined) {
  return value && /^\d+(?:[,.]\d{1,2})?$/.test(value.trim())
    ? Number(value.replace(",", "."))
    : undefined;
}
export function MechanismEditor({
  initial,
  onChange,
  issue,
}: {
  initial: CommercialMechanism | null;
  onChange(value: unknown): void;
  issue?: string;
}) {
  const [type, setType] = useState<string>(initial?.type ?? "");
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(initial ?? {})
        .filter(([, v]) => typeof v === "number" || typeof v === "string")
        .map(([k, v]) => [k, String(v)]),
    ),
  );
  const candidate = useMemo(() => {
    const n = (key: string) => numeric(values[key]);
    if (type === "FIXED_PRICE")
      return { type, amount: n("amount"), currency: "EUR", unit: values.unit };
    if (type === "PRICE_CEILING")
      return {
        type,
        amount: n("amount"),
        currency: "EUR",
        unit: values.unit,
        operator: values.operator,
      };
    if (type === "CARD_BENEFIT")
      return {
        type,
        benefitType: values.benefitType,
        value: n("value"),
        scope: initial?.type === "CARD_BENEFIT" ? initial.scope : null,
      };
    if (type === "THRESHOLD_PRICE")
      return {
        type,
        basePrice: n("basePrice"),
        thresholdPrice: n("thresholdPrice"),
        thresholdQuantity: n("thresholdQuantity"),
        thresholdUnit: values.thresholdUnit,
        priceUnit: values.priceUnit,
      };
    if (type === "LOT")
      return {
        type,
        lotQuantity: n("lotQuantity"),
        totalPrice: n("totalPrice") ?? null,
        unitPrice: n("unitPrice") ?? null,
        unit: values.unit,
      };
    return null;
  }, [type, values, initial]);
  useEffect(() => onChange(candidate), [candidate, onChange]);
  function input(key: string, label: string) {
    return (
      <View key={key} className="gap-1">
        <Text className="text-base text-ink">{label}</Text>
        <TextInput
          accessibilityLabel={label}
          keyboardType="decimal-pad"
          value={values[key] ?? ""}
          onChangeText={(value) =>
            setValues((old) => ({ ...old, [key]: value }))
          }
          className={`rounded-xl border p-3 text-base text-ink ${issue ? "border-danger" : "border-line"}`}
        />
      </View>
    );
  }
  function choose(key: string, options: Record<string, string>) {
    return (
      <View className="gap-2">
        {Object.entries(options).map(([value, label]) => (
          <SecondaryButton
            key={value}
            label={`${values[key] === value ? "✓ " : ""}${label}`}
            onPress={() => setValues((old) => ({ ...old, [key]: value }))}
          />
        ))}
      </View>
    );
  }
  return (
    <View className="gap-3">
      <Text className="font-semibold text-ink">Mécanisme de l’offre</Text>
      {Object.entries(types).map(([value, label]) => (
        <SecondaryButton
          key={value}
          label={`${type === value ? "✓ " : ""}${label}`}
          onPress={() => setType(value)}
        />
      ))}
      {type === "FIXED_PRICE" || type === "PRICE_CEILING" ? (
        <>
          {input(
            "amount",
            type === "PRICE_CEILING" ? "Montant plafond (€)" : "Prix (€)",
          )}
          <Text className="text-base text-ink">Prix par</Text>
          {choose("unit", units)}
        </>
      ) : null}
      {type === "PRICE_CEILING"
        ? choose("operator", {
            LESS_THAN: "Moins de (strictement inférieur)",
            LESS_THAN_OR_EQUAL: "Au plus (inférieur ou égal)",
          })
        : null}
      {type === "CARD_BENEFIT" ? (
        <>
          {choose("benefitType", {
            PERCENT: "Pourcentage sur la carte",
            AMOUNT: "Montant sur la carte",
          })}
          {input(
            "value",
            values.benefitType === "PERCENT"
              ? "Avantage carte (%)"
              : "Avantage carte (€)",
          )}
        </>
      ) : null}
      {type === "THRESHOLD_PRICE" ? (
        <>
          {input("basePrice", "Prix avant le seuil (€)")}
          {input("thresholdPrice", "Prix à partir du seuil (€)")}
          <Text className="text-base text-ink">Unité du prix</Text>
          {choose("priceUnit", units)}
          {input("thresholdQuantity", "Quantité déclenchant le seuil")}
          <Text className="text-base text-ink">Unité du seuil</Text>
          {choose("thresholdUnit", units)}
        </>
      ) : null}
      {type === "LOT" ? (
        <>
          {input("lotQuantity", "Nombre d’unités dans le lot")}
          {choose("unit", { PIECE: "pièces", PACK: "unités conditionnées" })}
          {input("totalPrice", "Prix total du lot (€), si connu")}
          {input("unitPrice", "Prix unitaire dans le lot (€), si connu")}
        </>
      ) : null}
      {issue ? (
        <Text accessibilityRole="alert" className="text-sm text-danger">
          {issue}
        </Text>
      ) : null}
    </View>
  );
}
