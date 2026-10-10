import { useCallback, useMemo, useState } from "react";
import { Text, View, Switch } from "react-native";
import { router, useFocusEffect, type Href } from "expo-router";
import { digestStringAsync, CryptoDigestAlgorithm } from "expo-crypto";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import {
  ProductSubstitutionRepository,
  type LocalProductSubstitution,
} from "./substitution-repository";
import { NeedUnitRepository } from "./repository";
import { ProductMasterRepository } from "@/products/product-master-repository";
import { SectionCard, SecondaryButton, InlineAlert } from "@/components/ui";
import {
  substitutionState,
  substitutionPercent,
  substitutionSyncState,
  selectSubstitutions,
} from "./substitution-details";
import {
  readSubstitutionMarginContext,
  sourceMarginLabel,
  type SourceMarginContext,
} from "./substitution-context";
export function SubstitutionView({ productId }: { productId: string }) {
  const { session } = useAuth(),
    storeId = session?.stores[0]?.storeId,
    { sqlite } = useLocalDatabase(),
    { status: syncStatus } = useSync();
  const repo = useMemo(
    () =>
      new ProductSubstitutionRepository(sqlite, (s) =>
        digestStringAsync(CryptoDigestAlgorithm.SHA256, s),
      ),
    [sqlite],
  );
  const [snapshot, setSnapshot] = useState<{
      scope: string;
      rows: LocalProductSubstitution[];
      labels: Record<string, string>;
      needs: Record<string, string>;
      margins: Record<string, SourceMarginContext>;
    }>(),
    [showRejected, setShowRejected] = useState(false),
    [showIncoming, setShowIncoming] = useState(false),
    [error, setError] = useState<string>();
  const scope = `${storeId}:${productId}`;
  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (storeId)
        void (async () => {
          const [all, p, n] = await Promise.all([
            repo.list(storeId),
            new ProductMasterRepository(sqlite).listProducts(storeId),
            new NeedUnitRepository(sqlite).list(storeId),
          ]);
          const rows = all.filter(
            (r) =>
              r.entity.sourceProductId === productId ||
              r.entity.substituteProductId === productId,
          );
          const margins = await readSubstitutionMarginContext(
            sqlite,
            storeId,
            rows.flatMap((r) => [
              r.entity.sourceProductId,
              r.entity.substituteProductId,
            ]),
          );
          if (active) {
            setSnapshot({
              scope,
              rows,
              labels: Object.fromEntries(
                p.map((r) => [r.entity.id, r.entity.label]),
              ),
              needs: Object.fromEntries(
                n.map((r) => [r.entity.id, r.entity.name]),
              ),
              margins,
            });
            setError(undefined);
          }
        })().catch(() => {
          if (active && syncStatus !== "syncing")
            setError(
              "Les relations locales ne peuvent pas être lues. Les données déjà affichées restent disponibles.",
            );
        });
      return () => {
        active = false;
      };
    }, [repo, sqlite, storeId, productId, scope, syncStatus]),
  );
  const data = snapshot?.scope === scope ? snapshot : undefined,
    rows =
      data && storeId
        ? selectSubstitutions(
            data.rows,
            storeId,
            productId,
            showIncoming,
            showRejected,
          )
        : [];
  return (
    <SectionCard title="Substitutions">
      <Text className="text-muted">
        Un remplaçant répond au même besoin client. La relation inverse doit
        être décidée séparément ; elle n’est jamais créée automatiquement.
      </Text>
      <SecondaryButton
        label="Ajouter un remplaçant"
        disabled={!storeId}
        onPress={() =>
          router.push({
            pathname: "/product-substitution",
            params: { productId },
          } as Href)
        }
      />
      <View className="flex-row items-center justify-between">
        <Text className="flex-1 text-ink">
          Voir les produits que celui-ci peut remplacer
        </Text>
        <Switch
          accessibilityLabel="Afficher les relations entrantes"
          value={showIncoming}
          onValueChange={setShowIncoming}
        />
      </View>
      <View className="flex-row items-center justify-between">
        <Text className="flex-1 text-ink">
          Afficher aussi les relations rejetées
        </Text>
        <Switch
          accessibilityLabel="Afficher les relations rejetées"
          value={showRejected}
          onValueChange={setShowRejected}
        />
      </View>
      {data ? (
        rows.length ? (
          rows.map((r) => {
            const e = r.entity,
              source =
                data.labels[e.sourceProductId] ?? "Produit source indisponible",
              substitute =
                data.labels[e.substituteProductId] ?? "Remplaçant indisponible";
            return (
              <View
                key={e.id}
                className="gap-2 rounded-xl border border-line p-3"
              >
                <Text className="font-semibold text-ink">
                  {source} → {substitute}
                </Text>
                <Text className="text-muted">
                  Besoin : {data.needs[e.needUnitId] ?? "Besoin indisponible"} ·{" "}
                  {substitutionState(e)} · {substitutionSyncState(r.syncState)}
                </Text>
                <Text className="text-muted">
                  Compatibilité déclarée : besoin{" "}
                  {substitutionPercent(e.needCompatibility)} · usage{" "}
                  {substitutionPercent(e.usageCompatibility)} · prix{" "}
                  {substitutionPercent(e.priceCompatibility)} · conditionnement{" "}
                  {substitutionPercent(e.packagingCompatibility)}
                </Text>
                <Text className="text-muted">
                  Score appris :{" "}
                  {e.relationshipScore === null
                    ? "Non calculé"
                    : substitutionPercent(e.relationshipScore)}{" "}
                  · confiance apprise : {substitutionPercent(e.confidence)} ·{" "}
                  {e.evidenceCount} observation(s)
                </Text>
                {e.lastEvidenceAt ? (
                  <Text className="text-muted">
                    Dernière observation :{" "}
                    {new Date(e.lastEvidenceAt).toLocaleDateString("fr-FR")}
                  </Text>
                ) : null}
                <Text className="text-muted">
                  Origine :{" "}
                  {
                    {
                      MANUAL: "déclaration manuelle",
                      AI_PROPOSED: "proposition IA",
                      LEARNED: "apprentissage audité",
                    }[e.source]
                  }
                </Text>
                <Text className="font-semibold text-ink">
                  Contexte de marge Mercalys
                </Text>
                <Text className="text-muted">
                  {source} :{" "}
                  {sourceMarginLabel(data.margins[e.sourceProductId])}
                </Text>
                <Text className="text-muted">
                  {substitute} :{" "}
                  {sourceMarginLabel(data.margins[e.substituteProductId])}
                </Text>
                <Text className="text-muted">
                  Valeurs sources, sans conversion HT/TTC ni marge future
                  estimée. Des dates différentes ne constituent pas une
                  comparaison équivalente.
                </Text>
                <SecondaryButton
                  label={
                    r.syncState === "CONFLICT"
                      ? "Comparer dans Synchronisation"
                      : "Revoir cette relation"
                  }
                  onPress={() =>
                    r.syncState === "CONFLICT"
                      ? router.push("/sync-center")
                      : router.push({
                          pathname: "/product-substitution",
                          params: { productId: e.sourceProductId, id: e.id },
                        } as Href)
                  }
                />
                <SecondaryButton
                  label={`Ouvrir ${showIncoming ? source : substitute}`}
                  onPress={() =>
                    router.push(
                      `/(tabs)/products/${showIncoming ? e.sourceProductId : e.substituteProductId}` as Href,
                    )
                  }
                />
              </View>
            );
          })
        ) : (
          <Text className="text-muted">
            {showIncoming
              ? "Aucun produit à remplacer dans cette sélection."
              : "Aucun remplaçant enregistré dans cette sélection."}
          </Text>
        )
      ) : (
        <Text className="text-muted">Lecture des relations locales…</Text>
      )}
      {error ? (
        <InlineAlert title="Substitutions indisponibles" message={error} />
      ) : null}
    </SectionCard>
  );
}
