import { Text, View, Pressable } from "react-native";
import { explorerHasFilters } from "@fl-copilot/analytics-core";
import type { AnalyticsExplorerFilters } from "@fl-copilot/domain";
import { InlineAlert, SecondaryButton } from "../components/ui";
import { colors } from "../design/tokens";
import {
  formatCurrency,
  formatSignedCurrency,
} from "../today/today-priority-presentation";
import type { ExplorerRepository } from "./explorer-repository";
type Data = Awaited<ReturnType<ExplorerRepository["load"]>>;
const categoryLabels = {
  FRUIT: "Fruits",
  VEGETABLE: "Légumes",
  OTHER: "Autres",
  UNKNOWN: "Catégorie à préciser",
};
export function explorerScopeLabel(data: Data) {
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
      f.productId
        ? (data.details?.selectedProduct?.label ?? "Produit indisponible")
        : null,
    ]
      .filter(Boolean)
      .join(" · ") || "Ensemble du rayon"
  );
}
export function ExplorerBreakdown({
  data,
  onCategory,
  onProduct,
  onOpenProduct,
  onPage,
}: {
  data: Data;
  onCategory: (c: NonNullable<AnalyticsExplorerFilters["category"]>) => void;
  onProduct: (id: string) => void;
  onOpenProduct: (id: string) => void;
  onPage: (offset: number) => void;
}) {
  const details = data.details;
  return (
    <View style={{ gap: 14 }}>
      <Text
        accessibilityRole="header"
        style={{ color: colors.ink, fontSize: 19, fontWeight: "700" }}
      >
        Détail des montants renseignés
      </Text>
      <Text style={{ color: colors.ink }}>{explorerScopeLabel(data)}</Text>
      <Text style={{ color: colors.muted }}>
        Classement par montant décroissant, selon le catalogue actuel. Des
        produits ou journées sans montant restent inconnus, jamais à zéro. Ce
        détail peut différer du total du rayon si les sources sont incomplètes.
      </Text>
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
          {details.contributors.map((p) => (
            <View
              key={p.productId}
              style={{
                gap: 8,
                padding: 14,
                borderRadius: 14,
                backgroundColor: colors.surface,
              }}
            >
              <Text style={{ color: colors.ink, fontWeight: "600" }}>
                {p.label}
              </Text>
              <Text style={{ color: colors.ink }}>
                {p.analysis.total === null
                  ? "Indisponible"
                  : formatCurrency(p.analysis.total)}
              </Text>
              <Text style={{ color: colors.muted }}>
                {p.analysis.coverage.complete}/{p.analysis.coverage.expected}{" "}
                jours complets · {p.analysis.coverage.partial} partiels ·{" "}
                {p.analysis.coverage.missing} sans donnée
              </Text>
              {p.analysis.comparison?.absoluteDifference !== null &&
              p.analysis.comparison ? (
                <Text style={{ color: colors.muted }}>
                  {formatSignedCurrency(
                    p.analysis.comparison.absoluteDifference!,
                  )}{" "}
                  sur {p.analysis.comparedDays} jours clos comparables en N−1
                </Text>
              ) : null}
              {!data.filters.productId ? (
                <SecondaryButton
                  label="Explorer ce produit"
                  onPress={() => onProduct(p.productId)}
                />
              ) : null}
              <SecondaryButton
                label="Ouvrir la fiche produit"
                onPress={() => onOpenProduct(p.productId)}
              />
            </View>
          ))}
          {!details.contributors.length ? (
            <Text style={{ color: colors.muted }}>
              Aucun montant produit renseigné sur cette période.
            </Text>
          ) : (
            <Text style={{ color: colors.muted }}>
              Produits {details.offset + 1} à{" "}
              {details.offset + details.contributors.length} sur{" "}
              {details.totalContributors} renseignés
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
