import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, Pressable, Text, TextInput, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { DateSelector } from "@/components/date-selector";
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
  WastePublicationValidationError,
  type WastePublicationIssue,
  type WastePublicationWarning,
  type WastePublicationField,
} from "@/documents/waste-publication-validation";
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
  const publisher = useMemo(
    () => new WasteReceiptPublicationRepository(database.sqlite),
    [database.sqlite],
  );
  const [publicationIssues, setPublicationIssues] = useState<
    WastePublicationIssue[]
  >([]);
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [showCatalogWarnings, setShowCatalogWarnings] = useState(false);
  const [showQuantityWarnings, setShowQuantityWarnings] = useState(false);
  const [publicationWarnings, setPublicationWarnings] = useState<
    WastePublicationWarning[]
  >([]);
  const [dirtyFields, setDirtyFields] = useState<
    Record<string, WastePublicationField[]>
  >({});
  const onDirty = useCallback(
    (lineId: string, fields: WastePublicationField[]) => {
      setDirtyFields((current) =>
        JSON.stringify(current[lineId] ?? []) === JSON.stringify(fields)
          ? current
          : { ...current, [lineId]: fields },
      );
    },
    [],
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
      if (next) {
        const report = await publisher.inspect(
          next.receipt.id,
          next.receipt.storeId,
        );
        setPublicationWarnings(report.warnings);
        if (validationAttempted) setPublicationIssues(report.issues);
      }

      setError(next ? undefined : "Ce ticket est introuvable.");
    } catch {
      setError("Le ticket n’a pas pu être relu.");
    }
  }, [id, repository, publisher, validationAttempted]);

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
  const unsavedIssues: WastePublicationIssue[] = detail.lines.flatMap(
    ({ line }) =>
      line.validationStatus === "EXCLUDED"
        ? []
        : (dirtyFields[line.id] ?? []).map((field) => ({
            lineId: line.id,
            lineIndex: line.sourceLineIndex,
            label: line.rawLabel,
            field,
            message:
              "Modification non enregistrée. Enregistrez cette ligne avant de publier.",
          })),
  );
  if (
    detail.receipt.confirmedWasteDate &&
    date !== detail.receipt.confirmedWasteDate
  )
    unsavedIssues.push({
      field: "date",
      message: "La date a été modifiée. Confirmez-la avant de publier.",
    });
  const issues = validationAttempted
    ? [...publicationIssues, ...unsavedIssues]
    : [];
  const summaryIssues = [
    ...new Map(
      issues.map((issue) => [
        `${issue.lineId ?? "ticket"}:${issue.message}`,
        issue,
      ]),
    ).values(),
  ];
  const catalogWarnings = [
    ...new Map(
      publicationWarnings
        .filter((w) => w.kind === "CATALOG")
        .map((w) => [`${w.productId}:${w.message}`, w]),
    ).values(),
  ];
  const quantityWarnings = publicationWarnings.filter(
    (w) => w.kind === "QUANTITY",
  );
  const dateIssue = issues.find((issue) => issue.field === "date")?.message;
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
      {catalogWarnings.length ? (
        <SectionCard
          title="Référentiel à compléter"
          description="Ces informations manquantes ne bloquent pas la casse. Elles pourront être complétées séparément ; certaines analyses resteront limitées."
        >
          <Text className="text-sm text-muted">
            {new Set(catalogWarnings.map((w) => w.productId)).size} produit(s)
            concerné(s).
          </Text>
          <SecondaryButton
            label={
              showCatalogWarnings
                ? "Masquer les informations manquantes"
                : "Voir les informations manquantes"
            }
            onPress={() => setShowCatalogWarnings((value) => !value)}
          />
          {showCatalogWarnings
            ? catalogWarnings.map((w) => (
                <Text
                  key={`${w.productId}:${w.message}`}
                  className="text-sm leading-5 text-warning"
                >
                  {w.label} : {w.message}
                </Text>
              ))
            : null}
          {showCatalogWarnings ? (
            <SecondaryButton
              label="Ouvrir le référentiel"
              onPress={() => router.push("/(tabs)/products")}
            />
          ) : null}
        </SectionCard>
      ) : null}
      {quantityWarnings.length ? (
        <SectionCard
          title="Quantités non comparables"
          description="Les montants validés peuvent être publiés. Les mesures d’origine restent conservées sur le ticket."
        >
          <Text className="text-sm text-muted">
            {quantityWarnings.length} ligne(s) concernée(s).
          </Text>
          <SecondaryButton
            label={
              showQuantityWarnings
                ? "Masquer les détails"
                : "Voir les détails des quantités"
            }
            onPress={() => setShowQuantityWarnings((value) => !value)}
          />
          {showQuantityWarnings
            ? quantityWarnings.map((w) => (
                <Text
                  key={`${w.lineId}:${w.message}`}
                  className="text-sm leading-5 text-warning"
                >
                  Ligne {(w.lineIndex ?? 0) + 1} · {w.label} : {w.message}
                </Text>
              ))
            : null}
        </SectionCard>
      ) : null}
      {summaryIssues.length ? (
        <SectionCard
          title="Champs à corriger"
          description="Les champs bloquants sont surlignés ci-dessous. Aucune ligne n’a été publiée."
        >
          {summaryIssues.map((issue, index) => (
            <Text
              key={`${issue.lineId ?? issue.field}:${index}`}
              accessibilityRole="alert"
              className="text-sm leading-5 text-critical"
            >
              {issue.lineIndex !== undefined
                ? `Ligne ${issue.lineIndex + 1} · ${issue.label} : `
                : ""}
              {issue.message}
            </Text>
          ))}
        </SectionCard>
      ) : null}

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
          description="Confirmez la date, l’identité des produits et les montants. Les informations manquantes du référentiel restent signalées sans bloquer la casse."
        >
          <PrimaryButton
            label="Valider la casse"
            loading={publishing}
            onPress={() => {
              setValidationAttempted(true);
              setError(undefined);
              setMessage(undefined);
              if (unsavedIssues.length) {
                void publisher
                  .validate(detail.receipt.id, detail.receipt.storeId)
                  .then(setPublicationIssues)
                  .catch(() =>
                    setError(
                      "Les contrôles du ticket n’ont pas pu être relus. Réessayez.",
                    ),
                  );
                return;
              }
              setPublishing(true);
              void publisher
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
                .catch((reason) => {
                  if (reason instanceof WastePublicationValidationError)
                    setPublicationIssues(reason.issues);
                  else
                    setError(
                      "Une erreur technique empêche l’enregistrement local. Vos corrections sont conservées. Réessayez ; si cela persiste, signalez ce ticket.",
                    );
                })
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
              : "Aucune date fiable n’a été détectée. Choisissez la date imprimée sur le ticket."
          }
        >
          <DateSelector
            value={date}
            issue={dateIssue}
            onConfirm={(selected) => {
              setDate(selected);
              setError(undefined);
              setMessage(undefined);
              void repository
                .confirmWasteDate(detail.receipt.id, selected)
                .then(async () => {
                  setMessage("La date de casse est confirmée.");
                  await load();
                })
                .catch(() =>
                  setError(
                    "La date choisie n’a pas pu être enregistrée. Réessayez.",
                  ),
                );
            }}
          />
          {dateIssue ? (
            <Text accessibilityRole="alert" className="text-sm text-critical">
              {dateIssue}
            </Text>
          ) : null}
          <PrimaryButton
            label={
              date === detail.receipt.confirmedWasteDate
                ? "Date confirmée"
                : "Confirmer la date"
            }
            disabled={date === detail.receipt.confirmedWasteDate}
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
                  setError(
                    "Choisissez une date dans le calendrier avant de la confirmer.",
                  ),
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
                hasUnsavedChanges={group.lines.some(
                  ({ line }) => (dirtyFields[line.id]?.length ?? 0) > 0,
                )}
                receiptId={detail.receipt.id}
                repository={repository}
                onChanged={load}
                onMessage={setMessage}
                onError={setError}
                issues={issues}
                onDirty={onDirty}
              />
            ))}
      </View>

      <SecondaryButton label="Retour à Casse" onPress={() => router.back()} />
    </AppScreen>
  );
}

function LineGroup({
  hasUnsavedChanges,
  issues,
  onDirty,
  label,
  lines,
  receiptId,
  repository,
  onChanged,
  onMessage,
  onError,
}: {
  label: string;
  hasUnsavedChanges: boolean;
  lines: LocalWasteLineDraft[];
  receiptId: string;
  repository: WasteReceiptRepository;
  onChanged(): Promise<void>;
  onMessage(value: string | undefined): void;
  onError(value: string | undefined): void;
  issues: WastePublicationIssue[];
  onDirty(lineId: string, fields: WastePublicationField[]): void;
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
          disabled={hasUnsavedChanges}
          onPress={() => setExpanded((value) => !value)}
        />
      ) : null}
      {hasUnsavedChanges && lines.length > 1 ? (
        <Text className="text-sm text-muted">
          Enregistrez les lignes modifiées avant de fermer le groupe.
        </Text>
      ) : null}
      {expanded ||
      lines.some(({ line }) => issues.some((issue) => issue.lineId === line.id))
        ? lines.map((draft) => (
            <LineEditor
              key={draft.line.id}
              draft={draft}
              receiptId={receiptId}
              repository={repository}
              onChanged={onChanged}
              onMessage={onMessage}
              onError={onError}
              issues={issues}
              onDirty={onDirty}
            />
          ))
        : null}
    </SectionCard>
  );
}

function LineEditor({
  issues,
  onDirty,
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
  issues: WastePublicationIssue[];
  onDirty(lineId: string, fields: WastePublicationField[]): void;
}) {
  const router = useRouter();
  const [localIssues, setLocalIssues] = useState<WastePublicationIssue[]>([]);
  const fieldIssue = (field: WastePublicationField) =>
    [
      ...localIssues,
      ...issues.filter((issue) => issue.lineId === draft.line.id),
    ].find((issue) => issue.field === field)?.message;
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

  useEffect(() => {
    const fields: WastePublicationField[] = [];
    if (rawLabel !== draft.line.rawLabel) fields.push("rawLabel");
    if (weight !== (draft.line.weight ?? "")) fields.push("weight");
    if (quantity !== (draft.line.quantity ?? "")) fields.push("quantity");
    if (quantityUnit !== (draft.line.quantityUnit ?? "UNKNOWN"))
      fields.push("quantityUnit");
    if (unitPrice !== (draft.line.unitPrice ?? "")) fields.push("unitPrice");
    if (totalPrice !== (draft.line.totalPrice ?? "")) fields.push("totalPrice");
    onDirty(draft.line.id, fields);
  }, [
    onDirty,
    draft.line.id,
    draft.line.rawLabel,
    draft.line.weight,
    draft.line.quantity,
    draft.line.quantityUnit,
    draft.line.unitPrice,
    draft.line.totalPrice,
    rawLabel,
    weight,
    quantity,
    quantityUnit,
    unitPrice,
    totalPrice,
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

      <Field
        label="Libellé"
        value={rawLabel}
        onChangeText={setRawLabel}
        issue={fieldIssue("rawLabel")}
      />
      <Field
        label="Quantité (pièces ou unités conditionnées)"
        issue={fieldIssue("quantity")}
        value={quantity}
        onChangeText={setQuantity}
        decimal
      />
      <View
        className={`flex-row flex-wrap gap-2 rounded-xl ${fieldIssue("quantityUnit") ? "border border-critical bg-critical-soft p-1" : ""}`}
      >
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
                    ? "Unités conditionnées"
                    : "À préciser"}
              {quantityUnit === unit ? " ✓" : ""}
            </Text>
          </Pressable>
        ))}
      </View>
      {fieldIssue("quantityUnit") ? (
        <Text accessibilityRole="alert" className="text-sm text-critical">
          {fieldIssue("quantityUnit")}
        </Text>
      ) : null}
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Field
            label="Poids (kg)"
            issue={fieldIssue("weight")}
            value={weight}
            onChangeText={setWeight}
            decimal
          />
        </View>
        <View className="flex-1">
          <Field
            label="Prix unitaire (€)"
            issue={fieldIssue("unitPrice")}
            value={unitPrice}
            onChangeText={setUnitPrice}
            decimal
          />
        </View>
      </View>
      <Field
        label="Montant (€)"
        issue={fieldIssue("totalPrice")}
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

      <View
        className={`gap-2 rounded-xl ${fieldIssue("product") ? "border border-critical bg-critical-soft p-3" : ""}`}
      >
        <Text className="text-sm font-semibold text-ink">Produit associé</Text>
        {fieldIssue("product") ? (
          <Text accessibilityRole="alert" className="text-sm text-critical">
            {fieldIssue("product")}
          </Text>
        ) : null}
        {fieldIssue("product") && draft.line.matchedProductId ? (
          <SecondaryButton
            label="Compléter la fiche produit"
            onPress={() =>
              router.push(`/(tabs)/products/${draft.line.matchedProductId}`)
            }
          />
        ) : null}
        <Text className="text-sm text-muted">
          {draft.matchedProductLabel ??
            (draft.candidates.length > 0
              ? "Choisissez le bon produit."
              : "Aucun produit proposé.")}
        </Text>
        {fieldIssue("product") && draft.line.matchedProductId ? (
          <SecondaryButton
            label="Reconfirmer le produit associé"
            onPress={() => {
              void repository
                .selectProductCandidate(
                  receiptId,
                  draft.line.id,
                  draft.line.matchedProductId!,
                )
                .then(onChanged)
                .catch(() =>
                  onError(
                    "Ce produit n’est plus disponible dans le référentiel.",
                  ),
                );
            }}
          />
        ) : null}
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
          const invalid: WastePublicationIssue[] = [];
          if (!rawLabel.trim())
            invalid.push({
              field: "rawLabel",
              message: "Renseignez le libellé.",
            });
          for (const [field, value] of [
            ["weight", weight],
            ["quantity", quantity],
            ["unitPrice", unitPrice],
            ["totalPrice", totalPrice],
          ] as const) {
            if (
              value.trim() &&
              !/^\d+(?:\.\d+)?$/.test(value.trim().replace(",", "."))
            )
              invalid.push({
                field,
                message: "Utilisez un nombre positif ou nul, par exemple 1,25.",
              });
          }
          setLocalIssues(invalid);
          if (invalid.length) return;
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
  issue,
}: {
  label: string;
  value: string;
  onChangeText(value: string): void;
  decimal?: boolean;
  issue?: string;
}) {
  return (
    <View className="gap-1">
      <Text className="text-sm font-medium text-muted">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={decimal ? "decimal-pad" : "default"}
        accessibilityLabel={label}
        accessibilityHint={issue}
        className={`min-h-12 rounded-xl border px-3 text-base text-ink ${issue ? "border-critical bg-critical-soft" : "border-line bg-white"}`}
      />
      {issue ? (
        <Text accessibilityRole="alert" className="text-sm text-critical">
          {issue}
        </Text>
      ) : null}
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
  if (value === "PACKAGED") return "Conditionné";
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
