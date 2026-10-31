import { colors } from "../design/tokens";
import { DocumentArchiveRepository } from "./document-archive-repository";
import {
  DocumentArchiveControl,
  ArchiveViewFilter,
  type DocumentArchiveAccess,
} from "./document-archive-control";
import type { DocumentArchive } from "@fl-copilot/domain";
import { captureLocalOperationFailure } from "../observability/sentry";
import { localOperationFailureMessage } from "../observability/local-operation-failure";
import {
  batchPublicationLabel as publicationStatus,
  filterBatchItems,
  type BatchItemFilter,
} from "./mercalys-batch-presentation";
import { MercalysBatchPublication } from "./mercalys-batch-publication";
import { MercalysArchiveRepository } from "./mercalys-archive-repository";
import {
  retainMercalysZip,
  extractRetainedMercalysZip,
  nativeMercalysZipStorage,
} from "./mercalys-zip-capture";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  randomUUID,
  CryptoDigestAlgorithm,
  digest,
  digestStringAsync,
} from "expo-crypto";
import { readRetainedMercalysBytes } from "./read-retained-mercalys";
import type {
  MercalysBatchInput,
  MercalysBatchItem,
  MercalysBatchPublicationPlan,
} from "@fl-copilot/domain";
import {
  AppHeader,
  AppScreen,
  SectionCard,
  SecondaryButton,
  InlineAlert,
} from "../components/ui";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import { ProductMasterRepository } from "../products/product-master-repository";
import { MercalysImportPublicationRepository } from "./mercalys-import-publication";
import { MercalysBatchRepository } from "./mercalys-batch-repository";
import { MercalysBatchPreparation } from "./mercalys-batch-preparation";
import {
  captureMercalysBatch,
  nativeMercalysBatchStorage,
  type MercalysSelectedFile,
} from "./mercalys-batch-capture";
export function MercalysBatchPanel({
  db,
  storeId,
  ownerId,
  conversationId,
  onDiscuss,
  onBusyChange,
  onPublished,
  pick,
  pickZip,
  renderReview,
  disabled = false,
  archiveContext,
}: {
  archiveContext?: DocumentArchiveAccess;
  db: OutboxDatabase & AtomicMutationDatabase;
  storeId: string;
  ownerId: string;
  conversationId?: string;
  onDiscuss?(batchId: string): Promise<void>;
  onBusyChange?(busy: boolean): void;
  onPublished?(): Promise<void>;
  pick(): Promise<MercalysSelectedFile[] | undefined>;
  pickZip?(): Promise<MercalysSelectedFile | undefined>;
  renderReview(
    asset: MercalysSelectedFile & { expectedChecksum: string },
    close: () => void,
    onBusyChange: (busy: boolean) => void,
    onChanged: () => void,
  ): ReactNode;
  disabled?: boolean;
}) {
  const repo = useMemo(
    () => new MercalysBatchRepository(db, { storeId, ownerId, conversationId }),
    [db, storeId, ownerId, conversationId],
  );
  const currentRepo = useRef(repo);
  currentRepo.current = repo;
  const archiveRepo = useMemo(
    () =>
      new MercalysArchiveRepository(db, { storeId, ownerId, conversationId }),
    [db, storeId, ownerId, conversationId],
  );
  const archiveEnabled = archiveContext !== undefined;
  const visibilityRepo = useMemo(
    () =>
      archiveEnabled
        ? new DocumentArchiveRepository(db, { storeId, ownerId })
        : null,
    [db, storeId, ownerId, archiveEnabled],
  );
  const [visibility, setVisibility] = useState<DocumentArchive[]>([]);
  const [visibilityReady, setVisibilityReady] = useState(!archiveContext);
  const [visibilityError, setVisibilityError] = useState(false);
  const [historyArchived, setHistoryArchived] = useState(false),
    [itemsArchived, setItemsArchived] = useState(false);
  const historyArchivedRef = useRef(historyArchived),
    itemsArchivedRef = useRef(itemsArchived);
  historyArchivedRef.current = historyArchived;
  itemsArchivedRef.current = itemsArchived;
  const visibilityCurrent = useRef(visibilityRepo);
  visibilityCurrent.current = visibilityRepo;
  const visibilityById = useMemo(
    () => new Map(visibility.map((a) => [a.id, a])),
    [visibility],
  );
  const isArchived = useCallback(
    (id: string, kind: DocumentArchive["targetKind"]) => {
      const entry = visibilityById.get(id);
      return entry?.targetKind === kind && entry.archived;
    },
    [visibilityById],
  );
  const readVisibility = useCallback(async () => {
    if (!visibilityRepo) return;
    try {
      const rows = await visibilityRepo.list();
      if (alive.current && visibilityCurrent.current === visibilityRepo) {
        setVisibility(rows);
        setVisibilityReady(true);
        setVisibilityError(false);
      }
    } catch {
      if (alive.current && visibilityCurrent.current === visibilityRepo) {
        setVisibilityReady(false);
        setVisibilityError(true);
      }
    }
  }, [visibilityRepo]);
  const [archives, setArchives] = useState<
    Awaited<ReturnType<MercalysArchiveRepository["recent"]>>["archives"]
  >([]);
  const [moreArchives, setMoreArchives] = useState(false);
  const service = useMemo(
    () =>
      new MercalysBatchPreparation(repo, {
        reportFailure: (reason) =>
          captureLocalOperationFailure(reason, "mercalys-prepare"),
        read: readRetainedMercalysBytes,
        checksum: async (bytes) => {
          const hash = await digest(CryptoDigestAlgorithm.SHA256, bytes);
          return `sha256:${Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("")}`;
        },
        catalog: async () => {
          const r = new ProductMasterRepository(db);
          const [products, identifiers, aliases] = await Promise.all([
            r.listProducts(storeId),
            r.listIdentifiersByStore(storeId),
            r.listAliasesByStore(storeId),
          ]);
          return {
            products: products.map((r) => r.entity),
            identifiers: identifiers.map((r) => r.entity),
            aliases: aliases.map((r) => r.entity),
          };
        },
        publication: new MercalysImportPublicationRepository(db, randomUUID),
      }),
    [db, repo, storeId],
  );
  const publisher = useMemo(
    () =>
      new MercalysBatchPublication(
        repo,
        service,
        new MercalysImportPublicationRepository(db, randomUUID),
        async (text) =>
          `sha256:${await digestStringAsync(CryptoDigestAlgorithm.SHA256, text)}`,
        (reason) => captureLocalOperationFailure(reason, "mercalys-publish"),
      ),
    [repo, service, db],
  );
  const [historyQuery, setHistoryQuery] = useState("");
  const [reviewAsset, setReviewAsset] = useState<
    MercalysSelectedFile & { expectedChecksum: string }
  >();
  const [reviewBusy, setReviewBusy] = useState(false);
  const reviewChanged = useRef(false);
  const reviewDone = useRef<(() => void) | undefined>(undefined);
  function finishReview() {
    reviewDone.current?.();
    reviewDone.current = undefined;
  }
  function closeReview() {
    if (reviewBusy) return;
    setReviewAsset(undefined);
    if (Platform.OS !== "ios") finishReview();
  }
  const [query, setQuery] = useState("");
  const [itemFilter, setItemFilter] = useState<BatchItemFilter>("ALL");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [publicationPlan, setPublicationPlan] =
    useState<MercalysBatchPublicationPlan>();
  const [publicationReport, setPublicationReport] =
    useState<Awaited<ReturnType<MercalysBatchPublication["confirm"]>>>();
  const [batches, setBatches] = useState<MercalysBatchInput[]>([]),
    [moreBatches, setMoreBatches] = useState(false),
    [active, setActive] = useState<string>(),
    [items, setItems] = useState<MercalysBatchItem[]>([]),
    [more, setMore] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [progress, setProgress] = useState<string>();
  const [publications, setPublications] = useState<
    Awaited<ReturnType<MercalysBatchRepository["publications"]>>
  >([]);
  const activeRef = useRef<string | undefined>(undefined);
  const alive = useRef(true),
    locked = useRef(false),
    abort = useRef<AbortController | undefined>(undefined);
  async function loadRecent(
    older = false,
    visibilityMode = historyArchivedRef.current,
  ) {
    const last = older ? batches.at(-1) : undefined;
    const page = await repo.recent(
      last ? { createdAt: last.createdAt, id: last.id } : undefined,
      archiveContext ? visibilityMode : undefined,
    );
    if (
      alive.current &&
      currentRepo.current === repo &&
      historyArchivedRef.current === visibilityMode
    ) {
      setBatches((old) => (older ? [...old, ...page.batches] : page.batches));
      setMoreBatches(page.hasMore);
    }
  }
  async function loadArchives(
    older = false,
    visibilityMode = historyArchivedRef.current,
  ) {
    const last = older ? archives.at(-1) : undefined;
    const page = await archiveRepo.recent(
      last ? { id: last.id, createdAt: last.createdAt } : undefined,
      archiveContext ? visibilityMode : undefined,
    );
    if (
      alive.current &&
      currentRepo.current === repo &&
      historyArchivedRef.current === visibilityMode
    ) {
      setArchives((old) =>
        older ? [...old, ...page.archives] : page.archives,
      );
      setMoreArchives(page.hasMore);
    }
  }
  async function automaticallyPublish(batchId: string, signal: AbortSignal) {
    if (alive.current) setProgress("Publication des fichiers sans ambiguïté…");
    const report = await publisher.publishUnambiguous(batchId, signal);
    await load(batchId);
    if (alive.current) setPublicationReport(report);
    if (report.some((r) => r.status === "PUBLISHED")) await onPublished?.();
  }
  async function processArchive(id: string, signal: AbortSignal) {
    if (alive.current) setProgress("Lecture de l’archive en cours…");
    const result = await extractRetainedMercalysZip(
      id,
      archiveRepo,
      repo,
      nativeMercalysZipStorage,
      signal,
    );
    await loadArchives();
    await loadRecent();
    if (result.outcome.status === "PROCESSED" && result.outcome.retainedCount) {
      await load(result.batchId);
      if (alive.current) setProgress("Vérification des fichiers extraits…");
      await service.preparePending(result.batchId, signal);
      await automaticallyPublish(result.batchId, signal);
    }
  }
  async function load(
    batchId: string,
    older = false,
    visibilityMode = activeRef.current === batchId
      ? itemsArchivedRef.current
      : false,
  ) {
    const page = await repo.page(
      batchId,
      older ? (items.at(-1)?.position ?? -1) : -1,
      20,
      archiveContext ? visibilityMode : undefined,
    );
    const committed = await repo.publications(batchId);
    if (alive.current) {
      if (activeRef.current !== batchId) {
        setQuery("");
        setItemFilter("ALL");
        itemsArchivedRef.current = false;
        setItemsArchived(false);
        setToolsOpen(false);
      }
      setPublications(committed);
      setPublicationPlan(undefined);
      setPublicationReport(undefined);
      setActive(batchId);
      activeRef.current = batchId;
      setItems((old) => (older ? [...old, ...page.items] : page.items));
      setMore(page.hasMore);
    }
  }
  useEffect(() => {
    alive.current = true;
    const mode = historyArchivedRef.current;
    void Promise.all([
      archiveRepo.recent(undefined, archiveEnabled ? mode : undefined),
      repo.recent(undefined, archiveEnabled ? mode : undefined),
    ])
      .then(([archivePage, batchPage]) => {
        if (
          alive.current &&
          currentRepo.current === repo &&
          historyArchivedRef.current === mode
        ) {
          setArchives(archivePage.archives);
          setMoreArchives(archivePage.hasMore);
          setBatches(batchPage.batches);
          setMoreBatches(batchPage.hasMore);
        }
      })
      .catch(() => {
        if (alive.current)
          setError("Les imports conservés ne peuvent pas être ouverts.");
      });
    return () => {
      alive.current = false;
      abort.current?.abort();
      reviewDone.current?.();
    };
  }, [repo, archiveRepo, archiveEnabled]);
  useEffect(() => {
    void readVisibility();
  }, [readVisibility, archiveContext?.revision]);
  function control(
    id: string,
    kind: DocumentArchive["targetKind"],
    name: string,
  ) {
    return visibilityRepo && archiveContext ? (
      <DocumentArchiveControl
        repository={visibilityRepo}
        access={archiveContext}
        id={id}
        targetKind={kind}
        name={name}
        archived={isArchived(id, kind)}
        disabled={busy || disabled || !visibilityReady}
        onChanged={readVisibility}
      />
    ) : null;
  }
  async function run(work: (signal: AbortSignal) => Promise<void>) {
    if (locked.current || disabled) return;
    locked.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError(undefined);
    const a = new AbortController();
    abort.current = a;
    try {
      await work(a.signal);
    } catch (reason) {
      if (alive.current && !a.signal.aborted)
        setError(
          reason instanceof Error &&
            reason.message === "MERCALYS_BATCH_POST_PUBLICATION_PENDING"
            ? "Les lignes sont publiées. Le recalcul ou la synchronisation reste à reprendre ; les fichiers ne doivent pas être publiés de nouveau."
            : reason instanceof Error &&
                reason.message === "COPILOT_DRAFT_TOO_LONG"
              ? "Votre brouillon est trop long pour ajouter la question d’analyse. Revenez au chat et raccourcissez-le ; le lot reste conservé."
              : reason instanceof Error && reason.message.includes("LIMIT")
                ? "Le lot accepte au maximum 100 fichiers, 20 Mio par fichier et 100 Mio au total."
                : "L’opération s’est interrompue. Les originaux conservés et les résultats déjà enregistrés restent disponibles ; reprenez le lot.",
        );
    } finally {
      if (alive.current && a.signal.aborted)
        await (async () => {
          await loadRecent();
          await loadArchives();
          if (activeRef.current) await load(activeRef.current);
        })().catch(() =>
          setError(
            "Les fichiers conservés seront retrouvés à la réouverture de l’écran.",
          ),
        );
      locked.current = false;
      if (abort.current === a) abort.current = undefined;
      if (alive.current) {
        setBusy(false);
        onBusyChange?.(false);
        setProgress(undefined);
      }
    }
  }
  const visibleItems = useMemo(
    () =>
      filterBatchItems(items, publications, query, itemFilter).filter(
        (item) =>
          !archiveEnabled ||
          isArchived(item.id, "MERCALYS_ITEM") === itemsArchived,
      ),
    [
      items,
      publications,
      query,
      itemFilter,
      isArchived,
      itemsArchived,
      archiveEnabled,
    ],
  );
  const activeBatch = batches.find((batch) => batch.id === active);
  const activeArchive = archives.find((archive) => archive.batchId === active);
  const batchTitle =
    activeArchive?.filename ??
    (activeBatch?.files.length === 1
      ? activeBatch.files[0]!.filename
      : "Fichiers du lot");
  const importedAt = activeBatch?.createdAt ?? activeArchive?.createdAt;
  const fileCount =
    activeBatch?.files.length ??
    (activeArchive?.outcome.status === "PROCESSED"
      ? activeArchive.outcome.retainedCount
      : undefined);
  const historyTerm = historyQuery.trim().toLocaleLowerCase("fr-FR");
  const visibleArchives = archives.filter(
    (a) =>
      (!archiveEnabled ||
        isArchived(a.batchId, "MERCALYS_BATCH") === historyArchived) &&
      `${a.filename} ${new Date(a.createdAt).toLocaleString("fr-FR")}`
        .toLocaleLowerCase("fr-FR")
        .includes(historyTerm),
  );
  const archiveIds = new Set(archives.map((a) => a.id));
  const visibleBatches = batches.filter(
    (b) =>
      (!archiveEnabled ||
        isArchived(b.id, "MERCALYS_BATCH") === historyArchived) &&
      (!b.archiveId || !archiveIds.has(b.archiveId)) &&
      `${b.files.map((f) => f.filename).join(" ")} ${new Date(b.createdAt).toLocaleString("fr-FR")}`
        .toLocaleLowerCase("fr-FR")
        .includes(historyTerm),
  );
  return (
    <>
      <SectionCard title="Ajouter des exports">
        <Text className="text-sm text-muted">
          Ventes ou casse, XLSX ou ZIP. Les fichiers prêts sont publiés
          automatiquement ; les autres restent à examiner.
        </Text>
        <SecondaryButton
          label="Choisir des fichiers XLSX"
          disabled={busy || disabled}
          loading={busy}
          onPress={() =>
            void run(async (signal) => {
              const files = await pick();
              if (!files?.length || signal.aborted) return;
              const captured = await captureMercalysBatch(
                { files, storeId, ownerId, conversationId },
                repo,
                nativeMercalysBatchStorage,
                randomUUID,
                signal,
                (n, total) => {
                  if (alive.current)
                    setProgress(`${n} / ${total} copies traitées`);
                },
              );
              await loadRecent();
              if (captured.batchId) {
                await load(captured.batchId);
                if (alive.current) setProgress("Vérification du lot en cours…");
                await service.preparePending(captured.batchId, signal);
                await automaticallyPublish(captured.batchId, signal);
              }
              if (captured.failures.length && alive.current)
                setError(
                  `Ces fichiers n’ont pas pu être copiés : ${captured.failures.join(", ")}. Sélectionnez-les de nouveau. Les autres sont conservés.`,
                );
            })
          }
        />
        {pickZip ? (
          <SecondaryButton
            label="Choisir une archive ZIP"
            disabled={busy || disabled}
            onPress={() =>
              void run(async (signal) => {
                const asset = await pickZip();
                if (!asset || signal.aborted) return;
                const id = await retainMercalysZip(
                  asset,
                  archiveRepo,
                  nativeMercalysZipStorage,
                  randomUUID,
                  signal,
                );
                await loadArchives();
                await processArchive(id, signal);
              })
            }
          />
        ) : null}
        {!active && busy ? (
          <Text accessibilityLiveRegion="polite" className="text-sm text-muted">
            {progress ?? "Préparation du lot…"}
          </Text>
        ) : null}
        {!active && error ? (
          <InlineAlert title="Import à reprendre" message={error} />
        ) : null}
      </SectionCard>
      <SectionCard title="Imports récents">
        {archiveContext ? (
          <>
            <ArchiveViewFilter
              label="Imports"
              archived={historyArchived}
              disabled={busy || disabled}
              onChange={(value) => {
                if (locked.current || disabled) return;
                historyArchivedRef.current = value;
                setHistoryArchived(value);
                void run(async () => {
                  await Promise.all([
                    loadRecent(false, value),
                    loadArchives(false, value),
                  ]);
                });
              }}
            />
            <Text className="text-sm text-muted">
              Le rangement est personnel. Archiver conserve les fichiers, les
              chiffres publiés et les traitements demandés.
            </Text>
            {visibilityError ? (
              <>
                <InlineAlert
                  title="Rangement indisponible"
                  message="Les fichiers restent consultables. Relisez le rangement avant de le modifier."
                />
                <SecondaryButton
                  label="Relire le rangement"
                  onPress={() => void readVisibility()}
                />
              </>
            ) : null}
          </>
        ) : null}
        <TextInput
          accessibilityLabel="Rechercher un import par nom ou date"
          placeholder="Nom du ZIP, du fichier ou date d’import"
          placeholderTextColor={colors.muted}
          value={historyQuery}
          onChangeText={setHistoryQuery}
          maxLength={200}
          className="min-h-12 rounded-xl border border-line bg-surface px-4 py-3 text-base text-ink"
        />
        {visibleArchives.map((a) => (
          <View key={a.id} className="gap-2">
            <Pressable
              key={a.id}
              accessibilityRole="button"
              accessibilityLabel={`Ouvrir ${a.filename}, importé le ${new Date(a.createdAt).toLocaleString("fr-FR")}`}
              disabled={busy || disabled}
              onPress={() =>
                void run(async (signal) => {
                  if (
                    a.outcome.status === "PROCESSED" &&
                    a.outcome.retainedCount
                  )
                    await load(a.batchId);
                  else await processArchive(a.id, signal);
                })
              }
              className="min-h-16 gap-1 rounded-xl border border-line p-4"
            >
              <Text className="font-semibold text-ink">{a.filename} ›</Text>
              <Text className="text-sm text-muted">
                Importé le {new Date(a.createdAt).toLocaleString("fr-FR")}
              </Text>
              <Text className="text-sm text-muted">
                {a.outcome.status === "PROCESSED"
                  ? `${a.outcome.retainedCount} fichiers · ${a.outcome.failures.length} erreurs d’extraction${a.outcome.ignored.length ? ` · ${a.outcome.ignored.length} ignorés` : ""}`
                  : a.outcome.status === "FAILED"
                    ? archiveError(a.outcome.code)
                    : "Archive conservée · lecture à reprendre"}
              </Text>
            </Pressable>
            {control(a.batchId, "MERCALYS_BATCH", a.filename)}
          </View>
        ))}
        {visibleBatches.map((batch) => (
          <View key={batch.id} className="gap-2">
            <Pressable
              key={batch.id}
              accessibilityRole="button"
              disabled={busy || disabled}
              onPress={() => void run(async () => load(batch.id))}
              className="min-h-16 gap-1 rounded-xl border border-line p-4"
            >
              <Text className="font-semibold text-ink">
                {batch.files.length === 1
                  ? batch.files[0]!.filename
                  : `${batch.files.length} fichiers XLSX`}{" "}
                ›
              </Text>
              <Text className="text-sm text-muted">
                Importé le {new Date(batch.createdAt).toLocaleString("fr-FR")}
              </Text>
            </Pressable>
            {control(
              batch.id,
              "MERCALYS_BATCH",
              batch.files.length === 1 ? batch.files[0]!.filename : "ce lot",
            )}
          </View>
        ))}
        {!visibleArchives.length && !visibleBatches.length ? (
          <Text className="text-sm text-muted">
            {historyTerm
              ? "Aucun import chargé ne correspond à cette recherche."
              : historyArchived
                ? "Aucun import archivé."
                : "Vos prochains imports apparaîtront ici. Les imports rangés restent accessibles dans Archivés."}
          </Text>
        ) : null}
        {moreArchives ? (
          <SecondaryButton
            label="Archives précédentes"
            disabled={busy || disabled}
            onPress={() => void run(async () => loadArchives(true))}
          />
        ) : null}
        {moreBatches ? (
          <SecondaryButton
            label="Lots précédents"
            disabled={busy || disabled}
            onPress={() => void run(async () => loadRecent(true))}
          />
        ) : null}
      </SectionCard>
      <Modal
        visible={!!active}
        animationType="slide"
        presentationStyle="pageSheet"
        allowSwipeDismissal={!busy}
        onRequestClose={() => {
          if (!busy) {
            setActive(undefined);
            activeRef.current = undefined;
          }
        }}
      >
        <AppScreen>
          <AppHeader
            title={batchTitle}
            subtitle={
              importedAt
                ? `${fileCount === undefined ? "Lot" : `${fileCount} fichiers`} · importé le ${new Date(importedAt).toLocaleString("fr-FR")}`
                : "Les originaux et les publications restent conservés."
            }
          />
          <SecondaryButton
            label="Retour aux imports"
            disabled={busy}
            onPress={() => {
              setActive(undefined);
              activeRef.current = undefined;
            }}
          />
          {busy ? (
            <Text
              accessibilityLiveRegion="polite"
              className="text-sm text-muted"
            >
              {progress ??
                (reviewAsset ? "Examen du fichier" : "Traitement du lot…")}
            </Text>
          ) : null}
          {busy && !reviewAsset ? (
            <SecondaryButton
              label="Interrompre le traitement"
              onPress={() => abort.current?.abort()}
            />
          ) : null}
          {error ? (
            <InlineAlert title="Lot à reprendre" message={error} />
          ) : null}
          {activeArchive &&
          (activeArchive.outcome.status !== "PROCESSED" ||
            activeArchive.outcome.failures.length > 0) ? (
            <SecondaryButton
              label="Reprendre l’extraction de l’archive"
              disabled={busy || disabled}
              onPress={() =>
                void run((signal) => processArchive(activeArchive.id, signal))
              }
            />
          ) : null}
          <SecondaryButton
            label={toolsOpen ? "Fermer les actions du lot" : "Actions du lot"}
            expanded={toolsOpen}
            disabled={busy || disabled}
            onPress={() => setToolsOpen((value) => !value)}
          />
          {toolsOpen ? (
            <View className="gap-3">
              {activeArchive?.outcome.status === "PROCESSED" &&
              activeArchive.outcome.failures.length ? (
                <InlineAlert
                  title="Fichiers non extraits"
                  message={activeArchive.outcome.failures
                    .map(
                      (f) =>
                        `${f.path} : extraction impossible. Reprenez l’archive ou sélectionnez ce fichier original.`,
                    )
                    .join("\n")}
                />
              ) : null}
              {activeArchive?.outcome.status === "PROCESSED" &&
              activeArchive.outcome.ignored.length ? (
                <Text className="text-sm text-muted">
                  {activeArchive.outcome.ignored.length} fichiers système
                  ignorés.
                </Text>
              ) : null}
              {active ? (
                <SecondaryButton
                  label="Reprendre les fichiers en attente"
                  disabled={busy || disabled}
                  onPress={() =>
                    void run(async (signal) => {
                      if (alive.current)
                        setProgress("Vérification des fichiers en attente…");
                      await service.preparePending(active, signal);
                      await load(active);
                    })
                  }
                />
              ) : null}
              {active ? (
                <SecondaryButton
                  label="Préparer la publication du lot"
                  disabled={busy || disabled}
                  onPress={() =>
                    void run(async (signal) => {
                      setPublicationReport(undefined);
                      setProgress("Vérification des lignes à publier…");
                      const plan = await publisher.preview(active, signal);
                      if (alive.current) setPublicationPlan(plan);
                    })
                  }
                />
              ) : null}
            </View>
          ) : null}
          {publicationPlan ? (
            <View className="gap-2 rounded-xl border border-line p-3">
              <Text className="font-semibold text-ink">Publication du lot</Text>
              <Text>
                {
                  publicationPlan.items.filter((i) => i.status === "READY")
                    .length
                }{" "}
                fichiers ·{" "}
                {publicationPlan.items
                  .filter((i) => i.status === "READY")
                  .reduce((n, i) => n + i.readyCount, 0)}{" "}
                lignes prêtes
              </Text>
              <Text>
                {
                  publicationPlan.items.filter((i) => i.status === "DUPLICATE")
                    .length
                }{" "}
                fichiers déjà publiés ·{" "}
                {
                  publicationPlan.items.filter(
                    (i) => i.status === "BLOCKED" || i.status === "FAILED",
                  ).length
                }{" "}
                fichiers à examiner
              </Text>
              <Text className="text-sm text-muted">
                Seules les lignes prêtes seront publiées. Les produits à
                confirmer et les fichiers nécessitant un rapprochement restent à
                examiner.
              </Text>
              <SecondaryButton
                label="Publier les lignes prêtes du lot"
                disabled={
                  busy ||
                  disabled ||
                  !publicationPlan.items.some((i) => i.status === "READY")
                }
                onPress={() =>
                  void run(async (signal) => {
                    const plan = publicationPlan;
                    setPublicationPlan(undefined);
                    setProgress("Publication des fichiers en cours…");
                    const report = await publisher.confirm(plan, signal);
                    await load(plan.batchId);
                    if (alive.current) setPublicationReport(report);
                    if (report.some((item) => item.status === "PUBLISHED"))
                      await onPublished?.();
                  })
                }
              />
              <SecondaryButton
                label="Annuler la publication"
                disabled={busy || disabled}
                onPress={() => setPublicationPlan(undefined)}
              />
            </View>
          ) : null}
          {publicationReport ? (
            <InlineAlert
              title="Résultat du lot"
              message={`${publicationReport.filter((i) => i.status === "PUBLISHED").length} fichiers publiés · ${publicationReport.reduce((n, i) => n + i.publishedCount, 0)} lignes publiées. ${publicationReport.filter((i) => i.status === "DUPLICATE").length} fichiers déjà publiés. ${publicationReport.filter((i) => i.status === "BLOCKED" || i.status === "FAILED").length} fichiers restent à examiner. Les lignes non publiées restent visibles dans le détail des fichiers.`}
            />
          ) : null}
          {active && publications.length && onDiscuss ? (
            <SecondaryButton
              label="Préparer l’analyse dans le chat"
              disabled={busy || disabled}
              onPress={() => void run(async () => onDiscuss(active))}
            />
          ) : null}
          {active ? (
            <View className="gap-3">
              {control(active, "MERCALYS_BATCH", batchTitle)}
              {archiveContext ? (
                <ArchiveViewFilter
                  label="Fichiers"
                  archived={itemsArchived}
                  disabled={busy || disabled}
                  onChange={(value) => {
                    if (locked.current || disabled) return;
                    itemsArchivedRef.current = value;
                    setItemsArchived(value);
                    void run(async () => load(active, false, value));
                  }}
                />
              ) : null}
              <TextInput
                accessibilityLabel="Rechercher un fichier du lot par nom"
                placeholder="Rechercher un fichier"
                placeholderTextColor={colors.muted}
                value={query}
                maxLength={200}
                editable={!busy && !disabled}
                onChangeText={setQuery}
                className="min-h-12 rounded-xl border border-line bg-surface px-4 py-3 text-base text-ink"
              />
              <View className="flex-row flex-wrap gap-2">
                {(
                  [
                    ["ALL", "Tous"],
                    ["REVIEW", "À examiner"],
                    ["PUBLISHED", "Avec lignes publiées"],
                    ["QUEUED", "À lire"],
                  ] as const
                ).map(([key, label]) => (
                  <Pressable
                    key={key}
                    accessibilityRole="radio"
                    aria-checked={itemFilter === key}
                    accessibilityState={{
                      checked: itemFilter === key,
                      disabled: busy || disabled,
                    }}
                    accessibilityLabel={`Fichiers : ${label}`}
                    disabled={busy || disabled}
                    onPress={() => setItemFilter(key)}
                    className={`min-h-12 justify-center rounded-xl border px-3 py-2 ${itemFilter === key ? "border-forest bg-forest" : "border-line bg-surface"}`}
                  >
                    <Text
                      className={
                        itemFilter === key
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
                {visibleItems.length} sur {items.length} fichiers chargés
                {more ? " · d’autres fichiers restent à charger" : ""}
              </Text>
            </View>
          ) : null}
          {active && items.length > 0 && visibleItems.length === 0 ? (
            <View className="gap-2">
              <Text className="text-sm text-muted">
                Aucun fichier chargé ne correspond à cette sélection.
              </Text>
              <SecondaryButton
                label="Effacer la recherche et les filtres"
                disabled={busy || disabled}
                onPress={() => {
                  setQuery("");
                  setItemFilter("ALL");
                }}
              />
            </View>
          ) : null}
          {visibleItems.map((item) => (
            <View key={item.id} className="gap-2">
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`Ouvrir le fichier ${item.filename}`}
                disabled={busy || disabled}
                onPress={() =>
                  void run(async (signal) => {
                    const asset = {
                      name: item.filename,
                      uri: await repo.retainedLocation(item.batchId, item.id),
                      expectedChecksum: item.checksum,
                    };
                    reviewChanged.current = false;
                    await new Promise<void>((resolve) => {
                      reviewDone.current = resolve;
                      setReviewAsset(asset);
                    });
                    if (!alive.current || signal.aborted) return;
                    // Refresh this item in place: keep loaded pages, search, filters and list position.
                    let refreshed = item;
                    if (reviewChanged.current) {
                      const current = await repo.get(item.batchId, item.id);
                      await repo.refresh(
                        item.batchId,
                        item.id,
                        current.version,
                      );
                      refreshed = await service.prepare(
                        item.batchId,
                        item.id,
                        signal,
                      );
                    }
                    const committed = await repo.publications(item.batchId);
                    if (!alive.current || signal.aborted) return;
                    setItems((old) =>
                      old.map((row) =>
                        row.id === refreshed.id ? refreshed : row,
                      ),
                    );
                    setPublications(committed);
                    setPublicationPlan(undefined);
                    setPublicationReport((old) =>
                      old?.filter((r) => r.itemId !== item.id),
                    );
                  })
                }
                className="min-h-16 gap-2 rounded-xl border border-line p-4"
              >
                <Text className="font-semibold text-ink">
                  {item.filename} ›
                </Text>
                <Text
                  className={
                    publicationStatus(item, publications)
                      ? "font-semibold text-forest"
                      : "text-muted"
                  }
                >
                  {publicationStatus(item, publications) ?? status(item)}
                </Text>
                {(publicationReport ?? publicationPlan?.items)?.find(
                  (r) =>
                    r.itemId === item.id &&
                    (r.status === "BLOCKED" || r.status === "FAILED"),
                ) ? (
                  <Text className="text-sm text-warning">
                    {publicationIssue(
                      (publicationReport ?? publicationPlan?.items)?.find(
                        (r) => r.itemId === item.id,
                      )?.code,
                    )}
                  </Text>
                ) : null}
              </Pressable>
              {control(item.id, "MERCALYS_ITEM", item.filename)}
            </View>
          ))}
          {active && more ? (
            <SecondaryButton
              label="Afficher les fichiers suivants"
              disabled={busy || disabled}
              onPress={() => void run(async () => load(active, true))}
            />
          ) : null}
        </AppScreen>
        <Modal
          visible={!!reviewAsset}
          animationType="slide"
          presentationStyle="pageSheet"
          allowSwipeDismissal={!reviewBusy}
          onRequestClose={closeReview}
          onDismiss={finishReview}
        >
          {reviewAsset
            ? renderReview(reviewAsset, closeReview, setReviewBusy, () => {
                reviewChanged.current = true;
              })
            : null}
        </Modal>
      </Modal>
    </>
  );
}
function status(item: MercalysBatchItem) {
  const r = item.result;
  if (r.status === "QUEUED") return "En attente de lecture";
  if (r.status === "DUPLICATE")
    return "Déjà importé — aucune nouvelle publication";
  if (r.status === "FAILED")
    return (
      localOperationFailureMessage(r.code) ??
      (r.code === "AGGREGATED_PERIOD_WITHOUT_DAILY_DATES"
        ? "Export agrégé : aucune journée ne sera inventée. Ce format reste à traiter séparément."
        : r.code === "MERCALYS_BATCH_FILE_CHANGED"
          ? "Le fichier conservé a changé. Sélectionnez de nouveau l’original."
          : "Lecture impossible — reprendre ce fichier")
    );
  return `${r.sourceType === "MERCALYS_SALES" ? "Ventes" : "Casse"} · ${r.businessPeriodStart.split("-").reverse().join("/")} → ${r.businessPeriodEnd.split("-").reverse().join("/")}\n${r.readyCount} lignes prêtes · ${r.productReviewCount} produits à confirmer · ${r.errorCount} erreurs${r.overlap ? " · rapprochement nécessaire" : ""}`;
}

function archiveError(code: string) {
  if (code === "MERCALYS_ARCHIVE_FILE_CHANGED")
    return "L’original conservé a changé. Sélectionnez de nouveau l’archive.";
  if (code === "MERCALYS_ZIP_LIMIT")
    return "L’archive dépasse les contrôles de taille ou de nombre de fichiers. Créez un lot plus petit.";
  if (
    code === "MERCALYS_ZIP_UNSAFE_PATH" ||
    code === "MERCALYS_ZIP_DUPLICATE_PATH"
  )
    return "L’archive contient des noms ambigus ou des chemins non autorisés. Récréez le ZIP à partir des exports.";
  if (code === "MERCALYS_ZIP_UNSUPPORTED")
    return "Ce format ZIP n’est pas pris en charge. Utilisez un ZIP non chiffré contenant uniquement des XLSX.";
  return "L’archive ne peut pas être lue. Sélectionnez un nouvel original ; les fichiers déjà conservés restent disponibles.";
}

function publicationIssue(code?: string) {
  const localIssue = localOperationFailureMessage(code);
  if (localIssue) return localIssue;
  if (code === "MERCALYS_PRODUCT_REVIEW_REQUIRED")
    return "Des produits restent à confirmer. Aucune publication automatique pour ce fichier.";
  if (
    code === "MERCALYS_RECONCILIATION_REQUIRED" ||
    code === "MERCALYS_BATCH_OVERLAPPING_FILES"
  )
    return "ce fichier recouvre des données existantes ou un autre fichier du lot. Ouvrez-le pour choisir un rapprochement.";
  if (code === "MERCALYS_BATCH_PLAN_CHANGED")
    return "les produits ou la vérification ont changé. Préparez de nouveau la publication.";
  if (code === "MERCALYS_NO_READY_LINES")
    return "aucune ligne prête. Confirmez les produits dans le détail du fichier.";
  if (code === "AGGREGATED_PERIOD_WITHOUT_DAILY_DATES")
    return "export agrégé : ce format reste à traiter séparément, sans inventer de journées.";
  if (code === "FORMAT_UNRECOGNIZED")
    return "format Mercalys non reconnu. Vérifiez le fichier sélectionné.";
  if (code === "MERCALYS_BATCH_FILE_CHANGED")
    return "l’original conservé a changé. Sélectionnez-le de nouveau.";
  return "la publication de ce fichier n’a pas abouti. Les autres résultats sont conservés ; ouvrez le fichier ou reprenez le lot.";
}
