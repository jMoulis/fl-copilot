import { SafeAreaView } from "react-native-safe-area-context";
import { IconButton } from "../components/dashboard";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { router, useFocusEffect, useIsFocused } from "expo-router";
import { randomUUID } from "expo-crypto";
import { useAuth } from "../auth/auth-provider";
import { useLocalDatabase } from "../providers/database-provider";
import { useSync } from "../sync/sync-provider";
import { tradingToday } from "../dates/calendar";
import {
  AppHeader,
  BottomSheet,
  InlineAlert,
  PrimaryButton,
  SecondaryButton,
} from "../components/ui";
import {
  readCatalogueCleanup,
  setCatalogueArchived,
  type CleanupSnapshot,
} from "./catalogue-cleanup";

export function CatalogueCleanupScreen() {
  const { session } = useAuth();
  return (
    <ScopedCleanup key={`${session?.user.id}:${session?.stores[0]?.storeId}`} />
  );
}
function ScopedCleanup() {
  const { session } = useAuth(),
    { sqlite, deviceId } = useLocalDatabase(),
    sync = useSync();
  const storeId = session?.stores[0]?.storeId,
    ownerId = session?.user.id;
  const focused = useIsFocused();
  const canWrite = focused && session?.stores[0]?.role === "MANAGER";
  const current = useRef({ storeId, ownerId, canWrite, alive: true });
  current.current = { storeId, ownerId, canWrite, alive: true };
  useEffect(
    () => () => {
      current.current.alive = false;
    },
    [],
  );
  const [snapshot, setSnapshot] = useState<CleanupSnapshot>();
  const [days, setDays] = useState(90),
    [archived, setArchived] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    [error, setError] = useState<string>();
  const lock = useRef(false),
    generation = useRef(0);
  const today = tradingToday();
  const cutoff = new Date(Date.parse(`${today}T12:00:00Z`) - days * 86400000)
    .toISOString()
    .slice(0, 10);
  const refresh = useCallback(async () => {
    const ticket = ++generation.current;
    if (!storeId) return;
    try {
      const next = await readCatalogueCleanup(sqlite, storeId, today);
      if (current.current.alive && ticket === generation.current) {
        setSnapshot(next);
        setSelected(new Set());
        setError(undefined);
      }
    } catch {
      if (current.current.alive)
        setError("L’activité des articles n’a pas pu être chargée.");
    }
  }, [sqlite, storeId, today]);
  useFocusEffect(
    useCallback(() => {
      void refresh();
      return () => {
        generation.current++;
      };
    }, [refresh]),
  );
  const rows = (snapshot?.items ?? []).filter((i) =>
    archived
      ? i.record.entity.status === "INACTIVE"
      : i.record.entity.status === "ACTIVE" &&
        (!i.lastSale || i.lastSale < cutoff),
  );
  const chosen = rows.filter((i) => selected.has(i.record.entity.id));
  async function apply() {
    if (lock.current || !storeId || !ownerId || !chosen.length) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await setCatalogueArchived(sqlite, chosen, !archived, {
        storeId,
        through: today,
        deviceId,
        now: () => new Date().toISOString(),
        id: randomUUID,
        assertCurrent: () => {
          if (
            !current.current.alive ||
            current.current.storeId !== storeId ||
            current.current.ownerId !== ownerId ||
            !current.current.canWrite
          )
            throw Error("CATALOGUE_SCOPE_CHANGED");
        },
      });
      if (current.current.alive) {
        setConfirm(false);
        await refresh();
        void sync.syncNow(storeId).catch(() => undefined);
      }
    } catch {
      if (current.current.alive)
        setError(
          "La sélection a changé ou ne peut pas être modifiée. Actualise la liste avant de réessayer.",
        );
    } finally {
      lock.current = false;
      if (current.current.alive) setBusy(false);
    }
  }
  return (
    <SafeAreaView edges={["top", "left", "right"]} className="flex-1 bg-canvas">
      <View className="flex-row items-center px-4">
        <IconButton
          label="Retour aux produits"
          icon="chevron-back"
          disabled={busy}
          onPress={() => router.back()}
        />
        <AppHeader title="Nettoyer le catalogue" />
      </View>
      <FlatList
        data={rows}
        keyExtractor={(i) => i.record.entity.id}
        initialNumToRender={20}
        maxToRenderPerBatch={20}
        windowSize={7}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        ListEmptyComponent={
          <Text className="py-4 text-muted" accessibilityLiveRegion="polite">
            {snapshot
              ? "Aucun article pour ce filtre."
              : error
                ? "Actualise la liste pour réessayer."
                : "Chargement de l’activité des articles…"}
          </Text>
        }
        ListHeaderComponent={
          <View className="gap-4 pb-4">
            <Text className="text-base text-muted">
              Choisis les articles à archiver. Les prix, les codes et
              l’historique restent conservés ; tu pourras réactiver les
              articles.
            </Text>
            <View className="flex-row gap-2">
              {[false, true].map((value) => (
                <SecondaryButton
                  key={String(value)}
                  label={value ? "Archivés" : "Sans vente récente"}
                  disabled={busy}
                  onPress={() => {
                    setArchived(value);
                    setSelected(new Set());
                  }}
                />
              ))}
            </View>
            {!archived ? (
              <View className="flex-row flex-wrap gap-2">
                {[30, 90, 180, 365].map((value) => (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityState={{
                      checked: days === value,
                      disabled: busy,
                    }}
                    disabled={busy}
                    onPress={() => {
                      setDays(value);
                      setSelected(new Set());
                    }}
                    className={`min-h-11 rounded-full border border-line px-3 py-2 ${days === value ? "bg-accent" : "bg-surface"}`}
                  >
                    <Text>{value} jours</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <Text className="text-sm text-muted">
              {snapshot?.coverage?.days
                ? `Ventes renseignées : ${snapshot.coverage.first_date} → ${snapshot.coverage.last_date}, sur ${snapshot.coverage.days} jours distincts.`
                : "Aucun historique de ventes disponible."}{" "}
              L’absence de vente connue ne prouve pas l’inactivité, notamment
              pour les articles nouveaux ou saisonniers.
            </Text>
            <Text className="text-sm text-muted">
              {snapshot?.latestPriceDate
                ? `Dernier fichier avec PA publiés : ${snapshot.latestPriceDate}. Sa publication peut être partielle.`
                : "Aucun prix d’achat publié disponible."}
            </Text>
            {error ? (
              <InlineAlert title="Action interrompue" message={error} />
            ) : null}
            <SecondaryButton
              label="Actualiser la liste"
              disabled={busy}
              onPress={() => void refresh()}
            />
            <Text accessibilityLiveRegion="polite">
              {rows.length} articles · {chosen.length} sélectionnés
            </Text>
            <PrimaryButton
              label={
                archived
                  ? `Réactiver la sélection (${chosen.length})`
                  : `Archiver la sélection (${chosen.length})`
              }
              disabled={!canWrite || busy || !chosen.length}
              onPress={() => setConfirm(true)}
            />
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel={`Sélectionner ${item.record.entity.label}`}
            accessibilityState={{
              checked: selected.has(item.record.entity.id),
              disabled: busy,
            }}
            disabled={busy}
            onPress={() =>
              setSelected((old) => {
                const next = new Set(old);
                if (next.has(item.record.entity.id))
                  next.delete(item.record.entity.id);
                else next.add(item.record.entity.id);
                return next;
              })
            }
            className="gap-1 border-b border-line py-3"
          >
            <Text className="text-base font-semibold text-ink">
              {selected.has(item.record.entity.id) ? "✓ " : ""}
              {item.record.entity.label}
            </Text>
            <Text className="text-sm text-muted">
              Dernière vente connue :{" "}
              {item.lastSale ?? "aucune dans l’historique disponible"}
            </Text>
            <Text className="text-sm text-muted">
              Dernier PA publié : {item.lastPrice ?? "aucun"}
              {item.inLatestPrice
                ? " · Présent dans le dernier fichier publié"
                : ""}
            </Text>
          </Pressable>
        )}
      />
      <BottomSheet
        visible={confirm}
        dismissible={!busy}
        onClose={() => {
          if (!busy) setConfirm(false);
        }}
        title={archived ? "Réactiver les articles" : "Archiver les articles"}
      >
        <Text>
          {chosen.length} articles sélectionnés. L’historique sera conservé.
        </Text>
        <PrimaryButton
          label={
            archived ? "Confirmer la réactivation" : "Confirmer l’archivage"
          }
          loading={busy}
          onPress={() => void apply()}
        />
        <SecondaryButton
          label="Annuler"
          disabled={busy}
          onPress={() => setConfirm(false)}
        />
      </BottomSheet>
    </SafeAreaView>
  );
}
