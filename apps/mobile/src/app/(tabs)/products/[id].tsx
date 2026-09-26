import { Text } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import {
  AppHeader,
  AppScreen,
  InlineAlert,
  SecondaryButton,
} from "@/components/ui";
import { ProductEditorForm } from "@/products/product-editor-form";
import { productSnapshotToDraft } from "@/products/product-editor-service";
import { useProductEditor } from "@/products/use-product-editor";

export default function ProductEditorScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isNew = id === "new";
  const productId = isNew ? undefined : id;
  const { loading, missing, storeMissing, snapshot, conflictId, save } =
    useProductEditor(productId);

  return (
    <AppScreen>
      <AppHeader
        title={
          isNew
            ? "Nouveau produit"
            : (snapshot?.product.entity.label ?? "Modifier le produit")
        }
        subtitle="Les changements sont d’abord enregistrés sur cet appareil."
      />

      {conflictId ? (
        <>
          <InlineAlert
            title="Conflit de synchronisation"
            message="Une autre version existe. Votre modification locale reste disponible. Examinez le conflit avant tout nouvel enregistrement."
          />
          <SecondaryButton
            label="Examiner le conflit"
            onPress={() =>
              router.push(`/(tabs)/sync-conflict/${conflictId}` as Href)
            }
          />
        </>
      ) : null}

      {storeMissing ? (
        <InlineAlert
          title="Aucun magasin actif"
          message="Reconnectez-vous après l’ajout de votre magasin de développement. Aucun produit ne peut être enregistré sans magasin."
        />
      ) : loading ? (
        <Text className="text-base text-muted">Chargement du produit…</Text>
      ) : missing ? (
        <InlineAlert
          title="Produit indisponible"
          message="Ce produit n’existe plus dans les données locales."
        />
      ) : (
        <ProductEditorForm
          initialValue={snapshot ? productSnapshotToDraft(snapshot) : undefined}
          disabled={Boolean(conflictId)}
          onSave={async (draft) => {
            const savedId = await save(draft);
            if (isNew) {
              router.replace(`/(tabs)/products/${savedId}` as Href);
            }
          }}
        />
      )}

      <SecondaryButton
        label="Retour aux produits"
        onPress={() => router.back()}
      />
    </AppScreen>
  );
}
