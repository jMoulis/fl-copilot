import { MercalysArchiveRepository } from "./mercalys-archive-repository";
import {
  retainMercalysZip,
  extractRetainedMercalysZip,
  nativeMercalysZipStorage,
} from "./mercalys-zip-capture";
import { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { randomUUID, CryptoDigestAlgorithm, digest } from "expo-crypto";
import { File } from "expo-file-system";
import type { MercalysBatchInput, MercalysBatchItem } from "@fl-copilot/domain";
import { SectionCard, SecondaryButton, InlineAlert } from "../components/ui";
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
  pick,
  pickZip,
  onReview,
  disabled = false,
}: {
  db: OutboxDatabase & AtomicMutationDatabase;
  storeId: string;
  ownerId: string;
  pick(): Promise<MercalysSelectedFile[] | undefined>;
  pickZip?(): Promise<MercalysSelectedFile | undefined>;
  onReview(
    asset: MercalysSelectedFile & { expectedChecksum: string },
  ): Promise<void>;
  disabled?: boolean;
}) {
  const repo = useMemo(
    () => new MercalysBatchRepository(db, { storeId, ownerId }),
    [db, storeId, ownerId],
  );
  const archiveRepo = useMemo(
    () => new MercalysArchiveRepository(db, { storeId, ownerId }),
    [db, storeId, ownerId],
  );
  const [archives, setArchives] = useState<
    Awaited<ReturnType<MercalysArchiveRepository["recent"]>>["archives"]
  >([]);
  const [moreArchives, setMoreArchives] = useState(false);
  const service = useMemo(
    () =>
      new MercalysBatchPreparation(repo, {
        read: (uri) => new File(uri).bytes(),
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
  const [batches, setBatches] = useState<MercalysBatchInput[]>([]),
    [moreBatches, setMoreBatches] = useState(false),
    [active, setActive] = useState<string>(),
    [items, setItems] = useState<MercalysBatchItem[]>([]),
    [more, setMore] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [progress, setProgress] = useState<string>();
  const [reviewing, setReviewing] = useState<string>();
  const activeRef = useRef<string | undefined>(undefined);
  const alive = useRef(true),
    locked = useRef(false),
    abort = useRef<AbortController | undefined>(undefined);
  async function loadRecent(older = false) {
    const last = older ? batches.at(-1) : undefined;
    const page = await repo.recent(
      last ? { createdAt: last.createdAt, id: last.id } : undefined,
    );
    if (alive.current) {
      setBatches((old) => (older ? [...old, ...page.batches] : page.batches));
      setMoreBatches(page.hasMore);
    }
  }
  async function loadArchives(older = false) {
    const last = older ? archives.at(-1) : undefined;
    const page = await archiveRepo.recent(
      last ? { id: last.id, createdAt: last.createdAt } : undefined,
    );
    if (alive.current) {
      setArchives((old) =>
        older ? [...old, ...page.archives] : page.archives,
      );
      setMoreArchives(page.hasMore);
    }
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
      await load(result.batchId);
    }
  }
  async function load(batchId: string, older = false) {
    const page = await repo.page(
      batchId,
      older ? (items.at(-1)?.position ?? -1) : -1,
    );
    if (alive.current) {
      setActive(batchId);
      activeRef.current = batchId;
      setItems((old) => (older ? [...old, ...page.items] : page.items));
      setMore(page.hasMore);
    }
  }
  useEffect(() => {
    alive.current = true;
    void archiveRepo
      .recent()
      .then((page) => {
        if (alive.current) {
          setArchives(page.archives);
          setMoreArchives(page.hasMore);
        }
      })
      .catch(() => {
        if (alive.current)
          setError("Les archives conservées ne peuvent pas être ouvertes.");
      });
    void repo
      .recent()
      .then((page) => {
        if (alive.current) {
          setBatches(page.batches);
          setMoreBatches(page.hasMore);
        }
      })
      .catch(() => {
        if (alive.current)
          setError("Les lots locaux ne peuvent pas être ouverts.");
      });
    return () => {
      alive.current = false;
      abort.current?.abort();
    };
  }, [repo, archiveRepo]);
  async function run(work: (signal: AbortSignal) => Promise<void>) {
    if (locked.current || disabled) return;
    locked.current = true;
    setBusy(true);
    setError(undefined);
    const a = new AbortController();
    abort.current = a;
    try {
      await work(a.signal);
    } catch (reason) {
      if (alive.current && !a.signal.aborted)
        setError(
          reason instanceof Error && reason.message.includes("LIMIT")
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
        setProgress(undefined);
      }
    }
  }
  if (reviewing)
    return (
      <SectionCard title="Fichier du lot">
        <Text>{reviewing}</Text>
        <Text className="text-sm text-muted">
          L’examen du fichier est affiché ci-dessous.
        </Text>
        <SecondaryButton
          label="Revenir aux fichiers du lot"
          disabled={busy || disabled}
          onPress={() => setReviewing(undefined)}
        />
      </SectionCard>
    );
  return (
    <SectionCard title="Imports en lot">
      <Text className="text-sm text-muted">
        Sélectionnez plusieurs exports de ventes ou de casse. Chaque fichier
        conserve sa période et sera examiné avant publication.
      </Text>
      <SecondaryButton
        label="Choisir plusieurs fichiers XLSX"
        disabled={busy || disabled}
        loading={busy}
        onPress={() =>
          void run(async (signal) => {
            const files = await pick();
            if (!files?.length || signal.aborted) return;
            const captured = await captureMercalysBatch(
              { files, storeId, ownerId },
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
              await load(captured.batchId);
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
      {archives.map((a) => (
        <View key={a.id} className="gap-2 rounded-xl border border-line p-3">
          <Text className="font-semibold text-ink">{a.filename}</Text>
          <Text>
            {a.outcome.status === "RETAINED"
              ? "Archive conservée — lecture à reprendre"
              : a.outcome.status === "FAILED"
                ? archiveError(a.outcome.code)
                : `${a.outcome.retainedCount} fichiers conservés · ${a.outcome.failures.length} erreurs · ${a.outcome.ignored.length} fichiers système ignorés`}
          </Text>
          {a.outcome.status === "PROCESSED"
            ? a.outcome.failures.map((f) => (
                <Text key={f.path}>
                  {f.path} : extraction impossible, sélectionnez l’original ou
                  un ZIP corrigé.
                </Text>
              ))
            : null}
          {a.outcome.status !== "PROCESSED" || a.outcome.failures.length ? (
            <SecondaryButton
              label="Lire / reprendre cette archive"
              disabled={busy || disabled}
              onPress={() => void run((signal) => processArchive(a.id, signal))}
            />
          ) : null}
          {a.outcome.status === "PROCESSED" && a.outcome.retainedCount ? (
            <SecondaryButton
              label="Ouvrir les fichiers extraits"
              disabled={busy || disabled}
              onPress={() => void run(async () => load(a.batchId))}
            />
          ) : null}
        </View>
      ))}
      {moreArchives ? (
        <SecondaryButton
          label="Voir les archives précédentes"
          disabled={busy || disabled}
          onPress={() => void run(async () => loadArchives(true))}
        />
      ) : null}
      {archives.length ? (
        <Text className="text-sm text-muted">
          L’archive originale reste sur cet appareil. Chaque fichier publié est
          synchronisé.
        </Text>
      ) : null}
      <Text className="text-sm text-muted">
        Les originaux sont conservés sur cet appareil. La synchronisation du
        fichier commence après sa publication.
      </Text>
      {busy ? (
        <SecondaryButton
          label="Interrompre le lot"
          onPress={() => abort.current?.abort()}
        />
      ) : null}
      {progress ? (
        <Text accessibilityLiveRegion="polite">{progress}</Text>
      ) : null}
      {error ? <InlineAlert title="Lot à reprendre" message={error} /> : null}
      {batches.map((batch) => (
        <SecondaryButton
          key={batch.id}
          label={`${batch.files.length} fichier${batch.files.length > 1 ? "s" : ""} · ${new Date(batch.createdAt).toLocaleDateString("fr-FR")}`}
          disabled={busy || disabled}
          onPress={() => void run(async () => load(batch.id))}
        />
      ))}
      {moreBatches ? (
        <SecondaryButton
          label="Voir les lots précédents"
          disabled={busy || disabled}
          onPress={() => void run(async () => loadRecent(true))}
        />
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
      {items.map((item) => (
        <View key={item.id} className="gap-2 rounded-xl border border-line p-3">
          <Text className="font-semibold text-ink">{item.filename}</Text>
          <Text>{status(item)}</Text>
          {item.result.status === "REVIEW" ? (
            <SecondaryButton
              label="Examiner ce fichier"
              disabled={busy || disabled}
              onPress={() =>
                void run(async () => {
                  setReviewing(item.filename);
                  await onReview({
                    name: item.filename,
                    uri: item.localUri,
                    expectedChecksum: item.checksum,
                  });
                })
              }
            />
          ) : null}
          <SecondaryButton
            label="Vérifier à nouveau ce fichier"
            disabled={busy || disabled}
            onPress={() =>
              void run(async (signal) => {
                await repo.refresh(item.batchId, item.id, item.version);
                await service.prepare(item.batchId, item.id, signal);
                await load(item.batchId);
              })
            }
          />
        </View>
      ))}
      {active && more ? (
        <SecondaryButton
          label="Afficher les fichiers suivants"
          disabled={busy || disabled}
          onPress={() => void run(async () => load(active, true))}
        />
      ) : null}
    </SectionCard>
  );
}
function status(item: MercalysBatchItem) {
  const r = item.result;
  if (r.status === "QUEUED") return "En attente de lecture";
  if (r.status === "DUPLICATE")
    return "Déjà importé — aucune nouvelle publication";
  if (r.status === "FAILED")
    return r.code === "AGGREGATED_PERIOD_WITHOUT_DAILY_DATES"
      ? "Export agrégé : aucune journée ne sera inventée. Ce format reste à traiter séparément."
      : r.code === "MERCALYS_BATCH_FILE_CHANGED"
        ? "Le fichier conservé a changé. Sélectionnez de nouveau l’original."
        : "Lecture impossible — reprendre ce fichier";
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
