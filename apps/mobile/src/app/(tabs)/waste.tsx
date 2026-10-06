import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useAuth } from "@/auth/auth-provider";
import {
  AppHeader,
  AppScreen,
  EmptyState,
  InlineAlert,
  PrimaryButton,
  SecondaryButton,
  SectionCard,
  StatusBadge,
} from "@/components/ui";
import {
  WasteReceiptRepository,
  type LocalWasteReceiptSummary,
} from "@/documents/waste-receipt-repository";
import { useLocalDatabase } from "@/providers/database-provider";

const receiptDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default function Screen() {
  const router = useRouter();
  const { session } = useAuth();
  const database = useLocalDatabase();
  const repository = useMemo(
    () => new WasteReceiptRepository(database.sqlite),
    [database.sqlite],
  );
  const storeId = session?.stores[0]?.storeId;
  const [receipts, setReceipts] = useState<LocalWasteReceiptSummary[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();

  const loadReceipts = useCallback(async () => {
    if (!storeId) {
      setReceipts([]);
      return;
    }
    setError(undefined);
    try {
      setReceipts(await repository.listReceipts(storeId));
    } catch {
      setError("Les tickets enregistrés n’ont pas pu être relus.");
    }
  }, [repository, storeId]);

  useFocusEffect(
    useCallback(() => {
      void loadReceipts();
    }, [loadReceipts]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadReceipts();
    } finally {
      setRefreshing(false);
    }
  }, [loadReceipts]);

  return (
    <AppScreen refreshing={refreshing} onRefresh={() => void refresh()}>
      <AppHeader
        title="Casse"
        subtitle="Suivre les pertes, garder une trace."
      />
      {error ? (
        <InlineAlert title="Lecture impossible" message={error} />
      ) : null}
      {receipts.length === 0 ? (
        <EmptyState
          title="Aucun ticket enregistré"
          message="Photographiez un ticket de casse. La photo et le brouillon restent sur cet appareil, même sans connexion."
          icon="camera-outline"
        >
          <PrimaryButton
            label="Prendre un ticket en photo"
            onPress={() => router.push("/waste-capture")}
          />
          <SecondaryButton
            label="Importer une photo"
            onPress={() => router.push("/waste-import")}
          />
        </EmptyState>
      ) : (
        <>
          <SectionCard
            title="Nouveau ticket"
            description="La saisie reste disponible hors connexion."
          >
            <PrimaryButton
              label="Prendre un ticket en photo"
              onPress={() => router.push("/waste-capture")}
            />
            <SecondaryButton
              label="Importer une photo"
              onPress={() => router.push("/waste-import")}
            />
          </SectionCard>
          <SectionCard
            title="Tickets enregistrés"
            description={`${receipts.length} brouillon${receipts.length > 1 ? "s" : ""} conservé${receipts.length > 1 ? "s" : ""} sur cet appareil.`}
          >
            {receipts.map(({ receipt, lineCount }) => {
              const presentation = receiptPresentation(
                receipt.processingStatus,
                receipt.duplicateStatus,
                lineCount,
                receipt.syncState,
              );
              return (
                <Pressable
                  key={receipt.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Ouvrir le ticket du ${formatReceiptDate(receipt.captureDate)}`}
                  onPress={() => router.push(`/waste-receipt/${receipt.id}`)}
                  className="gap-3 rounded-2xl border border-line bg-canvas p-4"
                >
                  <View className="flex-row items-start justify-between gap-3">
                    <View className="flex-1 gap-1">
                      <Text className="text-base font-semibold text-ink">
                        Ticket du {formatReceiptDate(receipt.captureDate)}
                      </Text>
                      <Text className="text-sm leading-5 text-muted">
                        {presentation.description}
                      </Text>
                    </View>
                    <StatusBadge status={presentation.status} />
                  </View>
                </Pressable>
              );
            })}
          </SectionCard>
        </>
      )}
    </AppScreen>
  );
}

function receiptPresentation(
  processingStatus: LocalWasteReceiptSummary["receipt"]["processingStatus"],
  duplicateStatus: LocalWasteReceiptSummary["receipt"]["duplicateStatus"],
  lineCount: number,
  syncState: LocalWasteReceiptSummary["receipt"]["syncState"],
): {
  status: "local" | "pending" | "error" | "incomplete" | "synced";
  description: string;
} {
  if (processingStatus === "PUBLISHED")
    return {
      status: syncState === "SYNCED" ? "synced" : "pending",
      description: "Casse validée et publiée",
    };
  if (duplicateStatus === "POSSIBLE_DUPLICATE") {
    return { status: "incomplete", description: "Doublon possible à examiner" };
  }
  if (duplicateStatus === "CONFIRMED_DUPLICATE") {
    return {
      status: "local",
      description: "Doublon confirmé · source conservée",
    };
  }
  if (processingStatus === "FAILED") {
    return { status: "error", description: "Envoi à reprendre" };
  }
  if (processingStatus === "UPLOAD_PENDING") {
    return {
      status: "pending",
      description: "Envoi en attente · analyse en attente",
    };
  }
  if (processingStatus === "UPLOADED") {
    return {
      status: "pending",
      description: "Image envoyée · analyse en attente",
    };
  }
  return {
    status: "local",
    description:
      lineCount === 0
        ? "Analyse en attente"
        : `${lineCount} ligne${lineCount > 1 ? "s" : ""}`,
  };
}

function formatReceiptDate(value: string | null | undefined) {
  if (!value) return "date inconnue";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "date inconnue"
    : receiptDateFormatter.format(date);
}
