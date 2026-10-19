import { useMemo, useRef, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  AppHeader,
  EmptyState,
  InlineAlert,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
} from "../components/ui";
import { colors } from "../design/tokens";
import type { LocalWasteReceiptSummary } from "./waste-receipt-repository";
import {
  filterReceipts,
  receiptListPresentation,
  type ReceiptListFilter,
} from "./receipt-list-presentation";
export function ReceiptList({
  receipts,
  loading,
  refreshing,
  error,
  offline,
  onRefresh,
  onCapture,
  onImport,
  onOpen,
  onSync,
}: {
  receipts: LocalWasteReceiptSummary[];
  loading: boolean;
  refreshing: boolean;
  error?: string;
  offline: boolean;
  onRefresh(): void;
  onCapture(): void;
  onImport(): void;
  onOpen(id: string): void;
  onSync(): void;
}) {
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState<ReceiptListFilter>("ALL");
  const list = useRef<FlatList<LocalWasteReceiptSummary>>(null);
  const rows = useMemo(
    () => filterReceipts(receipts, query, filter, offline),
    [receipts, query, filter, offline],
  );
  return (
    <SafeAreaView edges={["top", "left", "right"]} className="flex-1 bg-canvas">
      <FlatList
        ref={list}
        data={rows}
        keyExtractor={(r) => r.receipt.id}
        initialNumToRender={15}
        windowSize={7}
        contentContainerStyle={{ padding: 24, gap: 12, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshing={refreshing}
        onRefresh={onRefresh}
        ListHeaderComponent={
          <View className="gap-4 pb-2">
            <AppHeader
              title="Casse"
              subtitle="Vos tickets, de la capture à la publication."
            />
            <View className="flex-row flex-wrap gap-2">
              <View style={{ flexGrow: 1, flexBasis: 140 }}>
                <PrimaryButton
                  label="Photographier"
                  accessibilityLabel="Photographier un ticket"
                  onPress={onCapture}
                />
              </View>
              <View style={{ flexGrow: 1, flexBasis: 140 }}>
                <SecondaryButton
                  label="Importer"
                  accessibilityLabel="Importer une photo de ticket"
                  onPress={onImport}
                />
              </View>
            </View>
            <TextInput
              accessibilityLabel="Rechercher un ticket par date, caissier ou note"
              placeholder="Date, caissier ou note"
              placeholderTextColor={colors.muted}
              value={query}
              maxLength={200}
              onChangeText={(value) => {
                setQuery(value);
                list.current?.scrollToOffset({ offset: 0, animated: false });
              }}
              className="min-h-12 rounded-2xl border border-line bg-surface px-4 py-3 text-base text-ink"
            />
            <View className="flex-row flex-wrap gap-2">
              {(
                [
                  ["ALL", "Tous"],
                  ["REVIEW", "À revoir"],
                  ["PENDING", "En attente"],
                  ["PUBLISHED", "Publiés"],
                ] as const
              ).map(([key, label]) => (
                <Pressable
                  key={key}
                  accessibilityRole="radio"
                  aria-checked={filter === key}
                  accessibilityState={{ checked: filter === key }}
                  accessibilityLabel={`Tickets : ${label}`}
                  onPress={() => {
                    setFilter(key);
                    list.current?.scrollToOffset({
                      offset: 0,
                      animated: false,
                    });
                  }}
                  className={`min-h-12 justify-center rounded-2xl border px-3 py-3 ${filter === key ? "border-forest bg-forest" : "border-line bg-surface"}`}
                >
                  <Text
                    className={
                      filter === key
                        ? "font-semibold text-on-accent"
                        : "text-ink"
                    }
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text
              accessibilityLiveRegion="polite"
              className="text-sm text-muted"
            >
              {loading
                ? "Lecture des tickets…"
                : error && !receipts.length
                  ? "Tickets indisponibles"
                  : `${rows.length} ticket${rows.length === 1 ? "" : "s"} sur ${receipts.length}`}
            </Text>
            {error ? (
              <>
                <InlineAlert title="Lecture interrompue" message={error} />
                <SecondaryButton
                  label="Réessayer la lecture"
                  onPress={onRefresh}
                />
              </>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          !loading && !error ? (
            <EmptyState
              title={
                receipts.length
                  ? "Aucun ticket dans cette sélection"
                  : "Aucun ticket enregistré"
              }
              message={
                receipts.length
                  ? "Changez la recherche ou le filtre pour retrouver vos autres tickets."
                  : "La photo et le brouillon restent sur cet appareil, même sans connexion."
              }
              icon="camera-outline"
            />
          ) : null
        }
        renderItem={({ item }) => {
          const p = receiptListPresentation(item, offline);
          return (
            <View className="gap-3 rounded-2xl border border-line bg-surface p-4">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Ouvrir le ticket : ${p.heading}`}
                onPress={() => onOpen(item.receipt.id)}
                className="min-h-12 flex-row items-start gap-2"
              >
                <View className="flex-1 gap-2">
                  <Text className="text-base font-semibold text-ink">
                    {p.heading}
                  </Text>
                  <Text className="text-sm text-muted">{p.capture}</Text>
                  <Text className="text-sm text-muted">
                    {[
                      p.cashierLabel,
                      item.lineCount || item.receipt.aiStatus === "COMPLETED"
                        ? `${item.lineCount} ligne${item.lineCount === 1 ? "" : "s"}`
                        : "Lignes en attente d’analyse",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={21}
                  color={colors.muted}
                  accessible={false}
                />
              </Pressable>
              <Text className="text-sm text-muted">{p.processing.title}</Text>
              {["error", "incomplete", "conflict"].includes(
                p.processing.status,
              ) ? (
                <Text className="text-sm text-muted">
                  {p.processing.message}
                </Text>
              ) : null}
              <StatusBadge status={p.processing.status} />
              {["ERROR", "CONFLICT"].includes(item.receipt.syncState) ? (
                <SecondaryButton
                  label="Voir la synchronisation"
                  onPress={onSync}
                />
              ) : null}
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}
