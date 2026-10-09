import { useCallback, useMemo, useState } from "react";
import { Text, TextInput, View, Switch } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/auth/auth-provider";
import { useSync } from "@/sync/sync-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { NeedUnitRepository } from "@/needs/repository";
import {
  AppScreen,
  AppHeader,
  PrimaryButton,
  SecondaryButton,
  SectionCard,
  InlineAlert,
} from "@/components/ui";
export default function NeedUnits() {
  const { session } = useAuth(),
    storeId = session?.stores[0]?.storeId,
    { sqlite } = useLocalDatabase(),
    { status: syncStatus } = useSync(),
    repo = useMemo(() => new NeedUnitRepository(sqlite), [sqlite]);
  const [rows, setRows] = useState<
      Awaited<ReturnType<NeedUnitRepository["list"]>>
    >([]),
    [search, setSearch] = useState(""),
    [inactive, setInactive] = useState(false),
    [error, setError] = useState<string>();
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      if (storeId)
        void repo
          .list(storeId)
          .then((v) => {
            if (alive) setRows(v);
          })
          .catch(() => {
            if (alive && syncStatus !== "syncing")
              setError("Le catalogue local ne peut pas être lu.");
          });
      return () => {
        alive = false;
      };
    }, [repo, storeId, syncStatus]),
  );
  const visible = rows.filter(
    (r) =>
      r.entity.storeId === storeId &&
      (inactive || r.entity.status !== "INACTIVE") &&
      `${r.entity.name} ${r.entity.code} ${r.entity.description ?? ""}`
        .toLocaleLowerCase("fr-FR")
        .includes(search.toLocaleLowerCase("fr-FR")),
  );
  return (
    <AppScreen>
      <AppHeader
        title="Besoins clients"
        subtitle="Les usages qui guideront les associations de produits et les substitutions."
      />
      <SecondaryButton label="Retour à Plus" onPress={() => router.back()} />
      <PrimaryButton
        label="Créer un besoin client"
        disabled={!storeId}
        onPress={() =>
          router.push({ pathname: "/need-unit/[id]", params: { id: "new" } })
        }
      />
      <Text className="text-muted">
        Exemples : préparer une salade, un apéritif ou un fruit à emporter. Le
        catalogue est configurable pour votre magasin.
      </Text>
      <TextInput
        accessibilityLabel="Rechercher un besoin client"
        placeholder="Rechercher un nom ou un code"
        value={search}
        onChangeText={setSearch}
        className="rounded-xl border border-line p-3 text-ink"
      />
      <View className="flex-row items-center justify-between">
        <Text className="text-ink">Afficher les besoins désactivés</Text>
        <Switch
          accessibilityLabel="Afficher les besoins désactivés"
          value={inactive}
          onValueChange={setInactive}
        />
      </View>
      {error ? (
        <InlineAlert title="Catalogue indisponible" message={error} />
      ) : null}
      {visible.length ? (
        visible.map((r) => (
          <SectionCard key={r.entity.id} title={r.entity.name}>
            <Text className="text-muted">
              {r.entity.code} ·{" "}
              {
                {
                  ACTIVE: "Active",
                  TO_REVIEW: "À revoir",
                  INACTIVE: "Désactivée",
                }[r.entity.status]
              }
            </Text>
            {r.entity.description ? (
              <Text className="text-ink">{r.entity.description}</Text>
            ) : null}
            <Text className="text-muted">
              {r.syncState === "SYNCED"
                ? "Synchronisée"
                : r.syncState === "CONFLICT"
                  ? "Conflit à comparer"
                  : r.syncState === "ERROR"
                    ? "Envoi refusé : correction nécessaire"
                    : "À synchroniser"}
            </Text>
            <SecondaryButton
              label="Ouvrir ce besoin"
              onPress={() =>
                router.push({
                  pathname: "/need-unit/[id]",
                  params: { id: r.entity.id },
                })
              }
            />
          </SectionCard>
        ))
      ) : (
        <Text className="text-muted">
          {rows.length
            ? "Aucun besoin ne correspond à ces filtres."
            : "Créez votre premier besoin client. Les associations aux produits arrivent dans l’étape suivante."}
        </Text>
      )}
    </AppScreen>
  );
}
