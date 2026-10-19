import { useAuth } from "../auth/auth-provider";
import { useVisualLibrary } from "./use-visual-library";
import { ProductVisualPanel } from "./product-visual-panel";
import { useState } from "react";
import { Text, View } from "react-native";
import { router, type Href } from "expo-router";
import { randomUUID } from "expo-crypto";
import { explorerHref } from "../analytics/explorer-link";
import { StoreEventsView } from "../needs/store-events-view";
import { SubstitutionView } from "../needs/substitution-view";
import { MembershipView } from "../needs/membership-view";
import {
  AppScreen,
  AppHeader,
  InlineAlert,
  PrimaryButton,
  SecondaryButton,
  SectionCard,
  StatusBadge,
} from "../components/ui";
import { useProductEditor } from "./use-product-editor";
import { categoryLabels, natureLabels, unitLabels } from "./catalogue-view";

export function ProductDetailScreen({ id }: { id: string }) {
  const { session } = useAuth();
  return (
    <ScopedProductDetailScreen
      key={`${session?.stores[0]?.storeId}:${session?.user.id}:${id}`}
      id={id}
    />
  );
}
function ScopedProductDetailScreen({ id }: { id: string }) {
  const { snapshot, conflictId, loading, storeMissing, missing, error } =
    useProductEditor(id);
  const [relations, setRelations] = useState(false);
  const gallery = useVisualLibrary();
  const p = snapshot?.product.entity;
  return (
    <AppScreen>
      <AppHeader
        title={p?.label ?? "Fiche produit"}
        subtitle="Référentiel du magasin"
      />
      <SecondaryButton
        label="Retour aux produits"
        onPress={() => router.navigate("/(tabs)/products")}
      />
      {error ? (
        <InlineAlert title="Actualisation interrompue" message={error} />
      ) : null}
      {storeMissing || missing ? (
        <InlineAlert
          title="Produit indisponible"
          message="Ce produit n’est pas disponible dans le magasin actif."
        />
      ) : loading && !snapshot ? (
        <Text className="text-base text-muted">Chargement de la fiche…</Text>
      ) : p && snapshot ? (
        <>
          <View className="flex-row flex-wrap items-center gap-3">
            <StatusBadge
              status={
                conflictId || snapshot.product.syncState === "CONFLICT"
                  ? "conflict"
                  : snapshot.product.syncState === "ERROR"
                    ? "error"
                    : snapshot.product.dirty
                      ? "pending"
                      : "synced"
              }
            />
            {p.status === "INACTIVE" ? (
              <Text className="text-warning">Produit inactif</Text>
            ) : null}
          </View>
          {conflictId ? (
            <>
              <InlineAlert
                title="Conflit à examiner"
                message="Les deux versions sont conservées. Résolvez le conflit avant de modifier la fiche."
              />
              <SecondaryButton
                label="Examiner le conflit"
                onPress={() =>
                  router.push(`/(tabs)/sync-conflict/${conflictId}` as Href)
                }
              />
            </>
          ) : null}
          <PrimaryButton
            label="Modifier la fiche"
            disabled={Boolean(conflictId)}
            onPress={() => router.push(`/(tabs)/products/edit/${id}` as Href)}
          />
          <ProductVisualPanel
            key={`${p.storeId}:${p.id}:${gallery.context?.actorId}`}
            product={p}
            controller={gallery}
          />
          <SectionCard title="Identité">
            <Detail label="Catégorie" value={categoryLabels[p.category]} />
            <Detail label="Nature" value={natureLabels[p.nature]} />
            <Detail label="Unité de vente" value={unitLabels[p.salesUnit]} />
            <Detail
              label="Conditionnement"
              value={
                p.packaging
                  ? `${p.packaging.quantity.replace(".", ",")} ${packagingLabel(p.packaging.unit)}${p.packaging.sourceLabel ? ` · ${p.packaging.sourceLabel}` : ""}`
                  : "Non renseigné"
              }
            />
          </SectionCard>
          <SectionCard title="Codes et alias">
            {snapshot.identifiers.length ? (
              snapshot.identifiers.map(({ entity: e }) => (
                <Detail
                  key={e.id}
                  label={`${e.type}${e.status !== "VALIDATED" ? " · À confirmer" : ""}`}
                  value={e.value}
                />
              ))
            ) : (
              <Text className="text-sm text-muted">Aucun code renseigné.</Text>
            )}
            {snapshot.aliases.length ? (
              snapshot.aliases.map(({ entity: e }) => (
                <Detail
                  key={e.id}
                  label={`Alias${e.status !== "VALIDATED" ? ` · ${e.status === "REJECTED" ? "Refusé" : "À confirmer"}` : ""}`}
                  value={e.alias}
                />
              ))
            ) : (
              <Text className="text-sm text-muted">Aucun alias renseigné.</Text>
            )}
          </SectionCard>
          <SecondaryButton
            label="Explorer les chiffres de ce produit"
            onPress={() =>
              router.navigate(
                explorerHref({
                  requestId: randomUUID(),
                  filters: { category: null, nature: null, productId: id },
                }),
              )
            }
          />
          <SecondaryButton
            label="Trouver un remplaçant"
            onPress={() =>
              router.push({
                pathname: "/substitutes",
                params: { productId: id },
              } as Href)
            }
          />
          <SecondaryButton
            label="Signaler une observation"
            onPress={() =>
              router.push({
                pathname: "/store-event",
                params: { productId: id },
              } as Href)
            }
          />
          <StoreEventsView productId={id} compact />
          <SecondaryButton
            label={
              relations
                ? "Masquer les besoins et associations"
                : "Voir les besoins et associations"
            }
            onPress={() => setRelations(!relations)}
          />
          {relations ? (
            <>
              <MembershipView productId={id} />
              <SubstitutionView productId={id} />
            </>
          ) : null}
        </>
      ) : null}
    </AppScreen>
  );
}
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View className="gap-1">
      <Text className="text-sm text-muted">{label}</Text>
      <Text selectable className="text-base text-ink">
        {value}
      </Text>
    </View>
  );
}
function packagingLabel(unit: string) {
  return (
    (
      {
        KG: "kg",
        G: "g",
        PIECE: "pièce",
        PACK: "lot",
        BAG: "sachet",
        TRAY: "barquette",
        NET: "filet",
        OTHER: "autre",
      } as Record<string, string>
    )[unit] ?? unit
  );
}
