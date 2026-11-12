import { useState } from "react";
import { Text, View, Pressable } from "react-native";
import {
  explorerHasFilters,
  type ExplorerPeriod,
} from "@fl-copilot/analytics-core";
import {
  defaultAnalyticsProductList,
  type AnalyticsProductList,
  type AnalyticsExplorerMetric,
  type AnalyticsExplorerFilters,
} from "@fl-copilot/domain";
import { BottomSheet, InlineAlert, SecondaryButton } from "../components/ui";
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
import { ProductSparkline } from "./product-sparkline-view";
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
  period,
  metric,
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
  period: ExplorerPeriod;
  metric: AnalyticsExplorerMetric;
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
  const [sortOpen, setSortOpen] = useState(false);
  const sortLabel = {
    AMOUNT: "Montant €",
    DIFFERENCE: "Écart €",
    PERCENTAGE: "Évolution %",
  }[productList.sort];
  const directionLabel =
    productList.trend === "DOWN" && productList.sort !== "AMOUNT"
      ? productList.direction === "ASC"
        ? "Fortes baisses d’abord"
        : "Faibles baisses d’abord"
      : productList.direction === "DESC"
        ? "Décroissant"
        : "Croissant";
  const [info, setInfo] = useState<{
    kind: "category" | "product";
    id: string;
  }>();
  const inspected =
    info?.kind === "category"
      ? details?.categories.find((c) => c.category === info.id)
      : info?.kind === "product"
        ? details?.contributors.find((p) => p.productId === info.id)
        : undefined;
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
                <View
                  key={c.category}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    padding: 14,
                    borderRadius: 14,
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.line,
                  }}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Explorer ${c.label}`}
                    onPress={() => onCategory(c.category)}
                    style={{ flex: 1, minHeight: 48, justifyContent: "center" }}
                  >
                    <Text style={{ color: colors.ink, fontWeight: "600" }}>
                      {c.label} ·{" "}
                      {c.analysis.total === null
                        ? "Indisponible"
                        : formatCurrency(c.analysis.total)}
                    </Text>
                  </Pressable>
                  <IconButton
                    label={`Informations sur les chiffres : ${c.label}`}
                    icon="information-circle-outline"
                    onPress={() =>
                      setInfo({ kind: "category", id: c.category })
                    }
                  />
                </View>
              ))
            : null}
          {onProductList ? (
            <View style={{ gap: 6 }}>
              <View
                accessibilityRole="radiogroup"
                accessibilityLabel="Évolution des produits"
                style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}
              >
                {(
                  [
                    { value: "ALL", label: "Tous" },
                    { value: "DOWN", label: "En baisse" },
                    { value: "UP", label: "En hausse" },
                    { value: "UNAVAILABLE", label: "Sans comparaison" },
                  ] as const
                ).map((option) => (
                  <Pressable
                    key={option.value}
                    accessibilityRole="radio"
                    accessibilityLabel={`Évolution des produits : ${option.label}`}
                    accessibilityState={{
                      checked: productList.trend === option.value,
                    }}
                    onPress={() =>
                      onProductList({
                        ...productList,
                        trend: option.value,
                        ...(option.value === "DOWN" || option.value === "UP"
                          ? {
                              sort: "DIFFERENCE",
                              direction:
                                option.value === "DOWN" ? "ASC" : "DESC",
                            }
                          : {}),
                      })
                    }
                    style={{
                      minHeight: 44,
                      paddingHorizontal: 10,
                      borderRadius: 14,
                      alignItems: "center",
                      justifyContent: "center",
                      borderWidth: 1,
                      borderColor:
                        productList.trend === option.value
                          ? colors.forestSoft
                          : colors.line,
                      backgroundColor:
                        productList.trend === option.value
                          ? colors.forestSoft
                          : colors.surface,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: "600",
                        color:
                          productList.trend === option.value
                            ? colors.forest
                            : colors.muted,
                      }}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Choisir le tri des produits"
                  onPress={() => setSortOpen(true)}
                  style={{
                    minHeight: 44,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 7,
                  }}
                >
                  <Ionicons
                    name="options-outline"
                    size={15}
                    color={colors.muted}
                    accessible={false}
                  />
                  <Text
                    style={{
                      fontSize: 12,
                      color: colors.ink,
                      fontWeight: "600",
                    }}
                  >
                    {sortLabel}
                  </Text>
                  <Ionicons
                    name="chevron-down"
                    size={12}
                    color={colors.muted}
                    accessible={false}
                  />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Inverser l’ordre des produits"
                  onPress={() =>
                    onProductList({
                      ...productList,
                      direction:
                        productList.direction === "ASC" ? "DESC" : "ASC",
                    })
                  }
                  style={{
                    minHeight: 44,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 5,
                    flexShrink: 1,
                  }}
                >
                  <Text
                    style={{ fontSize: 11, color: colors.muted, flexShrink: 1 }}
                  >
                    {directionLabel}
                  </Text>
                  <Ionicons
                    name={
                      productList.direction === "DESC"
                        ? "arrow-down"
                        : "arrow-up"
                    }
                    size={13}
                    color={colors.muted}
                    accessible={false}
                  />
                </Pressable>
              </View>
              <Text style={{ color: colors.muted, fontSize: 11 }}>
                Écarts sur les jours comparables renseignés.
              </Text>
            </View>
          ) : null}
          {details.contributors.map((p) => {
            const percentage = p.analysis.comparison?.percentageDifference;
            const absolute = p.analysis.comparison?.absoluteDifference;
            const change = percentage ?? absolute;
            const direction =
              change === null || change === undefined ? null : Number(change);
            const changeLabel =
              percentage !== null && percentage !== undefined
                ? formatSignedPercentage(percentage)
                : absolute !== null && absolute !== undefined
                  ? formatSignedCurrency(absolute)
                  : null;
            const unfavorable =
              direction !== null &&
              (metric === "waste" || metric === "wasteCost"
                ? direction > 0
                : direction < 0);
            const tone =
              direction === null || direction === 0
                ? colors.muted
                : unfavorable
                  ? colors.critical
                  : colors.positive;
            return (
              <View
                key={p.productId}
                style={{
                  paddingVertical: 10,
                  paddingLeft: 10,
                  paddingRight: 2,
                  borderRadius: 20,
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.line,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 2,
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${data.filters.productId ? "Ouvrir la fiche" : "Explorer"} : ${p.label}. ${p.analysis.total === null ? "Montant indisponible" : formatCurrency(p.analysis.total)}${changeLabel !== null ? `. ${p.analysis.comparisonStatus === "partial" ? "Comparaison indicative : " : "Évolution : "}${changeLabel}` : ""}`}
                  onPress={() =>
                    data.filters.productId
                      ? onOpenProduct(p.productId)
                      : onProduct(p.productId)
                  }
                  style={{
                    flex: 1,
                    minWidth: 0,
                    minHeight: 64,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  {visuals && storeId ? (
                    <LinkedProductVisual
                      productId={p.productId}
                      storeId={storeId}
                      visuals={visuals}
                      size={48}
                    />
                  ) : null}
                  <View style={{ flex: 1, minWidth: 0, gap: 7 }}>
                    <Text
                      numberOfLines={2}
                      style={{
                        color: colors.ink,
                        fontWeight: "600",
                        fontSize: 13,
                        lineHeight: 18,
                        letterSpacing: -0.1,
                      }}
                    >
                      {p.label}
                    </Text>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        flexWrap: "wrap",
                        columnGap: 8,
                        rowGap: 3,
                      }}
                    >
                      <Text
                        style={{
                          color: colors.ink,
                          fontWeight: "700",
                          fontSize: 14,
                          fontVariant: ["tabular-nums"],
                        }}
                      >
                        {p.analysis.total === null
                          ? "Indisponible"
                          : formatCurrency(p.analysis.total)}
                      </Text>
                      {changeLabel !== null ? (
                        <Text
                          style={{
                            color: tone,
                            fontSize: 11,
                            fontWeight: "600",
                            fontVariant: ["tabular-nums"],
                          }}
                        >
                          {p.analysis.comparisonStatus === "partial"
                            ? "≈ "
                            : ""}
                          {changeLabel}
                        </Text>
                      ) : (
                        <Text style={{ color: colors.muted, fontSize: 10 }}>
                          Sans comparaison
                        </Text>
                      )}
                    </View>
                  </View>
                  <ProductSparkline
                    period={period}
                    points={p.analysis.points}
                  />
                  <Ionicons
                    name="chevron-forward"
                    size={13}
                    color={colors.muted}
                    accessible={false}
                  />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Informations sur les chiffres : ${p.label}`}
                  onPress={() => setInfo({ kind: "product", id: p.productId })}
                  style={{
                    width: 44,
                    minHeight: 48,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons
                    name="information-circle-outline"
                    size={18}
                    color={colors.muted}
                    accessible={false}
                  />
                </Pressable>
              </View>
            );
          })}
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
      <BottomSheet
        visible={sortOpen}
        title="Trier les produits"
        onClose={() => setSortOpen(false)}
        swipeToClose
      >
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
          onChange={(sort) => {
            onProductList?.({ ...productList, sort });
            setSortOpen(false);
          }}
        />
        <Text style={{ color: colors.muted }}>
          Les filtres et la période restent ceux de ton analyse. Les écarts
          utilisent les journées comparables renseignées.
        </Text>
      </BottomSheet>
      <BottomSheet
        visible={!!inspected}
        title={inspected?.label ?? "Informations sur les chiffres"}
        onClose={() => setInfo(undefined)}
        swipeToClose
      >
        {inspected ? (
          <View style={{ gap: 12 }}>
            <Text style={{ color: colors.ink }}>
              {inspected.analysis.coverage.complete}/
              {inspected.analysis.coverage.expected} jours complets ·{" "}
              {inspected.analysis.coverage.partial} partiels ·{" "}
              {inspected.analysis.coverage.missing} sans donnée
            </Text>
            {inspected.analysis.comparison?.absoluteDifference !== null &&
            inspected.analysis.comparison ? (
              <Text style={{ color: colors.ink }}>
                {formatSignedCurrency(
                  inspected.analysis.comparison.absoluteDifference!,
                )}
                {inspected.analysis.comparison.percentageDifference !== null
                  ? ` · ${formatSignedPercentage(inspected.analysis.comparison.percentageDifference)}`
                  : " · pourcentage indisponible"}{" "}
                sur {inspected.analysis.comparedDays} jours{" "}
                {data.mode === "EXPLICIT"
                  ? "de la période citée"
                  : "clos comparables · N−1"}
                .
                {inspected.analysis.comparisonStatus === "partial"
                  ? " Comparaison indicative sur les journées renseignées."
                  : ""}
              </Text>
            ) : (
              <Text style={{ color: colors.muted }}>
                Comparaison indisponible.
              </Text>
            )}
            <Text style={{ color: colors.muted }}>
              Ces informations concernent l’indicateur et la période
              sélectionnés. Une journée sans donnée reste inconnue, pas à zéro.
              Les écarts portent sur les jours comparables renseignés.
            </Text>
            {info?.kind === "product" ? (
              <Text style={{ color: colors.muted }}>
                La courbe suit l’indicateur sur la période sélectionnée, avec sa
                propre échelle. Les périodes longues sont regroupées par mois ;
                les points sans donnée ne sont pas reliés.
              </Text>
            ) : null}
            {info?.kind === "product" ? (
              <SecondaryButton
                label="Ouvrir la fiche produit"
                onPress={() => {
                  setInfo(undefined);
                  onOpenProduct(info.id);
                }}
              />
            ) : null}
          </View>
        ) : null}
      </BottomSheet>
    </View>
  );
}
