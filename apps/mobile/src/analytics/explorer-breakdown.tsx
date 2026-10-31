import { Text, View, Pressable } from "react-native";
import { explorerHasFilters } from "@fl-copilot/analytics-core";
import {
  defaultAnalyticsProductList,
  type AnalyticsProductList,
  type AnalyticsExplorerFilters,
} from "@fl-copilot/domain";
import { InlineAlert, SecondaryButton } from "../components/ui";
import {
  DetailsDisclosure,
  IconButton,
  SegmentedControl,
} from "../components/dashboard";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors } from "../design/tokens";
import {
  formatCurrency,
  formatSignedCurrency,
  formatSignedPercentage,
} from "../today/today-priority-presentation";
import type { ExplorerRepository } from "./explorer-repository";
import {
  LinkedProductVisual,
  type SharedProductVisuals,
} from "../products/linked-product-visual";
type Data = Awaited<ReturnType<ExplorerRepository["load"]>>;
const categoryLabels = {
  FRUIT: "Fruits",
  VEGETABLE: "Légumes",
  OTHER: "Autres",
  UNKNOWN: "Catégorie à préciser",
};
export function explorerScopeLabel(
  data: Pick<Data, "filters"> & Partial<Pick<Data, "details" | "sourceBasis">>,
) {
  const f = data.filters;
  return (
    [
      f.category ? categoryLabels[f.category] : null,
      f.nature
        ? {
            BULK: "Vrac",
            PACKAGED: "Conditionné",
            UNKNOWN: "Nature à préciser",
          }[f.nature]
        : null,
      f.productIds ? `${f.productIds.length} produits de la sélection` : null,
      f.labelContains ? `Libellé contenant « ${f.labelContains} »` : null,
      f.productId
        ? (data.details?.selectedProduct?.label ?? "Produit sélectionné")
        : null,
    ]
      .filter(Boolean)
      .join(" · ") ||
    (data.sourceBasis === "OBSERVED_PRODUCTS"
      ? "Produits renseignés du rayon"
      : "Ensemble du rayon")
  );
}
export function ExplorerBreakdown({
  data,
  onCategory,
  onProduct,
  onOpenProduct,
  onPage,
  visuals,
  storeId,
  productList = defaultAnalyticsProductList(),
  onProductList,
}: {
  data: Data;
  productList?: AnalyticsProductList;
  onProductList?: (value: AnalyticsProductList) => void;
  onCategory: (c: NonNullable<AnalyticsExplorerFilters["category"]>) => void;
  onProduct: (id: string) => void;
  onOpenProduct: (id: string) => void;
  onPage: (offset: number) => void;
  visuals?: SharedProductVisuals;
  storeId?: string;
}) {
  const details = data.details;
  return (
    <View style={{ gap: 14 }}>
      <Text
        accessibilityRole="header"
        style={{ color: colors.ink, fontSize: 19, fontWeight: "700" }}
      >
        Répartition par produit
      </Text>
      <Text style={{ color: colors.ink }}>{explorerScopeLabel(data)}</Text>
      <DetailsDisclosure title="Comprendre cette répartition">
        <Text style={{ color: colors.muted }}>
          Classement selon les options choisies, sur l’ensemble des produits de
          la sélection et selon le catalogue actuel. Des produits ou journées
          sans montant restent inconnus, jamais à zéro. Ce détail peut différer
          du total du rayon si les sources sont incomplètes.
        </Text>
      </DetailsDisclosure>
      {data.detailsUnavailable ? (
        <InlineAlert
          title="Détail trop volumineux"
          message="Le total du rayon reste disponible. Choisissez une période plus courte ou un produit pour consulter le détail local."
        />
      ) : !details ? null : (
        <>
          {explorerHasFilters(data.filters) &&
          details.observedProductCount === 0 ? (
            <InlineAlert
              title="Aucune journée produit renseignée"
              message="Aucun montant ne correspond à ces filtres sur la période et sa référence. Élargissez les filtres ou consultez les imports."
            />
          ) : null}
          {!data.filters.productId
            ? details.categories.map((c) => (
                <Pressable
                  key={c.category}
                  accessibilityRole="button"
                  accessibilityLabel={`Explorer ${c.label}`}
                  onPress={() => onCategory(c.category)}
                  style={{
                    minHeight: 48,
                    padding: 14,
                    gap: 6,
                    borderRadius: 14,
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.line,
                  }}
                >
                  <Text style={{ color: colors.ink, fontWeight: "600" }}>
                    {c.label} ·{" "}
                    {c.analysis.total === null
                      ? "Indisponible"
                      : formatCurrency(c.analysis.total)}
                  </Text>
                  <Text style={{ color: colors.muted }}>
                    {c.analysis.coverage.complete}/
                    {c.analysis.coverage.expected} jours complets
                  </Text>
                </Pressable>
              ))
            : null}
          {onProductList ? (
            <View style={{ gap: 10 }}>
              <SegmentedControl
                label="Évolution des produits"
                value={productList.trend}
                options={
                  [
                    { value: "ALL", label: "Tous" },
                    { value: "DOWN", label: "En baisse" },
                    { value: "UP", label: "En hausse" },
                    { value: "UNAVAILABLE", label: "Sans comparaison" },
                  ] as const
                }
                onChange={(trend) =>
                  onProductList({
                    ...productList,
                    trend,
                    ...(trend === "DOWN" || trend === "UP"
                      ? {
                          sort: "DIFFERENCE",
                          direction: trend === "DOWN" ? "ASC" : "DESC",
                        }
                      : {}),
                  })
                }
              />
              <SegmentedControl
                label="Trier les produits par"
                value={productList.sort}
                options={
                  [
                    { value: "AMOUNT", label: "Montant €" },
                    { value: "DIFFERENCE", label: "Écart €" },
                    { value: "PERCENTAGE", label: "Évolution %" },
                  ] as const
                }
                onChange={(sort) => onProductList({ ...productList, sort })}
              />
              <SecondaryButton
                label={
                  productList.trend === "DOWN" && productList.sort !== "AMOUNT"
                    ? productList.direction === "ASC"
                      ? "Plus fortes baisses d’abord"
                      : "Plus faibles baisses d’abord"
                    : productList.direction === "DESC"
                      ? "Du plus grand au plus petit"
                      : "Du plus petit au plus grand"
                }
                accessibilityLabel="Inverser l’ordre des produits"
                onPress={() =>
                  onProductList({
                    ...productList,
                    direction: productList.direction === "ASC" ? "DESC" : "ASC",
                  })
                }
              />
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                Écarts sur les jours comparables renseignés.
              </Text>
            </View>
          ) : null}
          {details.contributors.map((p) => (
            <View
              key={p.productId}
              style={{
                padding: 12,
                borderRadius: 16,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.line,
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${data.filters.productId ? "Ouvrir la fiche" : "Explorer"} : ${p.label}. ${p.analysis.total === null ? "Montant indisponible" : formatCurrency(p.analysis.total)}`}
                onPress={() =>
                  data.filters.productId
                    ? onOpenProduct(p.productId)
                    : onProduct(p.productId)
                }
                style={{
                  flex: 1,
                  minHeight: 52,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                {visuals && storeId ? (
                  <LinkedProductVisual
                    productId={p.productId}
                    storeId={storeId}
                    visuals={visuals}
                  />
                ) : null}
                <View style={{ flex: 1, gap: 5 }}>
                  <Text style={{ color: colors.ink, fontWeight: "600" }}>
                    {p.label}
                  </Text>
                  <Text
                    style={{
                      color: colors.ink,
                      fontWeight: "700",
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {p.analysis.total === null
                      ? "Indisponible"
                      : formatCurrency(p.analysis.total)}
                  </Text>
                  <Text
                    style={{
                      color:
                        p.analysis.coverage.partial ||
                        p.analysis.coverage.missing
                          ? colors.warning
                          : colors.muted,
                      fontSize: 12,
                    }}
                  >
                    {p.analysis.coverage.complete}/
                    {p.analysis.coverage.expected} jours complets ·{" "}
                    {p.analysis.coverage.partial} partiels ·{" "}
                    {p.analysis.coverage.missing} sans donnée
                  </Text>
                  {p.analysis.comparison?.absoluteDifference !== null &&
                  p.analysis.comparison ? (
                    <Text style={{ color: colors.muted, fontSize: 12 }}>
                      {formatSignedCurrency(
                        p.analysis.comparison.absoluteDifference!,
                      )}{" "}
                      {p.analysis.comparison.percentageDifference !== null
                        ? `· ${formatSignedPercentage(p.analysis.comparison.percentageDifference)} `
                        : "· pourcentage indisponible "}
                      sur {p.analysis.comparedDays} jours{" "}
                      {data.mode === "EXPLICIT"
                        ? "de la période citée"
                        : "clos comparables · N−1"}
                    </Text>
                  ) : (
                    <Text style={{ color: colors.muted, fontSize: 12 }}>
                      Comparaison indisponible
                    </Text>
                  )}
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={17}
                  color={colors.muted}
                  accessible={false}
                />
              </Pressable>
              {!data.filters.productId ? (
                <IconButton
                  label={`Ouvrir la fiche produit : ${p.label}`}
                  icon="information-circle-outline"
                  onPress={() => onOpenProduct(p.productId)}
                />
              ) : null}
            </View>
          ))}
          {!details.contributors.length ? (
            <Text style={{ color: colors.muted }}>
              Aucun produit ne correspond à cette sélection sur la période.
            </Text>
          ) : (
            <Text style={{ color: colors.muted }}>
              Produits {details.offset + 1} à{" "}
              {details.offset + details.contributors.length} sur{" "}
              {details.totalContributors} correspondants
            </Text>
          )}
          {details.offset > 0 ? (
            <SecondaryButton
              label="Produits précédents"
              onPress={() => onPage(Math.max(0, details.offset - 20))}
            />
          ) : null}
          {details.nextOffset !== null ? (
            <SecondaryButton
              label="Produits suivants"
              onPress={() => onPage(details.nextOffset!)}
            />
          ) : null}
        </>
      )}
    </View>
  );
}
