import { useMemo } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppHeader, InlineAlert, SecondaryButton } from "../components/ui";
import { colors } from "../design/tokens";
import {
  filterCatalogue,
  initialCatalogueView,
  natureLabels,
  unitLabels,
} from "../products/catalogue-view";
import type { ProductListItem } from "../products/product-editor-hooks.types";
import { canSelectReceiptProduct } from "./receipt-product-selection";

export function ReceiptCatalogueList({
  label,
  items,
  query,
  onQuery,
  onSelect,
  onCreate,
  onBack,
  onRefresh,
  disabled,
  canChoose,
  loading,
  error,
}: {
  label: string;
  items: ProductListItem[];
  query: string;
  onQuery(v: string): void;
  onSelect(id: string): void;
  onCreate(): void;
  onBack(): void;
  onRefresh(): void;
  disabled: boolean;
  canChoose: boolean;
  loading: boolean;
  error?: string;
}) {
  const visible = useMemo(
    () =>
      filterCatalogue(items.filter(canSelectReceiptProduct), {
        ...initialCatalogueView,
        query,
      }),
    [items, query],
  );
  return (
    <SafeAreaView
      edges={["top", "left", "right", "bottom"]}
      className="flex-1 bg-canvas"
    >
      <FlatList
        data={visible}
        keyExtractor={(item) => item.record.entity.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 24, gap: 12, paddingBottom: 40 }}
        ListHeaderComponent={
          <View className="gap-4 pb-3">
            <AppHeader
              title="Choisir le produit"
              subtitle={`Ligne du ticket : ${label}`}
            />
            <SecondaryButton
              label="Retour au ticket"
              disabled={disabled}
              onPress={onBack}
            />
            <Text className="text-muted">
              Recherchez dans le catalogue du magasin. Votre choix sera confirmé
              avant l’association.
            </Text>
            <TextInput
              accessibilityLabel="Rechercher un produit par nom, alias ou code"
              placeholder="Nom, alias, EAN, ITM8 ou PLU"
              placeholderTextColor={colors.muted}
              value={query}
              onChangeText={onQuery}
              editable={!disabled}
              maxLength={200}
              autoCorrect={false}
              className="min-h-12 rounded-xl border border-line bg-surface px-4 py-3 text-ink"
            />
            {error ? (
              <InlineAlert title="Lecture interrompue" message={error} />
            ) : null}
            <SecondaryButton
              label="Actualiser les produits et la ligne"
              disabled={disabled || loading}
              onPress={onRefresh}
            />
            <Text
              accessibilityLiveRegion="polite"
              className="text-sm text-muted"
            >
              {loading
                ? "Lecture du catalogue…"
                : `${visible.length} produit(s) disponible(s)`}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Examiner ${item.record.entity.label}`}
            disabled={disabled || !canChoose || loading}
            onPress={() => onSelect(item.record.entity.id)}
            className="min-h-16 gap-1 rounded-2xl border border-line bg-surface p-4"
          >
            <Text className="font-semibold text-ink">
              {item.record.entity.label}
            </Text>
            <Text className="text-sm text-muted">
              {natureLabels[item.record.entity.nature]} ·{" "}
              {unitLabels[item.record.entity.salesUnit]}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={
          !loading ? (
            <Text className="py-4 text-muted">
              Aucun produit disponible pour cette recherche. Vous pouvez créer
              une fiche, puis revenir la choisir.
            </Text>
          ) : null
        }
        ListFooterComponent={
          <View className="gap-3 pt-4">
            <Text className="text-sm text-muted">
              Vous ne trouvez pas le bon produit ? Créez sa fiche, puis revenez
              le choisir.
            </Text>
            <SecondaryButton
              label="Créer un produit"
              disabled={disabled || !canChoose || loading}
              onPress={onCreate}
            />
          </View>
        }
      />
    </SafeAreaView>
  );
}
