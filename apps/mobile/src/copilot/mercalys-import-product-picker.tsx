import { useMemo, useState } from "react";
import { Text, TextInput, View } from "react-native";
import {
  mercalysProductTargetBlocker,
  searchMercalysProductTargets,
  type MercalysTargetSource,
  type ProductMatchCatalog,
} from "@fl-copilot/domain";
import { SecondaryButton } from "../components/ui";
import { colors } from "../design/tokens";

export const mercalysTargetBlockerText = {
  PRODUCT_UNAVAILABLE: "Ce produit n’est plus actif dans le magasin.",
  IDENTIFIER_OWNED:
    "Un code de cette ligne appartient déjà à un autre produit. Il faut examiner cette identité avant de l’associer.",
  IDENTITY_REVIEW_REQUIRED:
    "Ce code existe déjà mais reste à valider dans les identités du produit.",
  ALIAS_REVIEW_REQUIRED:
    "Ce libellé possède déjà une association à examiner. Elle ne sera ni remplacée ni réactivée ici.",
  SYNC_CONFLICT:
    "Ce produit présente une erreur ou un conflit de synchronisation à résoudre.",
};

export function MercalysImportProductPicker({
  storeId,
  source,
  catalog,
  conflictedProductIds,
  busy,
  onConfirm,
}: {
  storeId: string;
  source: MercalysTargetSource;
  catalog: ProductMatchCatalog;
  conflictedProductIds: readonly string[];
  busy: boolean;
  onConfirm(productId: string): void;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [selectedId, setSelectedId] = useState<string>();
  const matches = useMemo(
    () => searchMercalysProductTargets(storeId, catalog, open ? query : ""),
    [storeId, catalog, open, query],
  );
  const selected = catalog.products.find((p) => p.id === selectedId);
  const blocked = (id: string) =>
    conflictedProductIds.includes(id)
      ? ("SYNC_CONFLICT" as const)
      : mercalysProductTargetBlocker(storeId, source, id, catalog);
  const selectedBlocker = selected ? blocked(selected.id) : null;
  const identifiers = selected
    ? catalog.identifiers.filter(
        (i) =>
          i.storeId === storeId && i.productId === selected.id && !i.deletedAt,
      )
    : [];
  return (
    <View style={{ gap: 8 }}>
      <SecondaryButton
        label={open ? "Fermer la recherche" : "Chercher un autre produit"}
        disabled={busy}
        onPress={() => {
          setOpen(!open);
          setQuery("");
          setSelectedId(undefined);
        }}
      />
      {open ? (
        <>
          <TextInput
            accessibilityLabel="Rechercher un produit par nom, EAN, ITM8 ou PLU"
            placeholder="Nom ou code du produit"
            value={query}
            onChangeText={(value) => {
              setQuery(value);
              setSelectedId(undefined);
            }}
            editable={!busy}
            maxLength={240}
            autoCorrect={false}
            style={{
              padding: 12,
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: 12,
              color: colors.ink,
            }}
          />
          {query.trim() ? (
            <Text accessibilityLiveRegion="polite">
              {matches.total === 0
                ? "Aucun produit actif trouvé dans le référentiel local."
                : matches.total > matches.products.length
                  ? `${matches.products.length} produits affichés sur ${matches.total}. Précisez la recherche.`
                  : `${matches.total} produit${matches.total > 1 ? "s" : ""} trouvé${matches.total > 1 ? "s" : ""}.`}
            </Text>
          ) : (
            <Text>
              Recherchez un produit existant du magasin. Aucun rapprochement
              n’est effectué pendant la recherche.
            </Text>
          )}
          {!selected ? (
            matches.products.map((p) => {
              const reason = blocked(p.id);
              return (
                <View key={p.id} style={{ gap: 4 }}>
                  <SecondaryButton
                    label={`Choisir ${p.label}`}
                    disabled={busy || reason !== null}
                    onPress={() => setSelectedId(p.id)}
                  />
                  {reason ? (
                    <Text>{mercalysTargetBlockerText[reason]}</Text>
                  ) : null}
                </View>
              );
            })
          ) : (
            <View style={{ gap: 8 }}>
              <Text style={{ fontWeight: "600" }}>Vérifier l’association</Text>
              <Text>Dans le fichier : {source.label}</Text>
              <Text>
                {source.identifiers.length
                  ? source.identifiers
                      .map((i) => `${i.type} ${i.value}`)
                      .join(" · ")
                  : "Sans code article : le libellé sera mémorisé comme alias."}
              </Text>
              <Text>Produit retenu : {selected.label}</Text>
              <Text>
                {identifiers.length
                  ? identifiers.map((i) => `${i.type} ${i.value}`).join(" · ")
                  : "Aucun code enregistré sur ce produit."}
              </Text>
              <Text>
                {
                  {
                    BULK: "Vrac",
                    PACKAGED: "Conditionné",
                    UNKNOWN: "Nature à préciser",
                  }[selected.nature]
                }{" "}
                ·{" "}
                {
                  {
                    KG: "kg",
                    PIECE: "pièce",
                    PACK: "unité conditionnée",
                    UNKNOWN: "Unité à préciser",
                  }[selected.salesUnit]
                }
              </Text>
              <Text>
                Cette association sera réutilisée pour les prochains imports.
                Les codes déjà enregistrés et les chiffres du fichier sont
                conservés.
              </Text>
              {selectedBlocker ? (
                <Text>{mercalysTargetBlockerText[selectedBlocker]}</Text>
              ) : null}
              <SecondaryButton
                label="Confirmer cette association"
                disabled={busy || selectedBlocker !== null}
                onPress={() => onConfirm(selected.id)}
              />
              <SecondaryButton
                label="Choisir un autre produit"
                disabled={busy}
                onPress={() => setSelectedId(undefined)}
              />
            </View>
          )}
        </>
      ) : null}
    </View>
  );
}
