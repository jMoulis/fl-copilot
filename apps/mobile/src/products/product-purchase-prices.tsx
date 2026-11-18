import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { randomUUID } from "expo-crypto";
import { useLocalDatabase } from "../providers/database-provider";
import { useAuth } from "../auth/auth-provider";
import { useSync } from "../sync/sync-provider";
import { InlineAlert, SectionCard, SecondaryButton } from "../components/ui";
import { SourceOriginalButton } from "../documents/source-original-button";
import { tradingToday, formatFrenchCalendarDate } from "../dates/calendar";
import {
  PurchasePriceRepository,
  type PurchasePriceRow,
} from "./purchase-price-repository";

export function ProductPurchasePrices({
  storeId,
  productId,
}: {
  storeId: string;
  productId: string;
}) {
  const { sqlite } = useLocalDatabase();
  const { session } = useAuth();
  const sync = useSync();
  const repo = useMemo(() => new PurchasePriceRepository(sqlite), [sqlite]);
  const [rows, setRows] = useState<PurchasePriceRow[]>([]),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false),
    [expanded, setExpanded] = useState(false);
  const scope = useRef({ storeId, productId, session });
  scope.current = { storeId, productId, session };
  const refresh = useCallback(async () => {
    const result = await repo.history(storeId, productId, tradingToday());
    if (
      scope.current.storeId === storeId &&
      scope.current.productId === productId
    ) {
      setRows(result);
      setError(false);
    }
  }, [repo, storeId, productId]);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      repo
        .history(storeId, productId, tradingToday())
        .then((result) => {
          if (active) {
            setRows(result);
            setError(false);
          }
        })
        .catch(() => {
          if (active) setError(true);
        });
      return () => {
        active = false;
      };
    }, [repo, storeId, productId]),
  );
  useEffect(() => {
    if (sync.status === "synced") void refresh().catch(() => setError(true));
  }, [sync.status, refresh]);
  const manager = session?.stores.some(
    (s) => s.storeId === storeId && s.role === "MANAGER",
  );
  async function confirm(row: PurchasePriceRow) {
    const owner = session?.user.id;
    const assertCurrentScope = () => {
      if (
        scope.current.storeId !== storeId ||
        scope.current.productId !== productId ||
        scope.current.session?.user.id !== owner ||
        !scope.current.session?.stores.some(
          (s) => s.storeId === storeId && s.role === "MANAGER",
        )
      )
        throw Error("PURCHASE_PRICE_SCOPE_CHANGED");
    };
    setBusy(true);
    try {
      await repo.confirm(storeId, productId, row.id, row.version, {
        now: new Date().toISOString(),
        generateId: randomUUID,
        assertCurrentScope,
      });
      await refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  const visible = expanded ? rows : rows.slice(0, 1);
  return (
    <SectionCard title="Prix d’achat HT">
      {error ? (
        <InlineAlert
          title="Prix indisponibles"
          message="Réessaie après actualisation. Les données conservées ne sont pas supprimées."
        />
      ) : null}
      {!rows.length ? (
        <Text className="text-sm text-muted">
          Aucun PA importé pour ce produit jusqu’à aujourd’hui.
        </Text>
      ) : null}
      {visible.map((row, i) => (
        <View key={row.id} className="gap-2 border-b border-line py-3">
          <Text className="text-lg font-semibold text-ink">
            {new Intl.NumberFormat("fr-FR", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 3,
            }).format(Number(row.amount))}{" "}
            € HT /{" "}
            {
              (
                {
                  KG: "kg",
                  PIECE: "pièce",
                  PACK: "conditionnement",
                  UNKNOWN: "unité à préciser",
                } as Record<string, string>
              )[row.unit]
            }
          </Text>
          <Text className="text-sm text-muted">
            {i === 0 ? "Dernier PA connu du" : "PA du"}{" "}
            {formatFrenchCalendarDate(row.business_date)} ·{" "}
            {row.sync_state === "SYNCED" ? "Synchronisé" : "À synchroniser"}
          </Text>
          {row.price_status === "TO_VERIFY" ? (
            <Text className="text-sm text-warning">
              Prix à vérifier · exclu des calculs
              {row.unit === "UNKNOWN" ? " · unité du produit à préciser" : ""}
            </Text>
          ) : null}
          <SourceOriginalButton
            sourceDocumentId={row.source_document_id}
            label="Voir le fichier source"
          />
          {row.price_status === "TO_VERIFY" &&
          row.unit !== "UNKNOWN" &&
          manager ? (
            <SecondaryButton
              disabled={busy}
              label="Confirmer ce PA"
              onPress={() =>
                Alert.alert(
                  "Confirmer le prix d’achat",
                  `Confirmer ${row.amount.replace(".", ",")} € HT pour le ${formatFrenchCalendarDate(row.business_date)} ? Ce prix pourra ensuite être utilisé dans les calculs.`,
                  [
                    { text: "Annuler", style: "cancel" },
                    {
                      text: "Confirmer",
                      onPress: () => {
                        void confirm(row);
                      },
                    },
                  ],
                )
              }
            />
          ) : null}
        </View>
      ))}
      {rows.length > 1 ? (
        <SecondaryButton
          label={expanded ? "Réduire l’historique" : "Voir les derniers prix"}
          onPress={() => setExpanded(!expanded)}
        />
      ) : null}
      {expanded && rows.length === 20 ? (
        <Text className="text-xs text-muted">
          Les 20 derniers prix sont affichés. Les imports plus anciens restent
          conservés dans Imports.
        </Text>
      ) : null}
    </SectionCard>
  );
}
