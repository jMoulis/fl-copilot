import { useCallback, useState } from "react";
import { Text } from "react-native";
import { router, useFocusEffect, type Href } from "expo-router";
import { commercialVersionDecisionSchema } from "@fl-copilot/sync-contracts";
import { commercialVersionDecisionSummary } from "@fl-copilot/commercial-core";
import { useLocalDatabase } from "@/providers/database-provider";
import { SectionCard, SecondaryButton, InlineAlert } from "@/components/ui";
export function CommercialVersionDecisionList({
  storeId,
}: {
  storeId: string;
}) {
  const { sqlite } = useLocalDatabase();
  const [rows, setRows] = useState<
      Array<{ payload_json: string; sync_state: string }>
    >([]),
    [error, setError] = useState(false);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void sqlite
        .getAllAsync<{ payload_json: string; sync_state: string }>(
          "SELECT payload_json,sync_state FROM commercial_version_decisions WHERE store_id=? ORDER BY json_extract(payload_json,'$.updatedAt') DESC LIMIT 10",
          storeId,
        )
        .then((r) => {
          if (active) {
            setRows(r);
            setError(false);
          }
        })
        .catch(() => {
          if (active) setError(true);
        });
      return () => {
        active = false;
      };
    }, [sqlite, storeId]),
  );
  if (error)
    return (
      <InlineAlert
        title="Choix de références indisponibles"
        message="Rouvrez Ma semaine pour relire vos décisions enregistrées."
      />
    );
  if (!rows.length) return null;
  return (
    <SectionCard
      title="Mes choix après correction de PDF"
      description="Les derniers choix enregistrés pour des paires de documents. Chaque choix conserve les offres et les TG déjà préparés."
    >
      {rows.map((row) => {
        const parsed = commercialVersionDecisionSchema.safeParse(
          JSON.parse(row.payload_json),
        );
        if (!parsed.success) return null;
        const d = parsed.data,
          doc = d.preference === "KEEP_PREVIOUS" ? d.before : d.after;
        return (
          <SectionCard
            key={d.id}
            title={
              d.preference === "KEEP_PREVIOUS"
                ? "Ancien PDF conservé"
                : "PDF corrigé préféré"
            }
          >
            <Text selectable className="text-sm text-muted">
              {commercialVersionDecisionSummary(d)}
            </Text>
            <Text className="text-sm text-muted">
              {(
                {
                  PENDING: "À synchroniser",
                  SYNCED: "Synchronisé",
                  CONFLICT: "Conflit à résoudre",
                  ERROR: "Envoi refusé",
                } as Record<string, string>
              )[row.sync_state] ?? row.sync_state}
            </Text>
            <SecondaryButton
              label="Consulter la lecture du PDF choisi"
              onPress={() =>
                router.push(`/commercial-review/${doc.documentId}` as Href)
              }
            />
            <SecondaryButton
              label="Revoir cette comparaison et mon choix"
              onPress={() =>
                router.push({
                  pathname: "/commercial-comparison",
                  params: {
                    beforeId: d.before.documentId,
                    afterId: d.after.documentId,
                  },
                })
              }
            />
          </SectionCard>
        );
      })}
    </SectionCard>
  );
}
