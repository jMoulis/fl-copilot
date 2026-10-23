import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import {
  InlineAlert,
  PrimaryButton,
  SecondaryButton,
  SectionCard,
} from "../components/ui";
import { colors } from "../design/tokens";
import type {
  MercalysReconciliation,
  MercalysReconciliationRow,
} from "./mercalys-import-reconciliation";

import type { MercalysImportValidationLine } from "./mercalys-import-validation";

const reasons = {
  UNRESOLVED_PRODUCT: "Le produit de cette ligne reste à confirmer.",
  MULTIPLE_INCOMING_ROWS:
    "Plusieurs lignes ne peuvent pas être distinguées par leur code source à cette date. Vérifiez les associations ci-dessous ; si elles sont correctes, corrigez les doublons dans l’export puis réimportez-le.",
  MULTIPLE_EXISTING_ROWS:
    "Plusieurs observations existantes correspondent à ce produit et à cette date. Le remplacement reste bloqué pour éviter de supprimer une donnée sans rapprochement sûr.",
  UNRESOLVED_ROW_ON_DATE:
    "Un produit du nouveau fichier reste à confirmer pour cette date. Confirmez les produits avant de considérer cette ancienne ligne comme absente.",
};
const labels = {
  UNCHANGED: "Inchangée",
  ADDED: "Nouvelle",
  REMOVED: "Absente du nouveau fichier",
  MODIFIED: "Modifiée",
  AMBIGUOUS: "À résoudre",
};
const fields = [
  ["quantity", "Quantité"],
  ["salesValue", "Vente (€)"],
  ["purchaseValue", "Achat (€)"],
  ["marginValue", "Marge (€)"],
  ["rceValue", "RCE (€)"],
  ["vatValue", "TVA (€)"],
  ["marginRate", "Taux de marge (%)"],
] as const;
type Filter = "REVIEW" | "CHANGED" | "ALL";
const pageSize = 20;

export function MercalysReconciliationReview({
  reconciliation,
  validationMessages = [],
  incomingLines = [],
  productLabels = {},
  onNavigate,
  keptExisting,
  loading,
  onApply,
  onKeep,
  onCancel,
  onReviewProducts,
}: {
  reconciliation: MercalysReconciliation;
  validationMessages?: readonly string[];
  incomingLines?: readonly MercalysImportValidationLine[];
  productLabels?: Readonly<Record<string, string>>;
  onNavigate?(): void;
  keptExisting: boolean;
  loading: boolean;
  onApply(): void;
  onKeep(): void;
  onCancel(): void;
  onReviewProducts(sourceIndex?: number): void;
}) {
  const [filter, setFilter] = useState<Filter>(
    reconciliation.counts.AMBIGUOUS ? "REVIEW" : "CHANGED",
  );
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const rows = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("fr-FR");
    return reconciliation.rows.filter(
      (row) =>
        (filter === "ALL" ||
          (filter === "REVIEW"
            ? row.category === "AMBIGUOUS"
            : row.category !== "UNCHANGED")) &&
        (!term ||
          [
            row.productLabel,
            row.businessDate,
            row.incomingRecord?.itm8,
            row.incomingRecord?.ean,
          ]
            .join(" ")
            .toLocaleLowerCase("fr-FR")
            .includes(term)),
    );
  }, [reconciliation, filter, query]);
  const lastPage = Math.max(0, Math.ceil(rows.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = rows.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize,
  );
  if (keptExisting)
    return (
      <SectionCard title="Décision enregistrée">
        <InlineAlert
          title="Données existantes conservées"
          message="Le nouveau fichier n’a pas modifié les observations locales."
        />
        <SecondaryButton label="Fermer l’examen" onPress={onCancel} />
      </SectionCard>
    );
  return (
    <>
      <SectionCard title="Comparer les deux versions">
        <Text className="text-base text-ink">
          {reconciliation.counts.MODIFIED} modifiées ·{" "}
          {reconciliation.counts.ADDED} nouvelles ·{" "}
          {reconciliation.counts.REMOVED} absentes ·{" "}
          {reconciliation.counts.UNCHANGED} inchangées
        </Text>
        {!reconciliation.safeToApply ? (
          <Text className="text-sm text-warning">
            Des points restent à résoudre. L’existant est conservé.
          </Text>
        ) : null}
        {validationMessages.length ? (
          <InlineAlert
            title="Données du fichier à corriger"
            message={
              validationMessages.join(" · ") +
              ". Vérifiez ces informations dans l’export source avant de réimporter une version corrigée."
            }
          />
        ) : null}
        <View className="flex-row flex-wrap gap-2">
          {(
            [
              ["REVIEW", `À résoudre (${reconciliation.counts.AMBIGUOUS})`],
              ["CHANGED", "Différences"],
              ["ALL", "Toutes les lignes"],
            ] as const
          ).map(([key, label]) => (
            <Pressable
              key={key}
              accessibilityRole="radio"
              aria-checked={filter === key}
              accessibilityState={{ checked: filter === key }}
              onPress={() => {
                setFilter(key);
                setPage(0);
              }}
              className={`min-h-12 justify-center rounded-xl border px-3 py-2 ${filter === key ? "border-forest bg-forest" : "border-line bg-surface"}`}
            >
              <Text
                className={
                  filter === key ? "font-semibold text-on-accent" : "text-ink"
                }
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          accessibilityLabel="Rechercher une ligne par produit ou code"
          placeholder="Produit, ITM8 ou EAN"
          placeholderTextColor={colors.muted}
          className="min-h-12 rounded-xl border border-line px-4 py-3 text-base text-ink"
          value={query}
          maxLength={200}
          onChangeText={(value) => {
            setQuery(value);
            setPage(0);
          }}
        />
        <Text accessibilityLiveRegion="polite" className="text-sm text-muted">
          {rows.length
            ? `${currentPage * pageSize + 1}–${Math.min((currentPage + 1) * pageSize, rows.length)} sur ${rows.length} ligne${rows.length > 1 ? "s" : ""}`
            : "Aucune ligne dans cette sélection."}
        </Text>
        {visible.map((row) => (
          <ComparisonRow
            key={row.key}
            row={row}
            productLabel={
              row.productId ? productLabels[row.productId] : undefined
            }
            incomingLines={incomingLines}
            busy={loading}
            onReviewProducts={onReviewProducts}
          />
        ))}
        {lastPage > 0 ? (
          <View className="gap-2">
            <SecondaryButton
              label="Lignes précédentes"
              disabled={currentPage === 0 || loading}
              onPress={() => {
                setPage(currentPage - 1);
                onNavigate?.();
              }}
            />
            <SecondaryButton
              label="Lignes suivantes"
              disabled={currentPage >= lastPage || loading}
              onPress={() => {
                setPage(currentPage + 1);
                onNavigate?.();
              }}
            />
          </View>
        ) : null}
      </SectionCard>
      <SectionCard title="Appliquer la correction">
        <Text className="text-sm text-muted">
          L’application remplace les observations concernées après une nouvelle
          vérification. L’original et l’historique restent conservés.
        </Text>
        {!reconciliation.safeToApply ? (
          <>
            <Text
              accessibilityLiveRegion="polite"
              className="text-base text-warning"
            >
              {reconciliation.counts.AMBIGUOUS > 0
                ? `Application bloquée : ${reconciliation.counts.AMBIGUOUS} ligne${reconciliation.counts.AMBIGUOUS > 1 ? "s" : ""} à résoudre.`
                : "Application bloquée : des informations du fichier restent à corriger."}{" "}
              Les données publiées sont conservées.
            </Text>
            <SecondaryButton
              label="Afficher les points à résoudre"
              disabled={loading}
              onPress={() => {
                setFilter("REVIEW");
                setQuery("");
                setPage(0);
                onNavigate?.();
              }}
            />
          </>
        ) : null}
        <PrimaryButton
          label={
            reconciliation.safeToApply
              ? "Appliquer la nouvelle version"
              : "Application bloquée — points à résoudre"
          }
          disabled={!reconciliation.safeToApply}
          loading={loading}
          onPress={onApply}
        />
        <SecondaryButton
          label="Conserver l’existant"
          disabled={loading}
          onPress={onKeep}
        />
        <SecondaryButton
          label="Fermer l’examen"
          disabled={loading}
          onPress={onCancel}
        />
      </SectionCard>
    </>
  );
}

function valueText(value: string | null | undefined) {
  if (value == null) return "Non renseigné";
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 4 }).format(
        number,
      )
    : value;
}
function ComparisonRow({
  row,
  productLabel,
  incomingLines,
  busy,
  onReviewProducts,
}: {
  row: MercalysReconciliationRow;
  productLabel?: string;
  incomingLines: readonly MercalysImportValidationLine[];
  busy: boolean;
  onReviewProducts(sourceIndex?: number): void;
}) {
  const values = fields.filter(
    ([key]) =>
      row.existingValues?.[key] != null || row.incomingValues?.[key] != null,
  );
  return (
    <View className="gap-2 border-t border-line pt-4">
      <Text className="text-base font-semibold text-ink">
        {row.productLabel}
      </Text>
      <Text className="text-sm text-muted">
        {row.businessDate.split("-").reverse().join("/")} ·{" "}
        {labels[row.category]}
        {row.incomingSourceIndex === null
          ? ""
          : ` · Ligne source ${row.incomingSourceIndex + 1}`}
      </Text>
      {row.incomingRecord?.itm8 || row.incomingRecord?.ean ? (
        <Text className="text-sm text-muted">
          {[
            row.incomingRecord.itm8 ? `ITM8 ${row.incomingRecord.itm8}` : null,
            row.incomingRecord.ean ? `EAN ${row.incomingRecord.ean}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      ) : null}
      {productLabel ? (
        <Text className="text-sm text-muted">
          Produit associé : {productLabel}
        </Text>
      ) : null}
      {row.reason ? (
        <Text className="text-base text-warning">{reasons[row.reason]}</Text>
      ) : null}
      {row.reason === "MULTIPLE_EXISTING_ROWS" ||
      row.reason === "MULTIPLE_INCOMING_ROWS" ? (
        <View className="gap-2 rounded-xl bg-canvas p-3">
          <Text className="text-sm text-muted">
            Comparaison globale indisponible : plusieurs lignes correspondent à
            cette identité.
          </Text>
          {row.reason === "MULTIPLE_INCOMING_ROWS" ? (
            incomingLines
              .filter((line) =>
                row.incomingSourceIndexes
                  ? row.incomingSourceIndexes.includes(line.record.sourceIndex)
                  : line.record.businessDate === row.businessDate &&
                    line.match.matchedProductId === row.productId,
              )
              .map((line) => (
                <View key={line.record.sourceIndex} className="gap-2">
                  <Text className="text-base text-ink">
                    Ligne source {line.record.sourceIndex + 1} ·{" "}
                    {line.record.rawLabel} · quantité{" "}
                    {valueText(
                      line.record.quantity == null
                        ? null
                        : String(line.record.quantity),
                    )}{" "}
                    · vente{" "}
                    {valueText(
                      line.record.salesValue == null
                        ? null
                        : String(line.record.salesValue),
                    )}{" "}
                    €
                  </Text>
                  <Text className="text-sm text-muted">
                    {[
                      line.record.itm8 && `ITM8 ${line.record.itm8}`,
                      line.record.ean && `EAN ${line.record.ean}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                  <SecondaryButton
                    label={`Corriger l’association de la ligne ${line.record.sourceIndex + 1}`}
                    disabled={busy}
                    onPress={() => onReviewProducts(line.record.sourceIndex)}
                  />
                </View>
              ))
          ) : (
            <Text className="text-sm text-muted">
              {row.existingObservationIds.length} observations existantes
              concernées.
            </Text>
          )}
        </View>
      ) : (
        <View className="gap-1 rounded-xl bg-canvas p-3">
          <Text className="text-xs font-semibold text-muted">
            EXISTANT → NOUVEAU FICHIER
          </Text>
          {values.map(([key, label]) => (
            <Text key={key} className="text-base text-ink">
              {label} : {valueText(row.existingValues?.[key])} →{" "}
              {valueText(row.incomingValues?.[key])}
            </Text>
          ))}
        </View>
      )}
      {row.reason === "UNRESOLVED_PRODUCT" ||
      row.reason === "UNRESOLVED_ROW_ON_DATE" ? (
        <SecondaryButton
          label="Confirmer le produit"
          disabled={busy}
          onPress={() => onReviewProducts(row.incomingSourceIndex ?? undefined)}
        />
      ) : row.incomingSourceIndex !== null &&
        row.reason !== "MULTIPLE_INCOMING_ROWS" ? (
        <SecondaryButton
          label="Corriger l’association"
          disabled={busy}
          onPress={() => onReviewProducts(row.incomingSourceIndex!)}
        />
      ) : null}
    </View>
  );
}
