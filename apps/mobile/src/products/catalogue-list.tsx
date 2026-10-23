import { ProductVisual } from "./product-visual";
import {
  resolveLibraryState,
  type VisualLibraryState,
} from "./visual-library-state";
import type { VisualAsset } from "@fl-copilot/domain";
type CatalogueVisuals = {
  state: VisualLibraryState | null;
  readUri(asset: VisualAsset): Promise<string | null>;
};
import { memo, useMemo, useRef, useState, useEffect } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  AppHeader,
  BottomSheet,
  EmptyState,
  InlineAlert,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
} from "../components/ui";
import { IconButton } from "../components/dashboard";
import { colors } from "../design/tokens";
import type { ProductListItem } from "./product-editor-hooks.types";
import {
  filterCatalogue,
  initialCatalogueView,
  categoryLabels,
  natureLabels,
  unitLabels,
  productIsIncomplete,
  type CatalogueView,
} from "./catalogue-view";

export function CatalogueList({
  items,
  view,
  onChange,
  onOpen,
  onAdd,
  loading,
  error,
  notice,
  onRefresh,
  storeMissing = false,
  visuals,
}: {
  items: ProductListItem[];
  view: CatalogueView;
  onChange(value: CatalogueView): void;
  onOpen(id: string): void;
  onAdd(): void;
  loading: boolean;
  error?: string;
  notice?: string;
  onRefresh(): void;
  storeMissing?: boolean;
  visuals?: CatalogueVisuals;
}) {
  const [filters, setFilters] = useState(false);
  const list = useRef<FlatList<ProductListItem>>(null);
  const restored = useRef(false);
  const { query, category, nature, state } = view;
  const rows = useMemo(
    () =>
      filterCatalogue(items, {
        ...initialCatalogueView,
        query,
        category,
        nature,
        state,
      }),
    [items, query, category, nature, state],
  );
  const active =
    view.category !== "ALL" || view.nature !== "ALL" || view.state !== "ALL";
  const update = (patch: Partial<CatalogueView>) => {
    onChange({ ...view, ...patch, scroll: 0 });
    list.current?.scrollToOffset({ offset: 0, animated: false });
  };
  useEffect(() => {
    restored.current = false;
  }, [view.query, view.category, view.nature, view.state]);
  return (
    <SafeAreaView edges={["top", "left", "right"]} className="flex-1 bg-canvas">
      <FlatList
        ref={list}
        data={rows}
        keyExtractor={(item) => item.record.entity.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 8 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={20}
        maxToRenderPerBatch={20}
        windowSize={7}
        onContentSizeChange={() => {
          if (!loading && !restored.current) {
            restored.current = true;
            list.current?.scrollToOffset({
              offset: view.scroll,
              animated: false,
            });
          }
        }}
        onScroll={(e) => {
          if (restored.current)
            onChange({ ...view, scroll: e.nativeEvent.contentOffset.y });
        }}
        scrollEventThrottle={120}
        ListHeaderComponent={
          <View className="gap-4 pb-4">
            <AppHeader
              compact
              title="Produits"
              action={
                <IconButton
                  label="Ajouter un produit"
                  icon="add"
                  disabled={storeMissing}
                  onPress={onAdd}
                />
              }
            />
            <View className="flex-row items-center gap-2">
              <View className="flex-1 flex-row items-center gap-3 rounded-2xl border border-line bg-surface px-3">
                <Ionicons
                  name="search-outline"
                  color={colors.muted}
                  size={21}
                  accessible={false}
                />
                <TextInput
                  value={view.query}
                  onChangeText={(query) => update({ query })}
                  maxLength={200}
                  placeholder="Nom, alias ou code"
                  placeholderTextColor={colors.muted}
                  accessibilityLabel="Rechercher un produit par nom, alias ou code"
                  autoCorrect={false}
                  className="min-h-12 flex-1 py-3 text-base text-ink"
                />
                {view.query ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Effacer la recherche"
                    onPress={() => update({ query: "" })}
                    className="h-12 w-12 items-center justify-center"
                  >
                    <Ionicons
                      name="close-circle-outline"
                      size={21}
                      color={colors.muted}
                      accessible={false}
                    />
                  </Pressable>
                ) : null}
              </View>
              <IconButton
                active={active}
                label={
                  active
                    ? "Filtrer les produits · filtres actifs"
                    : "Filtrer les produits"
                }
                icon="options-outline"
                onPress={() => setFilters(true)}
              />
            </View>
            <View className="flex-row flex-wrap gap-2">
              {(
                [
                  ["ALL", "Tous"],
                  ["FRUIT", "Fruits"],
                  ["VEGETABLE", "Légumes"],
                ] as const
              ).map(([category, label]) => (
                <Pressable
                  key={category}
                  accessibilityRole="radio"
                  aria-checked={view.category === category}
                  accessibilityLabel={`Catégorie : ${label}`}
                  accessibilityState={{ checked: view.category === category }}
                  onPress={() => update({ category })}
                  className="min-h-12 justify-center py-1"
                >
                  <View
                    className={`rounded-full border px-4 py-2 ${view.category === category ? "border-forest bg-forest" : "border-line bg-surface"}`}
                  >
                    <Text
                      className={
                        view.category === category
                          ? "text-sm font-semibold text-on-accent"
                          : "text-sm text-muted"
                      }
                    >
                      {label}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
            <View className="flex-row flex-wrap items-center gap-3">
              <Text
                accessibilityLiveRegion="polite"
                className="flex-1 text-sm text-muted"
              >
                {rows.length} sur {items.length} produits
              </Text>
              {active ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Effacer les filtres en conservant la recherche"
                  onPress={() =>
                    update({ category: "ALL", nature: "ALL", state: "ALL" })
                  }
                  className="min-h-12 justify-center px-2"
                >
                  <Text className="text-sm font-semibold text-forest">
                    Effacer les filtres
                  </Text>
                </Pressable>
              ) : null}
            </View>
            {active ? (
              <Text className="text-sm text-muted">
                {[
                  view.category !== "ALL"
                    ? categoryLabels[view.category]
                    : null,
                  view.nature !== "ALL" ? natureLabels[view.nature] : null,
                  stateChoices.find(
                    ([key]) => key === view.state && key !== "ALL",
                  )?.[1],
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            ) : null}

            {storeMissing ? (
              <InlineAlert
                title="Aucun magasin actif"
                message="Reconnectez-vous pour retrouver votre magasin."
              />
            ) : null}
            {notice ? (
              <InlineAlert title="Contexte de liste" message={notice} />
            ) : null}
            {error ? (
              <>
                <InlineAlert title="Lecture impossible" message={error} />
                <SecondaryButton label="Réessayer" onPress={onRefresh} />
              </>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <Text className="text-base text-muted">
              Chargement des produits…
            </Text>
          ) : !storeMissing && !error ? (
            <View className="gap-3">
              <EmptyState
                title={items.length ? "Aucun résultat" : "Aucun produit"}
                message={
                  items.length
                    ? "Essayez un autre nom, code ou filtre."
                    : "Ajoutez un premier produit, même hors connexion."
                }
                icon="nutrition-outline"
              />
              {items.length ? (
                <SecondaryButton
                  label="Effacer la recherche et les filtres"
                  onPress={() => update(initialCatalogueView)}
                />
              ) : null}
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <CatalogueRow item={item} onOpen={onOpen} visuals={visuals} />
        )}
      />
      <BottomSheet
        visible={filters}
        onClose={() => setFilters(false)}
        title="Filtrer les produits"
      >
        <CatalogueChoices
          title="Catégorie"
          value={view.category}
          choices={[["ALL", "Toutes"], ...Object.entries(categoryLabels)]}
          onChange={(category) =>
            update({ category: category as CatalogueView["category"] })
          }
        />
        <CatalogueChoices
          title="Nature"
          value={view.nature}
          choices={[["ALL", "Toutes"], ...Object.entries(natureLabels)]}
          onChange={(nature) =>
            update({ nature: nature as CatalogueView["nature"] })
          }
        />
        <CatalogueChoices
          title="État de la fiche"
          value={view.state}
          choices={stateChoices}
          onChange={(state) =>
            update({ state: state as CatalogueView["state"] })
          }
        />
        <SecondaryButton
          label="Réinitialiser les filtres"
          onPress={() =>
            update({ category: "ALL", nature: "ALL", state: "ALL" })
          }
        />
        <PrimaryButton
          label={`Voir ${rows.length} ${rows.length === 1 ? "produit" : "produits"}`}
          onPress={() => setFilters(false)}
        />
      </BottomSheet>
    </SafeAreaView>
  );
}
const stateChoices = [
  ["ALL", "Tous"],
  ["INCOMPLETE", "À compléter"],
  ["PENDING", "À synchroniser"],
  ["CONFLICT", "Conflit"],
  ["INACTIVE", "Inactif"],
] as const;
export function CatalogueChoices({
  title,
  value,
  choices,
  onChange,
}: {
  title: string;
  value: string;
  choices: readonly (readonly string[])[];
  onChange(value: string): void;
}) {
  return (
    <View className="gap-3 py-2">
      <Text
        accessibilityRole="header"
        className="text-base font-semibold text-ink"
      >
        {title}
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {choices.map(([key, label]) => (
          <Pressable
            key={key}
            accessibilityRole="radio"
            aria-checked={value === key}
            accessibilityState={{ checked: value === key }}
            accessibilityLabel={`${title} : ${label}`}
            onPress={() => onChange(key!)}
            className={`min-h-12 justify-center rounded-2xl border px-4 py-3 ${value === key ? "border-forest bg-forest" : "border-line bg-surface"}`}
          >
            <Text
              className={
                value === key ? "font-semibold text-on-accent" : "text-ink"
              }
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
const CatalogueRow = memo(function CatalogueRow({
  item: { record, conflictId },
  onOpen,
  visuals,
}: {
  visuals?: CatalogueVisuals;
  item: ProductListItem;
  onOpen(id: string): void;
}) {
  const p = record.entity;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Voir ${p.label}`}
      onPress={() => onOpen(p.id)}
      className="flex-row items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-3"
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <ProductVisual
        category={p.category}
        size={52}
        resolution={resolveLibraryState(visuals?.state ?? null, p)}
        readUri={visuals?.readUri}
      />
      <View className="flex-1 gap-1.5">
        <Text className="text-base font-semibold text-ink">{p.label}</Text>
        <View className="flex-row flex-wrap items-center gap-2">
          <Text className="text-xs text-muted">
            {natureLabels[p.nature]} · {unitLabels[p.salesUnit]}
          </Text>
          <StatusBadge
            compact
            status={
              conflictId || record.syncState === "CONFLICT"
                ? "conflict"
                : record.syncState === "ERROR"
                  ? "error"
                  : record.dirty
                    ? "pending"
                    : "synced"
            }
          />
          {productIsIncomplete(p) ? (
            <Text className="text-xs text-warning">Fiche à compléter</Text>
          ) : null}
          {p.status === "INACTIVE" ? (
            <Text className="text-sm text-muted">Inactif</Text>
          ) : null}
        </View>
      </View>
      <Ionicons
        name="chevron-forward"
        size={20}
        color={colors.muted}
        accessible={false}
      />
    </Pressable>
  );
});
