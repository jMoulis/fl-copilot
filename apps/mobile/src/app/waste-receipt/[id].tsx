import { ReceiptReviewGroup } from "../../documents/receipt-review-group";
import {
  ReceiptLinePreview,
  ReceiptIssueSummary,
  useReceiptIssueNavigation,
} from "../../documents/receipt-issue-summary";
import { useAuth } from "../../auth/auth-provider";
import { useUnsavedForm } from "../../components/use-unsaved-form";
import {
  receiptHeaderValues,
  receiptLineValues,
  receiptLineDirtyFields,
  updateReceiptLineEdit,
  withoutReceiptLineEdit,
  type ReceiptLineEdits,
  type ReceiptLineValues,
} from "../../documents/receipt-editor-state";
import { ReceiptSourcePhotos } from "../../documents/receipt-source-photos";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  Alert,
  Platform,
  type LayoutChangeEvent,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  normalizeProductLabel,
  type ProductAlias,
  type WasteLine,
} from "@fl-copilot/domain";
import { ProductMasterRepository } from "../../products/product-master-repository";
import { randomUUID } from "expo-crypto";
import { DateSelector } from "../../components/date-selector";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import {
  AppHeader,
  AppScreen,
  InlineAlert,
  PrimaryButton,
  SecondaryButton,
  SectionCard,
  StatusBadge,
} from "../../components/ui";
import {
  WasteReceiptRepository,
  type LocalWasteLineDraft,
  type LocalWasteReceiptDetail,
} from "../../documents/waste-receipt-repository";
import { useLocalDatabase } from "../../providers/database-provider";
import { useSync } from "../../sync/sync-provider";
import { receiptProcessingPresentation } from "../../documents/waste-receipt-processing";

import { WasteReceiptPublicationRepository } from "../../documents/waste-receipt-publication";
import {
  WastePublicationValidationError,
  type WastePublicationIssue,
  type WastePublicationWarning,
  type WastePublicationField,
} from "../../documents/waste-publication-validation";
import {
  LocalAnalyticsRecomputationScheduler,
  SQLiteProductDateRecomputer,
} from "../../analytics/local-recomputation";

export default function WasteReceiptValidationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth(),
    storeId = session?.stores[0]?.storeId;
  return id && storeId && session ? (
    <ReceiptEditor
      key={`${storeId}:${session.user.id}:${id}`}
      id={id}
      storeId={storeId}
    />
  ) : (
    <AppScreen>
      <AppHeader title="Validation du ticket" />
      <InlineAlert
        title="Ticket indisponible"
        message="Connectez-vous au magasin du ticket pour le consulter."
      />
    </AppScreen>
  );
}
function ReceiptEditor({ id, storeId }: { id: string; storeId: string }) {
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
  const { scrollRef, anchor, linesAnchor, groupAnchor, locate } =
    useReceiptIssueNavigation();
  const [publicationIssues, setPublicationIssues] = useState<
    WastePublicationIssue[]
  >([]);
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [showCatalogWarnings, setShowCatalogWarnings] = useState(false);
  const [showQuantityWarnings, setShowQuantityWarnings] = useState(false);
  const [publicationWarnings, setPublicationWarnings] = useState<
    WastePublicationWarning[]
  >([]);
  const [edits, setEdits] = useState<ReceiptLineEdits>({});
  const [activeLineId, setActiveLineId] = useState<string>();
  const [savingLines, setSavingLines] = useState<Record<string, boolean>>({});
  const onEdit = useCallback(
    (line: WasteLine, patch: Partial<ReceiptLineValues>) =>
      setEdits((v) => updateReceiptLineEdit(v, line, patch)),
    [],
  );
  const onReset = useCallback(
    (id: string) => setEdits((v) => withoutReceiptLineEdit(v, id)),
    [],
  );
  const onSaving = useCallback(
    (id: string, value: boolean) =>
      setSavingLines((v) => ({ ...v, [id]: value })),
    [],
  );
  const dirtyFields = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(edits).map(([id, e]) => [
          id,
          receiptLineDirtyFields(e.baseline, e.values),
        ]),
      ),
    [edits],
  );
  const [detail, setDetail] = useState<LocalWasteReceiptDetail | null>();
  const [dateDraft, setDateDraft] = useState<string>();
  const [cashierDraft, setCashierDraft] = useState<string>();
  const [dateSaving, setDateSaving] = useState(false);
  const [showPhotos, setShowPhotos] = useState(false);
  const readGeneration = useRef(0);
  const {
    date,
    cashierNumber,
    savedCashierNumber,
    dirty: headerDirty,
  } = receiptHeaderValues(detail?.receipt, dateDraft, cashierDraft);
  const setDate = setDateDraft,
    setCashierNumber = setCashierDraft;
  const [cashierSaving, setCashierSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [comparingDuplicate, setComparingDuplicate] = useState(false);
  const [resolvingDuplicate, setResolvingDuplicate] = useState(false);

  const load = useCallback(async () => {
    if (!id) return false;
    const generation = ++readGeneration.current;
    try {
      const next = await repository.getReceiptDetail(id, storeId);
      if (generation !== readGeneration.current) return false;
      setDetail(next);
      if (next) {
        const report = await publisher.inspect(
          next.receipt.id,
          next.receipt.storeId,
        );
        if (generation !== readGeneration.current) return false;
        setPublicationWarnings(report.warnings);
        setPublicationIssues(report.issues);
      }

      setError(next ? undefined : "Ce ticket est introuvable.");
      return !!next;
    } catch {
      if (generation !== readGeneration.current) return false;
      setDetail((previous) => previous ?? null);
      setError(
        "Le ticket n’a pas pu être relu. Les données déjà affichées sont conservées.",
      );
      return false;
    }
  }, [id, storeId, repository, publisher]);

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
  const busy =
    dateSaving ||
    cashierSaving ||
    publishing ||
    retrying ||
    resolvingDuplicate ||
    Object.values(savingLines).some(Boolean);
  useUnsavedForm(headerDirty || Object.keys(edits).length > 0, busy);
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
        <SecondaryButton
          label="Réessayer la lecture"
          onPress={() => void load()}
        />
        <SecondaryButton label="Retour à Casse" onPress={() => router.back()} />
        {headerDirty || Object.keys(edits).length ? (
          <ReceiptUnsavedInputs
            edits={Object.entries(edits)}
            date={dateDraft}
            cashier={cashierDraft}
            onAbandon={() =>
              confirmAbandon(() => {
                setEdits({});
                setDateDraft(undefined);
                setCashierDraft(undefined);
              })
            }
          />
        ) : null}
      </AppScreen>
    );
  }

  const retainedEdits = Object.entries(edits).filter(
    ([id]) =>
      detail.receipt.processingStatus === "PUBLISHED" ||
      !detail.lines.some((d) => d.line.id === id),
  );
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
  for (const [lineId, edit] of Object.entries(edits)) {
    const current = detail.lines.find((d) => d.line.id === lineId)?.line;
    if (!current || current.version !== edit.baseline.version)
      unsavedIssues.push({
        lineId,
        field: "save",
        lineIndex: edit.baseline.sourceLineIndex,
        label: edit.baseline.rawLabel,
        message:
          "Cette ligne a changé pendant votre saisie. Votre saisie est conservée ; relisez la ligne avant de l’enregistrer.",
      });
  }
  if (
    detail.receipt.confirmedWasteDate &&
    date !== detail.receipt.confirmedWasteDate
  )
    unsavedIssues.push({
      field: "date",
      message: "La date a été modifiée. Confirmez-la avant de publier.",
    });
  if (cashierNumber.trim() !== savedCashierNumber)
    unsavedIssues.push({
      field: "cashierNumber",
      message:
        "Le numéro de caissier a été modifié. Confirmez-le pour conserver votre correction.",
    });
  const cashierIssue = unsavedIssues.find(
    (issue) => issue.field === "cashierNumber",
  )?.message;
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
    <AppScreen scrollRef={scrollRef}>
      <AppHeader
        title="Valider le ticket"
        subtitle={
          detail.receipt.aiStatus === "COMPLETED"
            ? `${detail.lines.length} ligne${detail.lines.length > 1 ? "s" : ""} extraite${detail.lines.length > 1 ? "s" : ""}`
            : detail.lines.length
              ? `${detail.lines.length} lignes déjà disponibles`
              : "L’extraction des lignes n’est pas terminée."
        }
      >
        <StatusBadge
          status={
            detail.receipt.processingStatus === "PUBLISHED"
              ? detail.receipt.syncState === "CONFLICT"
                ? "conflict"
                : detail.receipt.syncState === "ERROR"
                  ? "error"
                  : detail.receipt.syncState === "SYNCED"
                    ? "synced"
                    : "pending"
              : detail.receipt.aiStatus === "COMPLETED" && reviewCount > 0
                ? "incomplete"
                : processing.status
          }
        />
      </AppHeader>

      <SecondaryButton label="Retour à Casse" onPress={() => router.back()} />
      <SecondaryButton
        label="Actualiser le ticket"
        disabled={busy}
        onPress={() => void load()}
      />
      <SectionCard
        onLayout={anchor("processing")}
        title={processing.title}
        description={processing.message}
      >
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
        <ReceiptIssueSummary
          published={detail.receipt.processingStatus === "PUBLISHED"}
          issues={summaryIssues}
          disabled={busy}
          onLocate={(issue) => {
            if (
              detail.receipt.processingStatus === "PUBLISHED" ||
              (issue.lineId &&
                !detail.lines.some((d) => d.line.id === issue.lineId))
            )
              scrollRef.current?.scrollToEnd({ animated: true });
            else if (!busy) {
              if (issue.lineId) setActiveLineId(issue.lineId);
              const target = groups.find((g) =>
                g.lines.some((d) => d.line.id === issue.lineId),
              );
              locate(issue, {
                waitForGroupLayout:
                  !!issue.lineId &&
                  !target?.lines.some((d) => d.line.id === activeLineId),
              });
            }
          }}
        />
      ) : null}

      {detail.receipt.duplicateStatus === "POSSIBLE_DUPLICATE" ? (
        <SectionCard
          onLayout={anchor("duplicate")}
          title="Doublon possible"
          description="Les mêmes photos ont déjà été enregistrées pour un ticket. Aucun rapprochement n’est décidé à partir des seuls produits ou de la date."
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
              {detail.duplicateCandidate ? (
                <ReceiptSourcePhotos
                  storeId={detail.receipt.storeId}
                  sourceDocumentId={detail.duplicateCandidate.sourceDocumentId}
                  fallbackUri={detail.duplicateCandidate.localFileUri}
                />
              ) : (
                <Text className="text-sm text-muted">
                  Photos existantes indisponibles sur cet appareil.
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
        <View onLayout={anchor("duplicate")}>
          <InlineAlert
            title="Doublon confirmé"
            message="La nouvelle source reste conservée sur cet appareil et ne sera pas publiée."
          />
        </View>
      ) : null}

      {detail.receipt.processingStatus === "PUBLISHED" ? (
        <InlineAlert
          title="Casse validée"
          message={
            detail.receipt.syncState === "SYNCED"
              ? "Les lignes sont publiées et synchronisées."
              : detail.receipt.syncState === "CONFLICT"
                ? "La publication locale est conservée. Un conflit reste à examiner dans Synchronisation."
                : detail.receipt.syncState === "ERROR"
                  ? "La publication locale est conservée. L’envoi a été refusé ; consultez Synchronisation."
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
            disabled={busy}
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
                  let recalculationPending = true;
                  try {
                    const result =
                      await new LocalAnalyticsRecomputationScheduler(
                        database.sqlite,
                        new SQLiteProductDateRecomputer(database.sqlite),
                      ).process(detail.receipt.storeId);
                    recalculationPending = result.failedJobs > 0;
                  } catch {
                    /* Publication already committed; its durable recalculation job remains queued. */
                  }
                  setMessage(
                    recalculationPending
                      ? "La casse est validée. Le recalcul des indicateurs reste en attente."
                      : "La casse est validée et les indicateurs locaux sont mis à jour.",
                  );
                  void syncNow(detail.receipt.storeId)
                    .then(load)
                    .catch(() =>
                      setMessage(
                        "La casse est validée localement. La synchronisation reste en attente.",
                      ),
                    );
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
        description="Les photos originales restent conservées sur cet appareil."
      >
        <SecondaryButton
          label={
            showPhotos ? "Masquer les photos" : "Voir les photos du ticket"
          }
          expanded={showPhotos}
          onPress={() => setShowPhotos((v) => !v)}
        />
        {showPhotos ? (
          <ReceiptSourcePhotos
            storeId={detail.receipt.storeId}
            sourceDocumentId={detail.receipt.sourceDocumentId}
            fallbackUri={detail.localFileUri}
          />
        ) : null}
      </SectionCard>

      {detail.receipt.processingStatus !== "PUBLISHED" ? (
        <SectionCard
          onLayout={anchor("date")}
          title="Date de casse"
          description={
            detail.receipt.detectedReceiptDate
              ? `Date détectée : ${formatDate(detail.receipt.detectedReceiptDate)}`
              : "Aucune date fiable n’a été détectée. Choisissez la date imprimée sur le ticket."
          }
        >
          {dateDraft !== undefined &&
          detail.receipt.confirmedWasteDate &&
          dateDraft !== detail.receipt.confirmedWasteDate ? (
            <Text className="text-muted">
              Date enregistrée : {formatDate(detail.receipt.confirmedWasteDate)}
            </Text>
          ) : null}
          <DateSelector
            value={date}
            disabled={busy}
            issue={dateIssue}
            onConfirm={(selected) => {
              if (busy) return;
              setDateSaving(true);
              setDate(selected);
              setError(undefined);
              setMessage(undefined);
              void repository
                .confirmWasteDate(
                  detail.receipt.id,
                  selected,
                  detail.receipt.version,
                )
                .then(async () => {
                  setMessage("La date de casse est confirmée.");
                  if (await load()) setDateDraft(undefined);
                })
                .catch(() =>
                  setError(
                    "La date n’a pas pu être enregistrée ou le ticket a changé. Votre choix reste conservé ; réessayez après relecture.",
                  ),
                )
                .finally(() => setDateSaving(false));
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
            loading={dateSaving}
            disabled={
              busy || !date || date === detail.receipt.confirmedWasteDate
            }
            onPress={() => {
              if (busy) return;
              setDateSaving(true);
              setError(undefined);
              setMessage(undefined);
              void repository
                .confirmWasteDate(
                  detail.receipt.id,
                  date,
                  detail.receipt.version,
                )
                .then(async () => {
                  setMessage("La date de casse est confirmée.");
                  if (await load()) setDateDraft(undefined);
                })
                .catch(() =>
                  setError(
                    "La date n’a pas pu être confirmée ou le ticket a changé. Votre choix reste conservé.",
                  ),
                )
                .finally(() => setDateSaving(false));
            }}
          />
        </SectionCard>
      ) : (
        <Text onLayout={anchor("date")} className="text-base text-ink">
          Date de casse : {formatDate(detail.receipt.confirmedWasteDate!)}
        </Text>
      )}

      <SectionCard
        onLayout={anchor("cashierNumber")}
        title="Numéro de caissier"
        description={
          detail.receipt.processingStatus === "PUBLISHED"
            ? "Métadonnée conservée avec le ticket."
            : detail.receipt.detectedCashierNumber
              ? `Numéro proposé par l’IA : ${detail.receipt.detectedCashierNumber}. Vérifiez-le en bas du ticket.`
              : "Non détecté. Vous pouvez le saisir à partir du bas du ticket. Ce champ est facultatif."
        }
      >
        {detail.receipt.processingStatus === "PUBLISHED" ? (
          <Text className="text-base text-ink">
            {savedCashierNumber || "Non renseigné"}
            {detail.receipt.cashierNumberConfirmedAt
              ? " · Confirmé"
              : savedCashierNumber
                ? " · Non confirmé"
                : ""}
          </Text>
        ) : (
          <>
            {cashierDraft !== undefined &&
            cashierDraft.trim() !== savedCashierNumber ? (
              <Text className="text-muted">
                {detail.receipt.cashierNumberConfirmedAt
                  ? "Numéro enregistré"
                  : "Numéro proposé"}{" "}
                : {savedCashierNumber || "Non renseigné"}
              </Text>
            ) : null}
            <TextInput
              value={cashierNumber}
              editable={!busy}
              onChangeText={setCashierNumber}
              placeholder="Ex. 000123"
              maxLength={64}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Numéro de caissier"
              accessibilityHint="Conservez tous les zéros initiaux. Vous pouvez laisser ce champ vide."
              className={`min-h-12 rounded-xl border px-4 text-base text-ink ${validationAttempted && cashierIssue ? "border-critical bg-critical-soft" : "border-line bg-canvas"}`}
            />
            {validationAttempted && cashierIssue ? (
              <Text accessibilityRole="alert" className="text-sm text-critical">
                {cashierIssue}
              </Text>
            ) : null}
            <PrimaryButton
              label="Confirmer le numéro"
              loading={cashierSaving}
              disabled={busy}
              onPress={() => {
                setCashierSaving(true);
                setError(undefined);
                setMessage(undefined);
                void repository
                  .confirmCashierNumber(
                    detail.receipt.id,
                    cashierNumber,
                    new Date().toISOString(),
                    detail.receipt.version,
                  )
                  .then(async () => {
                    setMessage(
                      cashierNumber.trim()
                        ? "Le numéro de caissier est confirmé."
                        : "Le numéro de caissier reste non renseigné.",
                    );
                    if (await load()) setCashierDraft(undefined);
                  })
                  .catch(() =>
                    setError(
                      "Le numéro de caissier n’a pas pu être enregistré. Vérifiez le champ et réessayez.",
                    ),
                  )
                  .finally(() => setCashierSaving(false));
              }}
            />
          </>
        )}
      </SectionCard>

      <View onLayout={linesAnchor} className="gap-4">
        <View className="gap-1">
          <Text className="text-xl font-semibold text-ink">
            Lignes du ticket
          </Text>
          <Text className="text-sm leading-5 text-muted">
            Ouvrez une ligne pour la vérifier. Les répétitions restent
            modifiables séparément ; vos saisies non enregistrées sont
            conservées dans ce ticket.
          </Text>
        </View>
        {detail.receipt.processingStatus === "PUBLISHED"
          ? detail.lines.map((draft) => (
              <View
                key={draft.line.id}
                onLayout={groupAnchor([draft.line.id])}
                className="gap-2"
              >
                <Text className="text-base text-ink">
                  {draft.line.rawLabel} · {draft.line.totalPrice ?? "—"} €
                </Text>
                {draft.line.matchStatus === "MATCHED" &&
                draft.line.validationStatus !== "EXCLUDED" ? (
                  <WasteAliasMemory
                    receiptId={detail.receipt.id}
                    draft={draft}
                    disabled={false}
                    onError={setError}
                  />
                ) : null}
              </View>
            ))
          : groups.map((group) => (
              <LineGroup
                key={group.key}
                onLayout={groupAnchor(group.lines.map((d) => d.line.id))}
                label={group.label}
                activeLineId={activeLineId}
                onOpenLine={setActiveLineId}
                needsReview={group.lines.some(
                  (d) =>
                    d.line.validationStatus === "TO_REVIEW" ||
                    publicationIssues.some((i) => i.lineId === d.line.id),
                )}
                lines={group.lines}
                hasUnsavedChanges={group.lines.some(
                  ({ line }) => !!edits[line.id],
                )}
                receiptId={detail.receipt.id}
                repository={repository}
                onChanged={load}
                onMessage={setMessage}
                onError={setError}
                issues={issues}
                edits={edits}
                onEdit={onEdit}
                onReset={onReset}
                onSaving={onSaving}
                disabled={busy}
              />
            ))}
      </View>

      {(detail.receipt.processingStatus === "PUBLISHED" && headerDirty) ||
      retainedEdits.length ? (
        <ReceiptUnsavedInputs
          edits={retainedEdits}
          date={
            detail.receipt.processingStatus === "PUBLISHED"
              ? dateDraft
              : undefined
          }
          cashier={
            detail.receipt.processingStatus === "PUBLISHED"
              ? cashierDraft
              : undefined
          }
          onAbandon={() =>
            confirmAbandon(() => {
              setEdits((v) => {
                const next = { ...v };
                for (const [id] of retainedEdits) delete next[id];
                return next;
              });
              if (detail.receipt.processingStatus === "PUBLISHED") {
                setDateDraft(undefined);
                setCashierDraft(undefined);
              }
            })
          }
        />
      ) : null}
      <SecondaryButton label="Retour à Casse" onPress={() => router.back()} />
    </AppScreen>
  );
}

function LineGroup({
  onLayout,
  activeLineId,
  onOpenLine,
  hasUnsavedChanges,
  needsReview,
  issues,
  edits,
  onEdit,
  onReset,
  onSaving,
  disabled,
  label,
  lines,
  receiptId,
  repository,
  onChanged,
  onMessage,
  onError,
}: {
  onLayout(e: LayoutChangeEvent): void;
  activeLineId?: string;
  onOpenLine: Dispatch<SetStateAction<string | undefined>>;
  label: string;
  hasUnsavedChanges: boolean;
  needsReview: boolean;
  lines: LocalWasteLineDraft[];
  receiptId: string;
  repository: WasteReceiptRepository;
  onChanged(): Promise<boolean>;
  onMessage(value: string | undefined): void;
  onError(value: string | undefined): void;
  issues: WastePublicationIssue[];
  edits: ReceiptLineEdits;
  onEdit(line: WasteLine, patch: Partial<ReceiptLineValues>): void;
  onReset(id: string): void;
  onSaving(id: string, saving: boolean): void;
  disabled: boolean;
}) {
  const issueCount = issues.filter((i) =>
    lines.some((d) => d.line.id === i.lineId),
  ).length;
  return (
    <ReceiptReviewGroup
      onLayout={onLayout}
      label={label}
      lines={lines}
      activeLineId={activeLineId}
      onOpenLine={onOpenLine}
      hasUnsavedChanges={hasUnsavedChanges}
      needsReview={needsReview}
      issueCount={issueCount}
      disabled={disabled}
      renderLine={(draft) => (
        <LineEditor
          key={draft.line.id}
          draft={draft}
          receiptId={receiptId}
          repository={repository}
          onChanged={onChanged}
          onMessage={onMessage}
          onError={onError}
          issues={issues}
          edits={edits}
          onEdit={onEdit}
          onReset={onReset}
          onSaving={onSaving}
          disabled={disabled}
        />
      )}
    />
  );
}

function LineEditor({
  issues,
  edits,
  onEdit,
  onReset,
  onSaving,
  disabled,
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
  onChanged(): Promise<boolean>;
  onMessage(value: string | undefined): void;
  onError(value: string | undefined): void;
  issues: WastePublicationIssue[];
  edits: ReceiptLineEdits;
  onEdit(line: WasteLine, patch: Partial<ReceiptLineValues>): void;
  onReset(id: string): void;
  onSaving(id: string, saving: boolean): void;
  disabled: boolean;
}) {
  const router = useRouter();
  const [localIssues, setLocalIssues] = useState<WastePublicationIssue[]>([]);
  const fieldIssue = (field: WastePublicationField) =>
    [
      ...localIssues,
      ...issues.filter((issue) => issue.lineId === draft.line.id),
    ].find((issue) => issue.field === field)?.message;
  const edit = edits[draft.line.id];
  const values = edit?.values ?? receiptLineValues(draft.line);
  const { rawLabel, weight, quantity, quantityUnit, unitPrice, totalPrice } =
    values;
  const setRawLabel = (v: string) => onEdit(draft.line, { rawLabel: v }),
    setWeight = (v: string) => onEdit(draft.line, { weight: v }),
    setQuantity = (v: string) => onEdit(draft.line, { quantity: v }),
    setQuantityUnit = (v: ReceiptLineValues["quantityUnit"]) =>
      onEdit(draft.line, { quantityUnit: v }),
    setUnitPrice = (v: string) => onEdit(draft.line, { unitPrice: v }),
    setTotalPrice = (v: string) => onEdit(draft.line, { totalPrice: v });
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  async function saveValues() {
    if (disabled || savingRef.current) return;
    const invalid: WastePublicationIssue[] = [];
    if (!rawLabel.trim())
      invalid.push({ field: "rawLabel", message: "Renseignez le libellé." });
    for (const [field, value] of [
      ["weight", weight],
      ["quantity", quantity],
      ["unitPrice", unitPrice],
      ["totalPrice", totalPrice],
    ] as const)
      if (
        value.trim() &&
        !/^\d+(?:\.\d+)?$/.test(value.trim().replace(",", "."))
      )
        invalid.push({
          field,
          message: "Utilisez un nombre positif ou nul, par exemple 1,25.",
        });
    setLocalIssues(invalid);
    if (invalid.length) return;
    savingRef.current = true;
    setSaving(true);
    onSaving(draft.line.id, true);
    onError(undefined);
    onMessage(undefined);
    try {
      await repository.updateLineValues(
        receiptId,
        draft.line.id,
        {
          rawLabel,
          quantity: emptyToNull(quantity),
          quantityUnit,
          weight: emptyToNull(weight),
          unitPrice: emptyToNull(unitPrice),
          totalPrice: emptyToNull(totalPrice),
        },
        edit?.baseline.version ?? draft.line.version,
      );
      if (await onChanged()) onReset(draft.line.id);
      onMessage(`Ligne ${draft.line.sourceLineIndex + 1} enregistrée.`);
    } catch (e) {
      onError(
        e instanceof Error && e.message === "WASTE_RECEIPT_LINE_CHANGED"
          ? "Cette ligne a changé. Votre saisie reste conservée ; relisez la ligne avant de la remplacer."
          : "La ligne n’a pas pu être enregistrée. Votre saisie reste conservée ; vérifiez les champs et le statut du ticket.",
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
      onSaving(draft.line.id, false);
    }
  }
  function abandon() {
    confirmAbandon(() => {
      onReset(draft.line.id);
      setLocalIssues([]);
    });
  }

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

      {edit && edit.baseline.version !== draft.line.version ? (
        <InlineAlert
          title="Ligne modifiée depuis l’ouverture"
          message="Votre saisie est conservée. Comparez-la aux données enregistrées ci-dessous avant de l’abandonner ou de la reprendre."
        />
      ) : null}
      {edit && edit.baseline.version !== draft.line.version ? (
        <ReceiptLinePreview draft={draft} />
      ) : null}
      <Field
        disabled={disabled || saving}
        label="Libellé"
        value={rawLabel}
        onChangeText={setRawLabel}
        issue={fieldIssue("rawLabel")}
      />
      <Field
        disabled={disabled || saving}
        label="Quantité (pièces ou unités conditionnées)"
        issue={fieldIssue("quantity")}
        value={quantity}
        onChangeText={setQuantity}
        decimal
      />
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Unité de la quantité relevée"
        className={`flex-row flex-wrap gap-2 rounded-xl ${fieldIssue("quantityUnit") ? "border border-critical bg-critical-soft p-1" : ""}`}
      >
        {(["KG", "PIECE", "PACK", "UNKNOWN"] as const).map((unit) => (
          <Pressable
            key={unit}
            accessibilityRole="radio"
            disabled={disabled || saving}
            aria-checked={quantityUnit === unit}
            accessibilityState={{
              checked: quantityUnit === unit,
              disabled: disabled || saving,
            }}
            onPress={() => setQuantityUnit(unit)}
            className="min-h-12 justify-center rounded-xl border border-line px-2"
          >
            <Text className="text-ink">
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
            disabled={disabled || saving}
            label="Poids (kg)"
            issue={fieldIssue("weight")}
            value={weight}
            onChangeText={setWeight}
            decimal
          />
        </View>
        <View className="flex-1">
          <Field
            disabled={disabled || saving}
            label="Prix unitaire (€)"
            issue={fieldIssue("unitPrice")}
            value={unitPrice}
            onChangeText={setUnitPrice}
            decimal
          />
        </View>
      </View>
      <Field
        disabled={disabled || saving}
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
            disabled={disabled || !!edit}
            onPress={() => {
              void repository
                .selectProductCandidate(
                  receiptId,
                  draft.line.id,
                  draft.line.matchedProductId!,
                  draft.line.version,
                )
                .then(onChanged)
                .catch((reason) =>
                  onError(
                    receiptEditError(
                      reason,
                      "Ce produit n’est plus disponible dans le référentiel.",
                    ),
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
            disabled={disabled || !!edit}
            onPress={() => {
              onError(undefined);
              onMessage(undefined);
              void repository
                .selectProductCandidate(
                  receiptId,
                  draft.line.id,
                  candidate.productId,
                  draft.line.version,
                )
                .then(async () => {
                  onMessage(`Produit associé : ${candidate.label}.`);
                  await onChanged();
                })
                .catch((reason) =>
                  onError(
                    receiptEditError(
                      reason,
                      "Ce produit n’est plus disponible ou la proposition doit être revue.",
                    ),
                  ),
                );
            }}
            className={`min-h-12 justify-center rounded-xl border px-4 py-3 ${
              draft.line.matchedProductId === candidate.productId
                ? "border-forest bg-positive-soft"
                : "border-line bg-surface"
            }`}
          >
            <Text className="font-semibold text-ink">{candidate.label}</Text>
            <Text className="text-sm text-muted">
              {natureLabel(candidate.nature)} ·{" "}
              {candidate.salesUnit === "KG"
                ? "Vendu au kg"
                : candidate.salesUnit === "PIECE"
                  ? "Vendu à la pièce"
                  : candidate.salesUnit === "PACK"
                    ? "Unité conditionnée"
                    : "Unité non précisée"}
            </Text>
          </Pressable>
        ))}
        <SecondaryButton
          label="Chercher dans tout le catalogue"
          disabled={disabled || !!edit}
          onPress={() =>
            router.push({
              pathname: "/waste-receipt-product",
              params: { receiptId, lineId: draft.line.id },
            })
          }
        />
        {edit ? (
          <Text className="text-sm text-muted">
            Enregistrez ou abandonnez la saisie de cette ligne avant de changer
            de produit.
          </Text>
        ) : null}
      </View>

      {draft.line.matchStatus === "MATCHED" &&
      draft.line.validationStatus !== "EXCLUDED" ? (
        <WasteAliasMemory
          receiptId={receiptId}
          draft={draft}
          disabled={disabled || rawLabel !== draft.line.rawLabel}
          onError={onError}
        />
      ) : null}

      {edit ? (
        <>
          <Text className="text-sm text-warning">
            Saisie non enregistrée. Enregistrez-la avant de changer le produit
            ou le statut.
          </Text>
          <SecondaryButton
            label="Abandonner la saisie de cette ligne…"
            disabled={disabled || saving}
            onPress={abandon}
          />
        </>
      ) : null}
      <SecondaryButton
        disabled={disabled || !!edit}
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
              draft.line.version,
            )
            .then(onChanged)
            .catch((reason) =>
              onError(
                receiptEditError(
                  reason,
                  "Le choix n’a pas pu être enregistré. Votre saisie reste conservée.",
                ),
              ),
            );
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
        disabled={
          disabled || !edit || edit.baseline.version !== draft.line.version
        }
        loading={saving}
        onPress={() => void saveValues()}
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
  disabled = false,
}: {
  disabled?: boolean;
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
        editable={!disabled}
        onChangeText={onChangeText}
        keyboardType={decimal ? "decimal-pad" : "default"}
        accessibilityLabel={label}
        accessibilityHint={issue}
        className={`min-h-12 rounded-xl border px-3 text-base text-ink ${issue ? "border-critical bg-critical-soft" : "border-line bg-surface"}`}
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

function WasteAliasMemory({
  receiptId,
  draft,
  disabled,
  onError,
}: {
  receiptId: string;
  draft: LocalWasteLineDraft;
  disabled: boolean;
  onError(value: string | undefined): void;
}) {
  const database = useLocalDatabase();
  const repository = useMemo(
    () => new ProductMasterRepository(database.sqlite),
    [database.sqlite],
  );
  const [alias, setAlias] = useState<ProductAlias | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string>();
  useEffect(() => {
    let active = true;
    setLoaded(false);
    void repository
      .listAliasesByStore(draft.line.storeId)
      .then((records) => {
        if (!active) return;
        setAlias(
          records.find(
            ({ entity }) =>
              entity.productId === draft.line.matchedProductId &&
              entity.normalizedAlias ===
                normalizeProductLabel(draft.line.rawLabel) &&
              entity.status === "VALIDATED",
          )?.entity ?? null,
        );
        setLoaded(true);
      })
      .catch(() => {
        if (active) onError("Les libellés mémorisés ne peuvent pas être lus.");
      });
    return () => {
      active = false;
    };
  }, [
    repository,
    draft.line.storeId,
    draft.line.rawLabel,
    draft.line.matchedProductId,
    draft,
    onError,
  ]);
  async function remember() {
    setBusy(true);
    onError(undefined);
    try {
      const saved = await repository.rememberWasteReceiptAlias(
        receiptId,
        draft.line.id,
        randomUUID(),
        { commandId: randomUUID(), deviceId: database.deviceId },
      );
      setAlias(saved);
      setNotice(
        "Libellé mémorisé sur cet appareil. Synchronisation avec le magasin en attente.",
      );
    } catch (error) {
      onError(
        error instanceof Error && error.message === "WASTE_ALIAS_CONFLICT"
          ? "Ce libellé est déjà associé à un autre produit ou a été rejeté. Aucune association n’a été remplacée."
          : "Ce libellé ne peut pas être mémorisé. Enregistrez la ligne et confirmez un produit actif.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function forget() {
    if (!alias) return;
    setBusy(true);
    onError(undefined);
    try {
      const record = await repository.getAlias(alias.id);
      if (!record) {
        setAlias(null);
        return;
      }
      if (record.entity.source !== "WASTE_RECEIPT") return;
      await repository.delete(
        "product_alias",
        alias.id,
        alias.storeId,
        new Date().toISOString(),
        {
          commandId: randomUUID(),
          deviceId: database.deviceId,
          expectedRemoteVersion: record.remoteVersion,
        },
      );
      setAlias(null);
      setNotice(
        "Mémorisation annulée. Les tickets déjà validés restent inchangés.",
      );
    } catch {
      onError("La mémorisation n’a pas pu être annulée.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <View className="gap-2">
      <Text className="text-sm text-muted">
        Réutiliser « {draft.line.rawLabel} » pour {draft.matchedProductLabel}{" "}
        lors des prochains imports du magasin.
      </Text>
      {alias ? (
        <>
          <Text className="text-sm font-semibold text-forest">
            Libellé mémorisé
          </Text>
          {alias.source === "WASTE_RECEIPT" ? (
            <SecondaryButton
              label="Annuler la mémorisation"
              disabled={busy || !loaded}
              onPress={() => void forget()}
            />
          ) : null}
        </>
      ) : (
        <SecondaryButton
          label={busy ? "Mémorisation…" : "Mémoriser ce libellé"}
          disabled={disabled || busy || !loaded}
          onPress={() => void remember()}
        />
      )}
      {disabled ? (
        <Text className="text-sm text-muted">
          Enregistrez le libellé modifié avant de le mémoriser.
        </Text>
      ) : null}
      {notice ? (
        <Text accessibilityRole="alert" className="text-sm text-muted">
          {notice}
        </Text>
      ) : null}
    </View>
  );
}

function confirmAbandon(action: () => void) {
  const message =
    "Votre saisie non enregistrée sera abandonnée. Les données enregistrées du ticket restent conservées.";
  if (Platform.OS === "web") {
    if (window.confirm(message)) action();
    return;
  }
  Alert.alert("Abandonner la saisie ?", message, [
    { text: "Continuer la saisie", style: "cancel" },
    { text: "Abandonner", style: "destructive", onPress: action },
  ]);
}

function ReceiptUnsavedInputs({
  edits,
  date,
  cashier,
  onAbandon,
}: {
  edits: readonly [string, ReceiptLineEdits[string]][];
  date?: string;
  cashier?: string;
  onAbandon(): void;
}) {
  return (
    <SectionCard
      title="Saisie non enregistrée conservée"
      description="Le ticket ou certaines lignes ne sont plus modifiables. Ces saisies n’ont pas remplacé les données enregistrées. Relisez-les ou copiez-les avant de les abandonner."
    >
      {date !== undefined ? (
        <Text selectable className="text-ink">
          Date choisie : {date || "Vide"}
        </Text>
      ) : null}
      {cashier !== undefined ? (
        <Text selectable className="text-ink">
          Caissier saisi : {cashier || "Vide"}
        </Text>
      ) : null}
      {edits.map(([id, e]) => (
        <View key={id} className="gap-1">
          <Text selectable className="font-semibold text-ink">
            {e.values.rawLabel}
          </Text>
          <Text selectable className="text-muted">
            Poids saisi : {e.values.weight || "Vide"} kg · Quantité saisie :{" "}
            {e.values.quantity || "Vide"} (
            {e.values.quantityUnit === "KG"
              ? "kg"
              : e.values.quantityUnit === "PIECE"
                ? "pièces"
                : e.values.quantityUnit === "PACK"
                  ? "unités conditionnées"
                  : "unité à préciser"}
            )
          </Text>
          <Text selectable className="text-muted">
            Prix unitaire saisi : {e.values.unitPrice || "Vide"} · Montant saisi
            : {e.values.totalPrice || "Vide"}
          </Text>
        </View>
      ))}
      <SecondaryButton
        label="Abandonner les saisies concernées…"
        onPress={onAbandon}
      />
    </SectionCard>
  );
}

function receiptEditError(error: unknown, fallback: string) {
  if (error instanceof Error) {
    if (
      error.message === "WASTE_RECEIPT_LINE_CHANGED" ||
      error.message === "WASTE_RECEIPT_CHANGED"
    )
      return "Le ticket a changé depuis votre lecture. Actualisez-le avant de confirmer cette correction ; vos saisies sont conservées.";
    if (error.message === "WASTE_RECEIPT_READ_ONLY")
      return "Le ticket n’est plus modifiable. Actualisez-le pour consulter son état ; vos saisies non enregistrées restent conservées.";
  }
  return fallback;
}
