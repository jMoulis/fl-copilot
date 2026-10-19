import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import {
  emptyExplorerFilters,
  type AnalyticsExplorerFilters,
} from "@fl-copilot/domain";
import {
  analyticsLabelContains,
  analyticsProductMatches,
  type AnalyticsQueryProduct,
} from "@fl-copilot/analytics-core";
import {
  BottomSheet,
  InlineAlert,
  PrimaryButton,
  SecondaryButton,
} from "../components/ui";
import { colors } from "../design/tokens";
export function ExplorerFilters({
  visible,
  filters,
  products,
  error,
  onClose,
  onApply,
}: {
  visible: boolean;
  filters: AnalyticsExplorerFilters;
  products?: readonly AnalyticsQueryProduct[];
  error?: string;
  onClose: () => void;
  onApply: (f: AnalyticsExplorerFilters) => void;
}) {
  const [draft, setDraft] = useState(filters),
    [term, setTerm] = useState("");
  useEffect(() => {
    if (visible) {
      setDraft(filters);
      setTerm("");
    }
  }, [visible, filters]);
  const matches = (products ?? []).filter(
    (p) =>
      analyticsProductMatches(p, {
        category: draft.category,
        nature: draft.nature,
        productIds: draft.productIds ?? null,
        labelContains: draft.labelContains ?? null,
      }) &&
      (!term || analyticsLabelContains(p.label, term)),
  );
  const selected = products?.find((p) => p.id === draft.productId);
  function choice(
    label: string,
    active: boolean,
    press: () => void,
    key = label,
  ) {
    return (
      <Pressable
        key={key}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: active }}
        onPress={press}
        style={{
          minHeight: 48,
          padding: 12,
          borderRadius: 12,
          backgroundColor: active ? colors.forest : colors.surfaceMuted,
        }}
      >
        <Text style={{ color: active ? colors.onAccent : colors.ink }}>
          {label}
        </Text>
      </Pressable>
    );
  }
  return (
    <BottomSheet
      visible={visible}
      title="Affiner les chiffres"
      onClose={onClose}
      swipeToClose
    >
      <Text style={{ color: colors.muted }}>
        Les catégories et natures sont celles du catalogue actuel. Les chiffres
        proviennent des journées renseignées.
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {(
          [
            ["FRUIT", "Fruits"],
            ["VEGETABLE", "Légumes"],
            ["OTHER", "Autres"],
            ["UNKNOWN", "Catégorie à préciser"],
          ] as const
        ).map(([value, label]) =>
          choice(label, draft.category === value, () =>
            setDraft({
              ...draft,
              category: draft.category === value ? null : value,
              productId: null,
            }),
          ),
        )}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {(
          [
            ["BULK", "Vrac"],
            ["PACKAGED", "Conditionné"],
            ["UNKNOWN", "Nature à préciser"],
          ] as const
        ).map(([value, label]) =>
          choice(label, draft.nature === value, () =>
            setDraft({
              ...draft,
              nature: draft.nature === value ? null : value,
              productId: null,
            }),
          ),
        )}
      </View>
      {draft.productIds || draft.labelContains ? (
        <Text style={{ color: colors.muted }}>
          Sélection reprise du chat : {draft.productIds?.length ?? "plusieurs"}{" "}
          produits
          {draft.labelContains
            ? `, libellé contenant « ${draft.labelContains} »`
            : ""}
          . Effacer les filtres rétablit tout le rayon.
        </Text>
      ) : null}
      {draft.productId ? (
        <Text style={{ color: colors.ink }}>
          Produit sélectionné :{" "}
          {selected?.label ?? "Produit indisponible dans le catalogue local"}
        </Text>
      ) : null}
      <TextInput
        accessibilityLabel="Rechercher un produit à analyser"
        placeholder="Rechercher un produit…"
        placeholderTextColor={colors.muted}
        value={term}
        onChangeText={setTerm}
        maxLength={100}
        style={{
          color: colors.ink,
          backgroundColor: colors.surfaceMuted,
          minHeight: 48,
          padding: 12,
          borderRadius: 12,
        }}
      />
      {error ? (
        <InlineAlert title="Catalogue indisponible" message={error} />
      ) : !products ? (
        <Text style={{ color: colors.muted }}>Lecture du catalogue local…</Text>
      ) : (
        <>
          {choice(
            "Tous les produits du périmètre",
            draft.productId === null,
            () => setDraft({ ...draft, productId: null }),
          )}
          {matches
            .slice(0, 30)
            .map((p) =>
              choice(
                p.label,
                draft.productId === p.id,
                () => setDraft({ ...draft, productId: p.id }),
                p.id,
              ),
            )}
          <Text style={{ color: colors.muted }}>
            {matches.length > 30
              ? `${matches.length} produits correspondent. Précisez la recherche pour les autres résultats.`
              : `${matches.length} produit(s) correspondant(s).`}
          </Text>
        </>
      )}
      <PrimaryButton
        label="Appliquer les filtres"
        onPress={() => onApply(draft)}
      />
      <SecondaryButton
        label="Effacer les filtres"
        onPress={() => onApply(emptyExplorerFilters())}
      />
    </BottomSheet>
  );
}
