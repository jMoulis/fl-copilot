import { useState } from "react";
import { Text } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useAuth } from "@/auth/auth-provider";
import {
  AppHeader,
  AppScreen,
  InlineAlert,
  PrimaryButton,
  SecondaryButton,
  SectionCard,
} from "@/components/ui";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import { ImportVerificationConflictRepository } from "@/documents/import-verification-conflict-repository";
import { useImportVerificationConflict } from "@/documents/use-import-verification-conflicts";

export default function ImportVerificationConflictScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { session } = useAuth();
  const { sqlite } = useLocalDatabase();
  const { syncNow } = useSync();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const storeId = session?.stores[0]?.storeId;
  const conflict = useImportVerificationConflict(id, storeId);

  const keepLocal = async () => {
    if (!id || !storeId || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await new ImportVerificationConflictRepository(
        sqlite,
      ).keepLocalTemporarily(id, storeId);
      await syncNow(storeId);
      router.replace("/(tabs)/sync");
    } catch {
      setError("La décision n’a pas pu être enregistrée dans la base locale.");
      setSaving(false);
    }
  };

  return (
    <AppScreen>
      <AppHeader
        title="Vérification distante différente"
        subtitle="Les données locales et la vérification distante ne correspondent pas exactement."
      />

      {conflict === undefined ? (
        <Text className="text-base text-muted">Chargement de l’écart…</Text>
      ) : conflict === null ? (
        <InlineAlert
          title="Vérification indisponible"
          message="Cet écart n’existe plus ou a déjà été traité."
        />
      ) : (
        <>
          <InlineAlert
            title="Données locales conservées"
            message="Les observations déjà publiées restent disponibles et n’ont pas été remplacées."
          />

          <SectionCard title="Import concerné">
            <DetailLine
              label="Source"
              value={
                conflict.sourceType === "MERCALYS_SALES"
                  ? "Ventes Mercalys"
                  : "Casse Mercalys"
              }
            />
            <DetailLine
              label="Fichier"
              value={conflict.filename ?? "Nom indisponible"}
            />
            <DetailLine
              label="Période"
              value={formatPeriod(
                conflict.businessPeriodStart,
                conflict.businessPeriodEnd,
              )}
            />
            <DetailLine
              label="Lignes locales"
              value={String(conflict.localRecordCount)}
            />
          </SectionCard>

          <SectionCard title="Décision">
            <Text className="text-base leading-6 text-muted">
              Vous pouvez continuer avec les données locales pendant que cet
              écart reste conservé pour audit. Aucune observation ne sera
              modifiée par cette action.
            </Text>
            {error ? (
              <InlineAlert title="Enregistrement impossible" message={error} />
            ) : null}
            {conflict.status === "OPEN" ? (
              <PrimaryButton
                label="Conserver temporairement les données locales"
                loading={saving}
                disabled={!storeId}
                onPress={() => void keepLocal()}
              />
            ) : (
              <InlineAlert
                title="Décision enregistrée"
                message="Les données locales sont conservées temporairement."
              />
            )}
          </SectionCard>
        </>
      )}

      <SecondaryButton label="Retour" onPress={() => router.back()} />
    </AppScreen>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <Text className="text-base leading-6 text-ink">
      <Text className="font-semibold">{label} : </Text>
      {value}
    </Text>
  );
}

function formatPeriod(start: string | null, end: string | null) {
  if (!start || !end) return "Indisponible";
  if (start === end) return formatDate(start);
  return `${formatDate(start)} – ${formatDate(end)}`;
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}
