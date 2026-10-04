import { Text, View } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import {
  AppHeader,
  AppScreen,
  InlineAlert,
  SecondaryButton,
  SectionCard,
  StatusBadge,
} from "@/components/ui";
import {
  formatBusinessDate,
  formatCurrency,
  formatQualityScore,
  formatSignedCurrency,
  formatSignedPercentage,
  jMinus7,
  priorityPresentation,
} from "@/today/today-priority-presentation";
import type { TodayPriority } from "@/today/today-summary";
import { useTodaySummary } from "@/today/use-today-summary";

export default function PriorityDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { loading, storeMissing, summary, error } = useTodaySummary();
  const priority = summary?.priorities.find((item) => item.id === id);

  return (
    <AppScreen>
      <AppHeader
        title={priority ? priority.productLabel : "Détail du signal"}
        subtitle={
          summary
            ? `Journée analysée : ${formatBusinessDate(summary.businessDate)}`
            : "Lecture locale du signal analytique."
        }
      >
        {priority ? (
          <View className="flex-row flex-wrap gap-2 pt-1">
            <View className="self-start rounded-xl bg-forest-soft px-3 py-2">
              <Text className="text-sm font-semibold text-forest">
                Signal déterministe
              </Text>
            </View>
            {summary?.origin === "LOCAL" ? (
              <StatusBadge status="local" />
            ) : null}
          </View>
        ) : null}
      </AppHeader>

      {error ? (
        <InlineAlert title="Lecture impossible" message={error} />
      ) : null}

      {storeMissing ? (
        <InlineAlert
          title="Aucun magasin actif"
          message="Reconnectez-vous après l’ajout de votre magasin."
        />
      ) : loading ? (
        <Text className="text-base text-muted">Chargement du signal…</Text>
      ) : priority && summary ? (
        <PriorityDetail
          priority={priority}
          businessDate={summary.businessDate}
        />
      ) : error ? null : (
        <InlineAlert
          title="Signal indisponible"
          message="Ce signal n’appartient plus aux priorités de la dernière journée analysée."
        />
      )}

      <SecondaryButton
        label="Retour à Aujourd’hui"
        onPress={() => router.back()}
      />
    </AppScreen>
  );
}

function PriorityDetail({
  priority,
  businessDate,
}: {
  priority: TodayPriority;
  businessDate: string;
}) {
  const presentation = priorityPresentation(priority);
  const qualityMessage = priority.incompleteMetricLabels.length
    ? `Qualité analytique : ${formatQualityScore(priority.dataQualityScore)}. Données incomplètes : ${priority.incompleteMetricLabels.join(", ")}.`
    : `Qualité analytique : ${formatQualityScore(priority.dataQualityScore)}.`;

  return (
    <>
      <SectionCard title={presentation.title} description={presentation.reason}>
        {priority.type === "DATA_QUALITY_ALERT" ? (
          <FactRow
            label="Qualité analytique"
            value={formatQualityScore(priority.dataQualityScore)}
            detail={formatBusinessDate(businessDate)}
          />
        ) : (
          <>
            <FactRow
              label={`${presentation.metricLabel} · journée analysée`}
              value={formatCurrency(priority.currentValue) ?? "Indisponible"}
              detail={formatBusinessDate(businessDate)}
            />
            <FactRow
              label={`${presentation.metricLabel} · référence J-7`}
              value={formatCurrency(priority.referenceValue) ?? "Indisponible"}
              detail={formatBusinessDate(jMinus7(businessDate))}
            />
            <FactRow
              label="Écart"
              value={
                priority.absoluteDifference
                  ? formatSignedCurrency(priority.absoluteDifference)
                  : "Indisponible"
              }
              detail={
                formatSignedPercentage(priority.percentageDifference) ??
                "Pourcentage indisponible"
              }
            />
          </>
        )}
      </SectionCard>

      <SectionCard title="Action proposée">
        <Text className="text-base leading-7 text-ink">
          {presentation.action}
        </Text>
        <Text className="text-sm leading-6 text-muted">
          Cette indication sert de contrôle métier. Elle n’enregistre aucune
          décision et ne modifie pas le produit.
        </Text>
      </SectionCard>

      {priority.status === "LOW_QUALITY" ||
      priority.incompleteMetricLabels.length > 0 ? (
        <InlineAlert title="Lecture à confirmer" message={qualityMessage} />
      ) : (
        <SectionCard title="Qualité des données">
          <Text className="text-base leading-7 text-muted">
            {qualityMessage}
          </Text>
        </SectionCard>
      )}

      <SecondaryButton
        label="Ouvrir la fiche produit"
        onPress={() =>
          router.push(`/(tabs)/products/${priority.productId}` as Href)
        }
      />
      {priority.incompleteMetricLabels.length > 0 ? (
        <SecondaryButton
          label="Examiner les imports"
          onPress={() => router.push("/(tabs)/imports" as Href)}
        />
      ) : null}
    </>
  );
}

function FactRow({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <View className="gap-1 border-b border-line pb-4 last:border-b-0 last:pb-0">
      <Text className="text-sm font-semibold text-muted">{label}</Text>
      <Text className="text-2xl font-bold text-ink">{value}</Text>
      <Text className="text-sm text-muted">{detail}</Text>
    </View>
  );
}
