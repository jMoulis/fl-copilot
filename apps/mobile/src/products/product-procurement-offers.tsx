import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router, useIsFocused, type Href } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { useAuth } from "../auth/auth-provider";
import { useLocalDatabase } from "../providers/database-provider";
import { useSync } from "../sync/sync-provider";
import { subscribeOutboxChanges } from "../sync/outbox-repository";
import {
  BottomSheet,
  InlineAlert,
  PrimaryButton,
  SecondaryButton,
  SectionCard,
} from "../components/ui";
import { colors } from "../design/tokens";
import {
  productProcurementOffers,
  productProcurementEnrichment,
  confirmProcurementEnrichment,
} from "../documents/procurement-catalogue-service";
import { formatFrenchCalendarDate } from "../dates/calendar";
import { SourceOriginalButton } from "../documents/source-original-button";
import { natureLabels } from "./catalogue-view";
export function ProcurementCheck({
  label,
  value,
  onChange,
  detail,
  disabled = false,
}: {
  label: string;
  value: boolean;
  onChange(): void;
  detail?: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={onChange}
      className="min-h-14 flex-row items-start gap-3 border-b border-line py-4"
    >
      <Text style={{ color: colors.forest, fontSize: 21 }}>
        {value ? "☑" : "☐"}
      </Text>
      <View className="min-w-0 flex-1 gap-1">
        <Text className="text-base text-ink">{label}</Text>
        {detail ? (
          <Text className="text-sm leading-5 text-muted">{detail}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}
const money = (v: string | null | undefined) =>
  v == null
    ? "Tarif non renseigné"
    : `${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v))} €`;
export function ProductProcurementOffers({
  storeId,
  productId,
  onChanged,
}: {
  storeId: string;
  productId: string;
  onChanged?(): Promise<void>;
}) {
  const { sqlite, deviceId } = useLocalDatabase(),
    { session } = useAuth(),
    sync = useSync(),
    focused = useIsFocused();
  const ownerId = session?.user.id,
    manager =
      session?.stores.some(
        (s) => s.storeId === storeId && s.role === "MANAGER",
      ) === true;
  const scope = useRef({ storeId, productId, ownerId, manager, active: true });
  scope.current = { storeId, productId, ownerId, manager, active: true };
  useEffect(() => {
    scope.current.active = true;
    return () => {
      scope.current.active = false;
    };
  }, []);
  const query = useQuery({
    queryKey: ["product-procurement", deviceId, storeId, ownerId, productId],
    enabled: focused && !!ownerId,
    queryFn: async () => {
      const [offers, enrichment] = await Promise.all([
        productProcurementOffers(sqlite, storeId, productId),
        productProcurementEnrichment(sqlite, storeId, productId),
      ]);
      return { offers, enrichment };
    },
    staleTime: Infinity,
  });
  const refetch = query.refetch;
  useEffect(() => {
    if (!focused) return;
    void refetch();
    return subscribeOutboxChanges(() => {
      void refetch();
    });
  }, [focused, sync.lastSyncedAt, refetch]);
  const [expanded, setExpanded] = useState(false),
    [panel, setPanel] = useState<number | "enrich" | null>(null),
    [error, setError] = useState<string>(),
    [busy, setBusy] = useState(false);
  const operation = useRef(false),
    editAfterDismiss = useRef(false);
  const [choices, setChoices] = useState({
    nature: false,
    packaging: false,
    petitPrix: false,
  });
  const [category, setCategory] = useState<
    "FRUIT" | "VEGETABLE" | "OTHER" | undefined
  >();
  const data = query.data,
    proposal = data?.enrichment?.proposal;
  const canEnrich =
    proposal &&
    [proposal.nature, proposal.packaging, proposal.isPetitPrix].some(
      (f) => f.state === "PROPOSED" || f.state === "REVIEW",
    );
  const selected = typeof panel === "number" ? data?.offers[panel] : undefined;
  const canSave =
    choices.nature || choices.packaging || choices.petitPrix || !!category;
  const context = useCallback(
    () => ({
      storeId,
      actorId: ownerId!,
      deviceId,
      id: randomUUID,
      now: () => new Date().toISOString(),
      assertCurrentScope: () => {
        const s = scope.current;
        if (
          !s.active ||
          s.storeId !== storeId ||
          s.productId !== productId ||
          s.ownerId !== ownerId ||
          !s.manager
        )
          throw Error("PROCUREMENT_SCOPE_CHANGED");
      },
    }),
    [storeId, productId, ownerId, deviceId],
  );
  const save = async () => {
    if (operation.current || !data?.enrichment || !canSave) return;
    operation.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await confirmProcurementEnrichment(
        sqlite,
        data.enrichment,
        { ...choices, category },
        context(),
      );
      context().assertCurrentScope();
      setPanel(null);
      await Promise.all([refetch(), onChanged?.()]);
    } catch {
      if (scope.current.active)
        setError(
          "La fiche ou ses sources ont changé. Actualise les propositions avant de confirmer.",
        );
    } finally {
      operation.current = false;
      if (scope.current.active) setBusy(false);
    }
  };
  const openEnrichment = () => {
    setChoices({
      nature: proposal?.nature.state === "PROPOSED",
      packaging: proposal?.packaging.state === "PROPOSED",
      petitPrix: proposal?.isPetitPrix.state === "PROPOSED",
    });
    setCategory(undefined);
    setError(undefined);
    setPanel("enrich");
  };
  const visible = useMemo(
    () => data?.offers.slice(0, expanded ? undefined : 2) ?? [],
    [data?.offers, expanded],
  );
  if (!data?.offers.length && !canEnrich && !query.error) return null;
  return (
    <>
      <SectionCard title="Offres fournisseur">
        {query.error ? (
          <InlineAlert
            title="Offres à actualiser"
            message="La lecture locale n’a pas abouti. Tes données sont conservées."
          />
        ) : null}
        {visible.map((row, i) => (
          <Pressable
            key={`${row.snapshotId}:${row.offer.offerId}`}
            onPress={() => setPanel(i)}
            accessibilityRole="button"
            accessibilityLabel={`Détails de ${row.offer.label}`}
            className="gap-2 border-b border-line py-4"
          >
            <View className="flex-row items-start justify-between gap-3">
              <Text className="min-w-0 flex-1 text-base font-semibold text-ink">
                {row.offer.label}
              </Text>
              <Text className="text-lg font-semibold text-forest">
                {money(row.offer.tariff?.purchasePrice)}
              </Text>
            </View>
            <Text className="text-sm text-muted">
              Tarif de commande ·{" "}
              {formatFrenchCalendarDate(row.asOf.slice(0, 10))}
            </Text>
            <Text className="text-xs text-muted">
              Réf. {row.offer.offerId}
              {row.syncState !== "SYNCED" ? " · À synchroniser" : ""}
            </Text>
          </Pressable>
        ))}
        {data && data.offers.length > 2 ? (
          <SecondaryButton
            label={
              expanded
                ? "Réduire les offres"
                : `Voir les ${data.offers.length} offres`
            }
            onPress={() => setExpanded((v) => !v)}
          />
        ) : null}
        {canEnrich && manager ? (
          <SecondaryButton
            label="Compléter cette fiche"
            onPress={openEnrichment}
          />
        ) : null}
      </SectionCard>
      <BottomSheet
        visible={panel !== null}
        title={
          panel === "enrich"
            ? "Compléter la fiche"
            : "Conditionnement fournisseur"
        }
        onClose={() => {
          if (!operation.current) setPanel(null);
        }}
        onDismiss={() => {
          if (editAfterDismiss.current) {
            editAfterDismiss.current = false;
            if (scope.current.active)
              router.push(`/product/edit/${productId}` as Href);
          }
        }}
        swipeToClose
        dismissible={!busy}
        footer={
          panel === "enrich" ? (
            <PrimaryButton
              label="Confirmer ces attributs"
              onPress={() => void save()}
              disabled={!canSave || !manager}
              loading={busy}
            />
          ) : undefined
        }
      >
        {error ? (
          <InlineAlert title="Modification non enregistrée" message={error} />
        ) : null}
        {selected ? (
          <View className="gap-4">
            <Text className="text-xl font-semibold text-ink">
              {selected.offer.label}
            </Text>
            <Text className="text-2xl font-semibold text-forest">
              {money(selected.offer.tariff?.purchasePrice)}
            </Text>
            <Text className="text-sm leading-6 text-muted">
              Tarif du {formatFrenchCalendarDate(selected.asOf.slice(0, 10))} ·
              base {selected.offer.tariff?.base ?? "non renseignée"}
            </Text>
            <Text className="text-base text-ink">
              Origine déclarée : {selected.offer.origin ?? "non renseignée"}
            </Text>
            <Text className="text-base text-ink">
              Conditionnement : {selected.offer.packagingLabel}
            </Text>
            <Text className="text-base text-ink">
              Quantité de conditionnement source :{" "}
              {selected.offer.packagingQuantity}
            </Text>
            <Text className="text-base text-ink">
              Poids source : {selected.offer.weight}
            </Text>
            <Text className="text-sm leading-6 text-muted">
              {selected.offer.tariff?.priceUnit === true
                ? "Tarif déclaré par unité source."
                : selected.offer.tariff?.priceUnit === false
                  ? "Tarif déclaré sur le poids source."
                  : "Base du tarif non renseignée."}{" "}
              L’unité de ce champ n’est pas précisée dans le JSON. Le colis ne
              définit pas l’unité des ventes.
            </Text>
            <Text className="text-sm text-muted">
              Référence {selected.offer.offerId} · générique{" "}
              {selected.offer.genericId}
            </Text>
          </View>
        ) : null}
        {panel === "enrich" && proposal ? (
          <View className="gap-3">
            <Text className="text-sm text-muted">
              Propositions du référentiel. Les valeurs déjà renseignées sont
              conservées.
            </Text>
            {proposal.nature.state === "PROPOSED" ? (
              <ProcurementCheck
                label={natureLabels[proposal.nature.candidates[0]!.value]}
                value={choices.nature}
                onChange={() =>
                  setChoices((c) => ({ ...c, nature: !c.nature }))
                }
              />
            ) : null}
            {proposal.packaging.state === "PROPOSED" ? (
              <ProcurementCheck
                label={`Contenu : ${proposal.packaging.candidates[0]!.value.quantity} ${proposal.packaging.candidates[0]!.value.unit}`}
                value={choices.packaging}
                onChange={() =>
                  setChoices((c) => ({ ...c, packaging: !c.packaging }))
                }
                detail={proposal.packaging.candidates[0]!.evidence[0]?.label}
              />
            ) : null}
            {proposal.isPetitPrix.state === "PROPOSED" ? (
              <ProcurementCheck
                label="Gamme Petit Prix"
                value={choices.petitPrix}
                onChange={() =>
                  setChoices((c) => ({ ...c, petitPrix: !c.petitPrix }))
                }
              />
            ) : null}
            {proposal.category.current === null ? (
              <View className="gap-2">
                <Text className="text-base font-semibold text-ink">
                  Catégorie · ton choix
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {(["FRUIT", "VEGETABLE", "OTHER"] as const).map((c) => (
                    <Pressable
                      key={c}
                      accessibilityRole="button"
                      accessibilityState={{ selected: category === c }}
                      onPress={() =>
                        setCategory((old) => (old === c ? undefined : c))
                      }
                      className="min-h-11 rounded-full border border-line px-4 py-3"
                      style={{
                        backgroundColor:
                          category === c ? colors.forest : colors.surface,
                      }}
                    >
                      <Text
                        style={{
                          color: category === c ? colors.heroInk : colors.ink,
                        }}
                      >
                        {c === "FRUIT"
                          ? "Fruit"
                          : c === "VEGETABLE"
                            ? "Légume"
                            : "Autre"}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
            <Text className="text-sm leading-6 text-muted">
              L’unité utilisée pour les quantités de l’historique reste
              inchangée.
            </Text>
            {[proposal.nature, proposal.packaging, proposal.isPetitPrix].some(
              (f) => f.state === "REVIEW",
            ) ? (
              <>
                <InlineAlert
                  title="Certains attributs restent à vérifier"
                  message="Libellé tronqué, conditionnement complexe ou valeur existante différente. Vérifie ces points dans l’éditeur de la fiche."
                />
                <SecondaryButton
                  label="Ouvrir l’éditeur produit"
                  onPress={() => {
                    editAfterDismiss.current = true;
                    setPanel(null);
                  }}
                />
              </>
            ) : null}
            {proposal.sources.map((s) => (
              <View key={s.linkId} className="gap-2">
                <Text className="text-sm text-muted">
                  Source : {s.basis.reference.label}
                </Text>
                <SourceOriginalButton
                  sourceDocumentId={s.basis.referenceDocumentId}
                  label="Ouvrir le référentiel source"
                />
              </View>
            ))}
          </View>
        ) : null}
      </BottomSheet>
    </>
  );
}
