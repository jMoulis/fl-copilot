import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { readCommercialComparison } from "@/commercial/comparison-repository";
import { commercialChoiceSummary } from "@/commercial/choice-presentation";
import { CommercialOriginalButton } from "@/commercial/original-button";
import type { CommercialComparedOffer } from "@fl-copilot/commercial-core";
import {
  AppScreen,
  AppHeader,
  SectionCard,
  SecondaryButton,
  PrimaryButton,
  InlineAlert,
} from "@/components/ui";
type Document = {
  id: string;
  name: string;
  createdAt: string | null;
  checksum: string | null;
};
const statuses = {
  CHANGED: "Changements proposés",
  UNCHANGED: "Lecture identique",
  NOT_FOUND_IN_NEW: "Non retrouvée dans la nouvelle lecture",
  NEW_IN_READING: "Nouvelle dans la lecture",
  AMBIGUOUS: "Correspondance à examiner",
};
const fields: Record<string, string> = {
  PRICE: "Prix ou mécanisme",
  DATES: "Dates de vente",
  PRODUCT: "Identité ou caractéristiques produit",
  CONDITIONS: "Conditions d’achat ou applicabilité",
  DEADLINES: "Échéances ou communication",
  BASE_PRICE: "Prix de base indépendant de l’avantage carte",
};
export default function CommercialComparisonScreen() {
  const { session } = useAuth(),
    storeId = session?.stores[0]?.storeId;
  const { sqlite } = useLocalDatabase();
  const [documents, setDocuments] = useState<Document[]>([]),
    [oldId, setOldId] = useState(""),
    [newId, setNewId] = useState(""),
    [result, setResult] =
      useState<Awaited<ReturnType<typeof readCommercialComparison>>>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [expanded, setExpanded] = useState<Record<string, boolean>>({});
  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (storeId)
        void sqlite
          .getAllAsync<{
            id: string;
            name: string | null;
            createdAt: string | null;
            checksum: string | null;
          }>(
            `SELECT d.id, d.original_filename AS name,d.created_at AS createdAt,d.checksum AS checksum FROM source_documents d WHERE d.store_id=? AND d.source_type='WEEKLY_COMMERCIAL_PDF' AND d.deleted_at IS NULL UNION SELECT v.source_document_id AS id, NULL AS name,NULL AS createdAt,v.checksum AS checksum FROM commercial_visual_readings v WHERE v.store_id=? AND NOT EXISTS(SELECT 1 FROM source_documents d WHERE d.id=v.source_document_id AND d.store_id=v.store_id)`,
            storeId,
            storeId,
          )
          .then((rows) => {
            if (active)
              setDocuments(
                rows.map((r) => ({
                  id: r.id,
                  name: r.name ?? "Document commercial restauré",
                  createdAt: r.createdAt,
                  checksum: r.checksum,
                })),
              );
          })
          .catch(() => {
            if (active)
              setError(
                "Les documents ne peuvent pas être lus sur cet appareil.",
              );
          });
      return () => {
        active = false;
      };
    }, [sqlite, storeId]),
  );
  async function compare() {
    if (!storeId || busy) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      setResult(await readCommercialComparison(sqlite, storeId, oldId, newId));
    } catch {
      setError(
        "Les documents ne peuvent pas être comparés. Choisissez deux PDF différents du magasin et synchronisez leurs lectures.",
      );
    } finally {
      setBusy(false);
    }
  }
  function offer(o: CommercialComparedOffer) {
    return (
      <View
        key={`${o.readingId}:${o.operationIndex}:${o.itemIndex}`}
        className="gap-2"
      >
        <Text className="font-semibold text-ink">
          {o.label} · page {o.pageNumber}
        </Text>
        <Text selectable className="text-sm text-muted">
          {o.operationLabel}
        </Text>
        {o.rawFields
          .filter((f) =>
            [
              "saleStart",
              "saleEnd",
              "sellingPrice",
              "priceOperator",
              "salesUnit",
              "customerMechanism",
              "applicabilityCondition",
              "preorderDeadline",
              "supplierCondition",
            ].includes(f.name),
          )
          .map((f, i) => (
            <Text key={i} selectable className="text-base text-ink">
              {f.rawValue ?? "À préciser"}
            </Text>
          ))}
        <Text selectable className="text-sm text-muted">
          {o.quotes.join("\n")}
        </Text>
        <SecondaryButton
          label="Ouvrir cette offre source"
          onPress={() =>
            router.push({
              pathname: "/commercial-offer/[id]",
              params: {
                id: o.readingId,
                operationIndex: String(o.operationIndex),
                itemIndex: String(o.itemIndex),
              },
            })
          }
        />
      </View>
    );
  }
  const display = result?.comparison.differences.filter(
    (d) => d.status !== "UNCHANGED" || expanded.identical,
  );
  return (
    <AppScreen>
      <AppHeader
        title="Comparer deux PDF"
        subtitle="Vérifier une correction sans remplacer les sources, vos choix ni vos TG."
      />
      <SecondaryButton
        label="Retour à Ma semaine"
        onPress={() => router.back()}
      />
      {error ? (
        <InlineAlert title="Comparaison indisponible" message={error} />
      ) : null}
      <SectionCard title="Ancien document">
        {documents.map((d) => (
          <SecondaryButton
            key={d.id}
            label={`${oldId === d.id ? "✓ " : ""}${d.name}${d.createdAt ? ` · ${new Date(d.createdAt).toLocaleString("fr-FR")}` : ""}${d.checksum ? ` · ${d.checksum.slice(-8)}` : ""}`}
            disabled={busy}
            onPress={() => {
              setOldId(d.id);
              setResult(undefined);
            }}
          />
        ))}
      </SectionCard>
      <SectionCard title="Nouveau document">
        {documents
          .filter((d) => d.id !== oldId)
          .map((d) => (
            <SecondaryButton
              key={d.id}
              label={`${newId === d.id ? "✓ " : ""}${d.name}${d.createdAt ? ` · ${new Date(d.createdAt).toLocaleString("fr-FR")}` : ""}${d.checksum ? ` · ${d.checksum.slice(-8)}` : ""}`}
              onPress={() => {
                if (busy) return;
                setNewId(d.id);
                setResult(undefined);
              }}
            />
          ))}
      </SectionCard>
      {oldId ? (
        <SectionCard title="Original choisi comme ancien">
          <CommercialOriginalButton sourceDocumentId={oldId} />
        </SectionCard>
      ) : null}
      {newId ? (
        <SectionCard title="Original choisi comme nouveau">
          <CommercialOriginalButton sourceDocumentId={newId} />
        </SectionCard>
      ) : null}
      <PrimaryButton
        label={busy ? "Comparaison…" : "Comparer les lectures"}
        disabled={busy || !oldId || !newId || oldId === newId}
        onPress={() => void compare()}
      />
      {documents.length < 2 ? (
        <InlineAlert
          title="Deux documents nécessaires"
          message="Importez le PDF corrigé dans Ma semaine, puis attendez sa lecture. Un fichier strictement identique conserve la source existante."
        />
      ) : null}
      {result ? (
        <>
          <SectionCard title="Résultat de la comparaison">
            <Text className="text-base text-ink">
              {result.comparison.counts.CHANGED} changements ·{" "}
              {result.comparison.counts.NEW_IN_READING} nouvelles occurrences ·{" "}
              {result.comparison.counts.NOT_FOUND_IN_NEW} non retrouvées ·{" "}
              {result.comparison.counts.AMBIGUOUS} correspondances à examiner
            </Text>
            <Text className="text-sm text-muted">
              La comparaison repose sur les lectures IA. Une absence ne prouve
              pas une suppression dans le PDF. Les rapprochements par libellé ou
              identifiant source restent à vérifier ; aucune identité produit
              n’est validée ici.
            </Text>
            <SecondaryButton
              label={
                expanded.identical
                  ? "Masquer les lectures identiques"
                  : "Voir aussi les lectures identiques"
              }
              onPress={() =>
                setExpanded((old) => ({ ...old, identical: !old.identical }))
              }
            />
          </SectionCard>
          {!result.comparison.beforeCoverage.complete ||
          !result.comparison.afterCoverage.complete ? (
            <InlineAlert
              title="Comparaison partielle"
              message={`Pages disponibles : ancien ${result.comparison.beforeCoverage.ready}/${result.comparison.beforeCoverage.total}, nouveau ${result.comparison.afterCoverage.ready}/${result.comparison.afterCoverage.total}. Les éléments non retrouvés peuvent simplement manquer dans la lecture.`}
            />
          ) : null}
          {result.comparison.sameBinary ? (
            <InlineAlert
              title="Même fichier original"
              message="Les empreintes des deux fichiers sont identiques. Une variation de lecture ne prouve pas une correction du document."
            />
          ) : null}
          <SectionCard title="PDF originaux">
            <CommercialOriginalButton sourceDocumentId={oldId} />
            <CommercialOriginalButton sourceDocumentId={newId} />
          </SectionCard>
          {display?.map((d) => (
            <SectionCard
              key={d.key}
              title={`${statuses[d.status]} · ${d.before[0]?.label ?? d.after[0]?.label ?? "Offre"}`}
              description={
                d.changedFields.map((f) => fields[f] ?? f).join(" · ") ||
                "Correspondance proposée à partir de la source"
              }
            >
              {d.status === "AMBIGUOUS" ? (
                <InlineAlert
                  title="Plusieurs variantes ou identité insuffisante"
                  message="Aucune version n’est choisie automatiquement. Comparez les références avant de décider."
                />
              ) : null}
              {d.before.length ? (
                <>
                  <Text className="font-semibold text-ink">
                    Ancienne lecture
                  </Text>
                  {d.before.map(offer)}
                </>
              ) : null}
              {d.after.length ? (
                <>
                  <Text className="font-semibold text-ink">
                    Nouvelle lecture
                  </Text>
                  {d.after.map(offer)}
                </>
              ) : null}
              {result.impacts
                .find((i) => i.key === d.key)
                ?.choices.map((impact) => (
                  <View key={impact.choice.entity.id} className="gap-2">
                    <Text className="font-semibold text-ink">
                      Votre choix conservé
                    </Text>
                    <Text className="text-base text-ink">
                      {commercialChoiceSummary(impact.choice.entity)}
                    </Text>
                    {impact.plans.length ? (
                      <InlineAlert
                        title="Préparation à revoir avant validation finale"
                        message={`${impact.plans.length} brouillon(s) utilisent ce choix. Les affectations et la version choisie restent inchangées.`}
                      />
                    ) : null}
                    <SecondaryButton
                      label="Revoir mon choix existant"
                      onPress={() =>
                        router.push({
                          pathname: "/commercial-offer/[id]",
                          params: {
                            id: impact.choice.entity.source.readingId,
                            operationIndex: String(
                              impact.choice.entity.source.operationIndex,
                            ),
                            itemIndex: String(
                              impact.choice.entity.source.itemIndex,
                            ),
                          },
                        })
                      }
                    />
                  </View>
                ))}
            </SectionCard>
          ))}
        </>
      ) : null}
    </AppScreen>
  );
}
