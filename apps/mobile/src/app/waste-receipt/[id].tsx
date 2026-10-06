import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, Pressable, Text, TextInput, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import {
  AppHeader,
  AppScreen,
  InlineAlert,
  PrimaryButton,
  SecondaryButton,
  SectionCard,
  StatusBadge,
} from "@/components/ui";
import {
  WasteReceiptRepository,
  type LocalWasteLineDraft,
  type LocalWasteReceiptDetail,
} from "@/documents/waste-receipt-repository";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import { receiptProcessingPresentation } from "@/documents/waste-receipt-processing";

import { WasteReceiptPublicationRepository } from "@/documents/waste-receipt-publication";
import {
  LocalAnalyticsRecomputationScheduler,
  SQLiteProductDateRecomputer,
} from "@/analytics/local-recomputation";

export default function WasteReceiptValidationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const database = useLocalDatabase();
  const { syncNow, status: syncStatus } = useSync();
  const repository = useMemo(
    () => new WasteReceiptRepository(database.sqlite),
    [database.sqlite],
  );
  const [detail, setDetail] = useState<LocalWasteReceiptDetail | null>();
  const [date, setDate] = useState("");
  const dateReceiptId = useRef(id);
  const [publishing, setPublishing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [comparingDuplicate, setComparingDuplicate] = useState(false);
  const [resolvingDuplicate, setResolvingDuplicate] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const next = await repository.getReceiptDetail(id);
      setDetail(next);

      setError(next ? undefined : "Ce ticket est introuvable.");
    } catch {
      setError("Le ticket n’a pas pu être relu.");
    }
  }, [id, repository]);

  const needsRefresh =
    !detail ||
    (detail.receipt.aiStatus !== "COMPLETED" &&
      !["POSSIBLE_DUPLICATE", "CONFIRMED_DUPLICATE"].includes(
        detail.receipt.duplicateStatus,
      )) ||
    (detail.receipt.processingStatus === "PUBLISHED" &&
      detail.receipt.syncState !== "SYNCED");
  useFocusEffect(
    useCallback(() => {
      void load();
      if (!needsRefresh) return;
      const timer = setInterval(() => {
        void load();
      }, 2000);
      return () => clearInterval(timer);
    }, [load, needsRefresh]),
  );
  const loadedReceiptId = detail?.receipt.id;
  const savedDate =
    detail?.receipt.confirmedWasteDate ??
    detail?.receipt.detectedReceiptDate ??
    "";
  useEffect(() => {
    if (loadedReceiptId !== id) return;
    if (dateReceiptId.current !== id) {
      dateReceiptId.current = id;
      setDate(savedDate);
    } else {
      setDate((current) => current || savedDate);
    }
  }, [id, loadedReceiptId, savedDate]);

  const groups = useMemo(
    () => groupLines(detail?.lines ?? []),
    [detail?.lines],
  );

  if (detail === undefined || (detail && detail.receipt.id !== id)) {
    return (
      <AppScreen>
        <AppHeader title="Validation du ticket" subtitle="Chargement…" />
      </AppScreen>
    );
  }

  if (!detail) {
    return (
      <AppScreen>
        <AppHeader title="Validation du ticket" />
        <InlineAlert
          title="Ticket indisponible"
          message={error ?? "Ce ticket est introuvable."}
        />
        <SecondaryButton label="Retour à Casse" onPress={() => router.back()} />
      </AppScreen>
    );
  }

  const processing = receiptProcessingPresentation(
    detail.receipt,
    detail.uploadJob,
    detail.lines.length,
    syncStatus === "offline",
  );
  const reviewCount = detail.lines.filter(
    ({ line }) => line.validationStatus === "TO_REVIEW",
  ).length;

  return (
    <AppScreen>
      <AppHeader
        title="Valider le ticket"
        subtitle={`${detail.lines.length} ligne${detail.lines.length > 1 ? "s" : ""} extraite${detail.lines.length > 1 ? "s" : ""}`}
      >
        <StatusBadge
          status={
            detail.receipt.processingStatus === "PUBLISHED"
              ? detail.receipt.syncState === "SYNCED"
                ? "synced"
                : "pending"
              : detail.receipt.aiStatus === "COMPLETED" && reviewCount > 0
                ? "incomplete"
                : processing.status
          }
        />
      </AppHeader>

      <SectionCard title={processing.title} description={processing.message}>
        {processing.canRetry ? (
          <SecondaryButton
            label="Réessayer maintenant"
            loading={retrying}
            onPress={() => {
              setRetrying(true);
              setError(undefined);
              setMessage(undefined);
              void repository
                .retryProcessing(detail.receipt.id)
                .then(async () => {
                  await load();
                  setMessage("Une nouvelle tentative a été demandée.");
                  await syncNow(detail.receipt.storeId);
                  await load();
                })
                .catch(() =>
                  setError(
                    "La reprise n’est pas disponible pendant un traitement ou pour ce fichier. La source reste conservée.",
                  ),
                )
                .finally(() => setRetrying(false));
            }}
          />
        ) : null}
      </SectionCard>
      {message ? <InlineAlert title="Enregistré" message={message} /> : null}
      {error ? <InlineAlert title="Action impossible" message={error} /> : null}

      {detail.receipt.duplicateStatus === "POSSIBLE_DUPLICATE" ? (
        <SectionCard
          title="Doublon possible"
          description="Un ticket avec exactement la même image existe déjà. Aucun rapprochement n’est décidé à partir des seuls produits ou de la date."
        >
          <InlineAlert
            title="Examen nécessaire"
            message="Comparez les deux sources, puis conservez les deux tickets ou marquez cette nouvelle capture comme doublon."
          />
          {detail.duplicateCandidate ? (
            <Text className="text-sm leading-5 text-muted">
              Ticket existant du{" "}
              {formatDateTime(detail.duplicateCandidate.captureDate)}
            </Text>
          ) : (
            <Text className="text-sm leading-5 text-muted">
              Le ticket existant a été détecté sur le serveur et sa photo n’est
              pas stockée sur cet appareil.
            </Text>
          )}
          <SecondaryButton
            label={comparingDuplicate ? "Masquer la comparaison" : "Comparer"}
            onPress={() => setComparingDuplicate((value) => !value)}
          />
          {comparingDuplicate ? (
            <View className="gap-3 rounded-2xl border border-line bg-canvas p-4">
              <Text className="font-semibold text-ink">Ticket existant</Text>
              {detail.duplicateCandidate?.localFileUri ? (
                <Image
                  source={{ uri: detail.duplicateCandidate.localFileUri }}
                  resizeMode="contain"
                  className="h-64 w-full rounded-2xl bg-surface-muted"
                  accessibilityLabel="Photo du ticket existant"
                />
              ) : (
                <Text className="text-sm text-muted">
                  Photo existante indisponible sur cet appareil.
                </Text>
              )}
            </View>
          ) : null}
          <PrimaryButton
            label="Conserver les deux"
            loading={resolvingDuplicate}
            onPress={() => {
              setResolvingDuplicate(true);
              setError(undefined);
              void repository
                .resolveExactDuplicate(
                  detail.receipt.id,
                  "KEEP_BOTH",
                  randomUUID(),
                )
                .then(async () => {
                  setMessage(
                    "Les deux tickets sont conservés. L’envoi démarre.",
                  );
                  await load();
                  void syncNow(detail.receipt.storeId);
                })
                .catch(() => setError("Le choix n’a pas pu être enregistré."))
                .finally(() => setResolvingDuplicate(false));
            }}
          />
          <SecondaryButton
            label="Marquer comme doublon"
            disabled={resolvingDuplicate}
            onPress={() => {
              setResolvingDuplicate(true);
              setError(undefined);
              void repository
                .resolveExactDuplicate(detail.receipt.id, "CONFIRM_DUPLICATE")
                .then(async () => {
                  setMessage("Ce ticket est conservé et marqué comme doublon.");
                  await load();
                })
                .catch(() => setError("Le choix n’a pas pu être enregistré."))
                .finally(() => setResolvingDuplicate(false));
            }}
          />
        </SectionCard>
      ) : null}

      {detail.receipt.duplicateStatus === "CONFIRMED_DUPLICATE" ? (
        <InlineAlert
          title="Doublon confirmé"
          message="La nouvelle source reste conservée sur cet appareil et ne sera pas publiée."
        />
      ) : null}

      {detail.receipt.processingStatus === "PUBLISHED" ? (
        <InlineAlert
          title="Casse validée"
          message={
            detail.receipt.syncState === "SYNCED"
              ? "Les lignes sont publiées et synchronisées."
              : "Les lignes sont publiées localement. Synchronisation en attente."
          }
        />
      ) : (
        <SectionCard
          title="Publication de la casse"
          description="Confirmez la date et vérifiez chaque produit, quantité et montant avant de valider."
        >
          <PrimaryButton
            label="Valider la casse"
            loading={publishing}
            disabled={
              detail.lines.length === 0 ||
              !detail.receipt.confirmedWasteDate ||
              detail.receipt.duplicateStatus === "POSSIBLE_DUPLICATE" ||
              detail.receipt.duplicateStatus === "CONFIRMED_DUPLICATE"
            }
            onPress={() => {
              setPublishing(true);
              setError(undefined);
              setMessage(undefined);
              void new WasteReceiptPublicationRepository(database.sqlite)
                .publish({
                  receiptId: detail.receipt.id,
                  storeId: detail.receipt.storeId,
                  deviceId: database.deviceId,
                  commandId: randomUUID(),
                  analyticsJobId: randomUUID(),
                  timestamp: new Date().toISOString(),
                })
                .then(async () => {
                  await load();
                  const recomputation =
                    await new LocalAnalyticsRecomputationScheduler(
                      database.sqlite,
                      new SQLiteProductDateRecomputer(database.sqlite),
                    ).process(detail.receipt.storeId);
                  setMessage(
                    recomputation.failedJobs > 0
                      ? "La casse est validée. Le recalcul des indicateurs reste en attente."
                      : "La casse est validée et les indicateurs locaux sont mis à jour.",
                  );
                  void syncNow(detail.receipt.storeId).then(load);
                })
                .catch(() =>
                  setError(
                    "Vérifiez les produits associés, les quantités, les montants et la date. La casse n’a pas été publiée.",
                  ),
                )
                .finally(() => setPublishing(false));
            }}
          />
        </SectionCard>
      )}
      <SectionCard
        title="Photo source"
        description="L’original reste conservé sur cet appareil."
      >
        {detail.localFileUri ? (
          <Image
            source={{ uri: detail.localFileUri }}
            resizeMode="contain"
            className="h-80 w-full rounded-2xl bg-surface-muted"
            accessibilityLabel="Photo du ticket de casse"
          />
        ) : (
          <Text className="text-sm text-muted">Photo locale indisponible.</Text>
        )}
      </SectionCard>

      {detail.receipt.processingStatus !== "PUBLISHED" ? (
        <SectionCard
          title="Date de casse"
          description={
            detail.receipt.detectedReceiptDate
              ? `Date détectée : ${formatDate(detail.receipt.detectedReceiptDate)}`
              : "Aucune date fiable n’a été détectée. Saisissez la date du ticket."
          }
        >
          <TextInput
            value={date}
            onChangeText={setDate}
            placeholder="AAAA-MM-JJ"
            autoCapitalize="none"
            className="min-h-12 rounded-xl border border-line bg-canvas px-4 text-base text-ink"
            accessibilityLabel="Date de casse au format année mois jour"
          />
          <PrimaryButton
            label="Confirmer la date"
            onPress={() => {
              setError(undefined);
              setMessage(undefined);
              void repository
                .confirmWasteDate(detail.receipt.id, date)
                .then(async () => {
                  setMessage("La date de casse est confirmée.");
                  await load();
                })
                .catch(() =>
                  setError("Saisissez une date valide au format AAAA-MM-JJ."),
                );
            }}
          />
        </SectionCard>
      ) : (
        <Text className="text-base text-ink">
          Date de casse : {formatDate(detail.receipt.confirmedWasteDate!)}
        </Text>
      )}

      <View className="gap-4">
        <View className="gap-1">
          <Text className="text-xl font-semibold text-ink">
            Lignes du ticket
          </Text>
          <Text className="text-sm leading-5 text-muted">
            Les répétitions sont regroupées, mais chaque occurrence reste
            modifiable séparément.
          </Text>
        </View>
        {detail.receipt.processingStatus === "PUBLISHED"
          ? detail.lines.map(({ line }) => (
              <Text key={line.id} className="text-base text-ink">
                {line.rawLabel} · {line.totalPrice ?? "—"} €
              </Text>
            ))
          : groups.map((group) => (
              <LineGroup
                key={group.key}
                label={group.label}
                lines={group.lines}
                receiptId={detail.receipt.id}
                repository={repository}
                onChanged={load}
                onMessage={setMessage}
                onError={setError}
              />
            ))}
      </View>

      <SecondaryButton label="Retour à Casse" onPress={() => router.back()} />
    </AppScreen>
  );
}

function LineGroup({
  label,
  lines,
  receiptId,
  repository,
  onChanged,
  onMessage,
  onError,
}: {
  label: string;
  lines: LocalWasteLineDraft[];
  receiptId: string;
  repository: WasteReceiptRepository;
  onChanged(): Promise<void>;
  onMessage(value: string | undefined): void;
  onError(value: string | undefined): void;
}) {
  const [expanded, setExpanded] = useState(lines.length === 1);
  const total = lines.reduce(
    (sum, item) => sum + Number(item.line.totalPrice ?? 0),
    0,
  );
  return (
    <SectionCard
      title={label}
      description={`${lines.length} occurrence${lines.length > 1 ? "s" : ""}${total > 0 ? ` · ${formatMoney(total)}` : ""}`}
    >
      {lines.length > 1 ? (
        <SecondaryButton
          label={expanded ? "Masquer les occurrences" : "Voir les occurrences"}
          onPress={() => setExpanded((value) => !value)}
        />
      ) : null}
      {expanded
        ? lines.map((draft) => (
            <LineEditor
              key={draft.line.id}
              draft={draft}
              receiptId={receiptId}
              repository={repository}
              onChanged={onChanged}
              onMessage={onMessage}
              onError={onError}
            />
          ))
        : null}
    </SectionCard>
  );
}

function LineEditor({
  draft,
  receiptId,
  repository,
  onChanged,
  onMessage,
  onError,
}: {
  draft: LocalWasteLineDraft;
  receiptId: string;
  repository: WasteReceiptRepository;
  onChanged(): Promise<void>;
  onMessage(value: string | undefined): void;
  onError(value: string | undefined): void;
}) {
  const [rawLabel, setRawLabel] = useState(draft.line.rawLabel);
  const [weight, setWeight] = useState(draft.line.weight ?? "");
  const [quantity, setQuantity] = useState(draft.line.quantity ?? "");
  const [quantityUnit, setQuantityUnit] = useState(
    draft.line.quantityUnit ?? "UNKNOWN",
  );
  const [unitPrice, setUnitPrice] = useState(draft.line.unitPrice ?? "");
  const [totalPrice, setTotalPrice] = useState(draft.line.totalPrice ?? "");

  useEffect(() => {
    setRawLabel(draft.line.rawLabel);
    setWeight(draft.line.weight ?? "");
    setQuantity(draft.line.quantity ?? "");
    setQuantityUnit(draft.line.quantityUnit ?? "UNKNOWN");
    setUnitPrice(draft.line.unitPrice ?? "");
    setTotalPrice(draft.line.totalPrice ?? "");
  }, [
    draft.line.rawLabel,
    draft.line.weight,
    draft.line.quantity,
    draft.line.quantityUnit,
    draft.line.unitPrice,
    draft.line.totalPrice,
  ]);

  return (
    <View className="gap-3 rounded-2xl border border-line bg-canvas p-4">
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-sm font-semibold text-muted">
          Ligne {draft.line.sourceLineIndex + 1}
        </Text>
        {draft.line.validationStatus === "TO_REVIEW" ? (
          <StatusBadge status="incomplete" />
        ) : null}
      </View>

      <Field label="Libellé" value={rawLabel} onChangeText={setRawLabel} />
      <Field
        label="Quantité (pièces ou packs)"
        value={quantity}
        onChangeText={setQuantity}
        decimal
      />
      <View className="flex-row gap-2">
        {(["KG", "PIECE", "PACK", "UNKNOWN"] as const).map((unit) => (
          <Pressable
            key={unit}
            accessibilityRole="button"
            accessibilityState={{ selected: quantityUnit === unit }}
            onPress={() => setQuantityUnit(unit)}
            className="min-h-12 justify-center rounded-xl border border-line px-2"
          >
            <Text>
              {unit === "KG"
                ? "kg"
                : unit === "PIECE"
                  ? "Pièces"
                  : unit === "PACK"
                    ? "Packs"
                    : "À préciser"}
              {quantityUnit === unit ? " ✓" : ""}
            </Text>
          </Pressable>
        ))}
      </View>
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Field
            label="Poids (kg)"
            value={weight}
            onChangeText={setWeight}
            decimal
          />
        </View>
        <View className="flex-1">
          <Field
            label="Prix unitaire (€)"
            value={unitPrice}
            onChangeText={setUnitPrice}
            decimal
          />
        </View>
      </View>
      <Field
        label="Montant (€)"
        value={totalPrice}
        onChangeText={setTotalPrice}
        decimal
      />

      {draft.arithmeticStatus === "MISMATCH" ? (
        <InlineAlert
          title="Montant à vérifier"
          message={`Calcul attendu : ${draft.arithmeticExpectedTotal ?? "inconnu"} € · écart : ${draft.arithmeticDifference ?? "inconnu"} €.`}
        />
      ) : null}

      <View className="gap-2">
        <Text className="text-sm font-semibold text-ink">Produit associé</Text>
        <Text className="text-sm text-muted">
          {draft.matchedProductLabel ??
            (draft.candidates.length > 0
              ? "Choisissez le bon produit."
              : "Aucun produit proposé.")}
        </Text>
        {draft.candidates.map((candidate) => (
          <Pressable
            key={candidate.productId}
            accessibilityRole="button"
            accessibilityLabel={`Associer à ${candidate.label}`}
            onPress={() => {
              onError(undefined);
              onMessage(undefined);
              void repository
                .selectProductCandidate(
                  receiptId,
                  draft.line.id,
                  candidate.productId,
                )
                .then(async () => {
                  onMessage(`Produit associé : ${candidate.label}.`);
                  await onChanged();
                })
                .catch(() => onError("Ce produit ne peut pas être associé."));
            }}
            className={`min-h-12 justify-center rounded-xl border px-4 py-3 ${
              draft.line.matchedProductId === candidate.productId
                ? "border-forest bg-positive-soft"
                : "border-line bg-white"
            }`}
          >
            <Text className="font-semibold text-ink">{candidate.label}</Text>
            <Text className="text-sm text-muted">
              {natureLabel(candidate.nature)} · score{" "}
              {Math.round(candidate.score * 100)} %
            </Text>
          </Pressable>
        ))}
      </View>

      <SecondaryButton
        label={
          draft.line.validationStatus === "EXCLUDED"
            ? "Réintégrer la ligne"
            : "Exclure cette ligne de la casse"
        }
        onPress={() => {
          void repository
            .setLineExcluded(
              receiptId,
              draft.line.id,
              draft.line.validationStatus !== "EXCLUDED",
            )
            .then(onChanged)
            .catch(() => onError("Le choix n’a pas pu être enregistré."));
        }}
      />
      {draft.line.validationStatus === "EXCLUDED" ? (
        <InlineAlert
          title="Ligne exclue"
          message="Cette occurrence reste conservée dans le ticket et ne sera pas publiée."
        />
      ) : null}
      <PrimaryButton
        label="Enregistrer la ligne"
        onPress={() => {
          onError(undefined);
          onMessage(undefined);
          void repository
            .updateLineValues(receiptId, draft.line.id, {
              rawLabel,
              quantity: emptyToNull(quantity),
              quantityUnit,
              weight: emptyToNull(weight),
              unitPrice: emptyToNull(unitPrice),
              totalPrice: emptyToNull(totalPrice),
            })
            .then(async () => {
              onMessage(`Ligne ${draft.line.sourceLineIndex + 1} enregistrée.`);
              await onChanged();
            })
            .catch(() =>
              onError("Vérifiez le libellé et les valeurs numériques."),
            );
        }}
      />
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  decimal = false,
}: {
  label: string;
  value: string;
  onChangeText(value: string): void;
  decimal?: boolean;
}) {
  return (
    <View className="gap-1">
      <Text className="text-sm font-medium text-muted">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={decimal ? "decimal-pad" : "default"}
        className="min-h-12 rounded-xl border border-line bg-white px-3 text-base text-ink"
      />
    </View>
  );
}

function groupLines(lines: readonly LocalWasteLineDraft[]) {
  const groups = new Map<string, LocalWasteLineDraft[]>();
  for (const line of lines) {
    const key = line.line.rawLabel
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLocaleUpperCase("fr-FR")
      .replace(/\s+/g, " ")
      .trim();
    const current = groups.get(key) ?? [];
    current.push(line);
    groups.set(key, current);
  }
  return [...groups.entries()].map(([key, linesInGroup]) => ({
    key,
    label: linesInGroup[0]?.line.rawLabel ?? key,
    lines: linesInGroup,
  }));
}

function emptyToNull(value: string) {
  return value.trim() ? value.trim().replace(",", ".") : null;
}

function natureLabel(value: "BULK" | "PACKAGED" | "UNKNOWN") {
  if (value === "BULK") return "Vrac";
  if (value === "PACKAGED") return "Emballé";
  return "Nature à confirmer";
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function formatDateTime(value: string | null) {
  if (!value) return "date inconnue";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "date inconnue"
    : new Intl.DateTimeFormat("fr-FR", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}
