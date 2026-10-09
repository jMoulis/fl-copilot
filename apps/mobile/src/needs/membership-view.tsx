import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { digestStringAsync, CryptoDigestAlgorithm } from "expo-crypto";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import { NeedMembershipRepository } from "./membership-repository";
import { NeedUnitRepository } from "./repository";
import { ProductMasterRepository } from "@/products/product-master-repository";
import { SectionCard, SecondaryButton, InlineAlert } from "@/components/ui";
import { membershipSummary } from "./membership-presentation";
export function MembershipView({
  productId,
  needUnitId,
}: {
  productId?: string;
  needUnitId?: string;
}) {
  const { session } = useAuth(),
    storeId = session?.stores[0]?.storeId,
    { sqlite } = useLocalDatabase(),
    { status: syncStatus } = useSync(),
    repo = useMemo(
      () =>
        new NeedMembershipRepository(sqlite, (s) =>
          digestStringAsync(CryptoDigestAlgorithm.SHA256, s),
        ),
      [sqlite],
    );
  const [items, setItems] = useState<
      Array<{
        id: string;
        storeId: string;
        label: string;
        summary: string;
        syncState: string;
        status: string;
      }>
    >([]),
    [error, setError] = useState<string>();
  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (storeId)
        void (async () => {
          const [members, needs, products] = await Promise.all([
            repo.list(storeId),
            new NeedUnitRepository(sqlite).list(storeId),
            new ProductMasterRepository(sqlite).listProducts(storeId),
          ]);
          if (active)
            setItems(
              members
                .filter(
                  (r) =>
                    (!productId || r.entity.productId === productId) &&
                    (!needUnitId || r.entity.needUnitId === needUnitId),
                )
                .map((r) => ({
                  id: r.entity.id,
                  storeId: r.entity.storeId,
                  label: productId
                    ? (needs.find((n) => n.entity.id === r.entity.needUnitId)
                        ?.entity.name ?? "Besoin indisponible")
                    : (products.find((p) => p.entity.id === r.entity.productId)
                        ?.entity.label ?? "Produit indisponible"),
                  summary: membershipSummary(r.entity),
                  syncState: r.syncState,
                  status: r.entity.status,
                })),
            );
        })().catch(() => {
          if (active && syncStatus !== "syncing")
            setError("Les associations locales ne peuvent pas être lues.");
        });
      return () => {
        active = false;
      };
    }, [repo, sqlite, storeId, productId, needUnitId, syncStatus]),
  );
  const visible = items.filter((i) => i.storeId === storeId);
  return (
    <SectionCard
      title={productId ? "Usages clients associés" : "Produits associés"}
    >
      <Text className="text-muted">
        Un même produit peut répondre à plusieurs besoins clients.
        L’appartenance à un besoin ne suffit pas à établir une substitution.
      </Text>
      <SecondaryButton
        label="Préparer ou revoir des associations"
        disabled={!storeId}
        onPress={() =>
          router.push({
            pathname: "/need-memberships",
            params: {
              ...(productId ? { productId } : {}),
              ...(needUnitId ? { needUnitId } : {}),
            },
          })
        }
      />
      {visible.length ? (
        visible.map((i) => (
          <View key={i.id} className="gap-1">
            <Text className="font-semibold text-ink">{i.label}</Text>
            <Text className="text-muted">{i.summary}</Text>
            <Text className="text-muted">
              {i.syncState === "SYNCED"
                ? "Synchronisée"
                : i.syncState === "CONFLICT"
                  ? "Conflit à comparer"
                  : i.syncState === "ERROR"
                    ? "Envoi à reprendre"
                    : "À synchroniser"}
            </Text>
          </View>
        ))
      ) : (
        <Text className="text-muted">
          Aucune association enregistrée pour cette sélection.
        </Text>
      )}
      {error ? (
        <InlineAlert title="Associations indisponibles" message={error} />
      ) : null}
    </SectionCard>
  );
}
