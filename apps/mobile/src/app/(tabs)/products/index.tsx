import { Pressable, Text, View } from "react-native";
import { router, type Href } from "expo-router";
import {
  AppHeader,
  AppScreen,
  EmptyState,
  InlineAlert,
  PrimaryButton,
  StatusBadge,
} from "@/components/ui";
import { useProductList } from "@/products/use-product-editor";

export default function ProductListScreen() {
  const { loading, storeMissing, products } = useProductList();
  return (
    <AppScreen>
      <AppHeader
        title="Produits"
        subtitle="Référentiel local du rayon, disponible hors connexion."
      />
      <PrimaryButton
        label="Ajouter un produit"
        disabled={storeMissing}
        onPress={() => router.push("/(tabs)/products/new" as Href)}
      />
      {storeMissing ? (
        <InlineAlert
          title="Aucun magasin actif"
          message="Reconnectez-vous après l’ajout de votre magasin de développement."
        />
      ) : loading ? (
        <Text className="text-base text-muted">Chargement des produits…</Text>
      ) : products.length === 0 ? (
        <EmptyState
          title="Aucun produit"
          message="Ajoutez un premier produit. Il sera enregistré immédiatement sur cet appareil."
          icon="nutrition-outline"
        />
      ) : (
        <View className="gap-3">
          {products.map(({ record, conflictId }) => (
            <Pressable
              key={record.entity.id}
              accessibilityRole="button"
              accessibilityLabel={`Modifier ${record.entity.label}`}
              onPress={() =>
                router.push(`/(tabs)/products/${record.entity.id}` as Href)
              }
              className="gap-3 rounded-3xl border border-line bg-white p-5"
              style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
            >
              <Text className="text-lg font-semibold text-ink">
                {record.entity.label}
              </Text>
              <Text className="text-sm text-muted">
                {categoryLabel(record.entity.category)} ·{" "}
                {natureLabel(record.entity.nature)}
              </Text>
              <StatusBadge
                status={
                  conflictId ? "conflict" : record.dirty ? "pending" : "synced"
                }
              />
            </Pressable>
          ))}
        </View>
      )}
    </AppScreen>
  );
}

function categoryLabel(category: string) {
  if (category === "FRUIT") return "Fruit";
  if (category === "VEGETABLE") return "Légume";
  if (category === "OTHER") return "Autre";
  return "Catégorie à préciser";
}

function natureLabel(nature: string) {
  if (nature === "BULK") return "Vrac";
  if (nature === "PACKAGED") return "Conditionné";
  return "Nature à préciser";
}
