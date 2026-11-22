import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { randomUUID } from "expo-crypto";
import { requireOptionalNativeModule } from "expo-modules-core";
import { normalizeProductLabel } from "@fl-copilot/domain";
import { useAuth } from "../auth/auth-provider";
import { useLocalDatabase } from "../providers/database-provider";
import { useSync } from "../sync/sync-provider";
import {
  AppScreen,
  BottomSheet,
  InlineAlert,
  PrimaryButton,
  SecondaryButton,
} from "../components/ui";
import { IconButton } from "../components/dashboard";
import { colors } from "../design/tokens";
import { ImportDocumentRow, ImportScreenHeader } from "./imports-presentation";
import { ProcurementCatalogueDraftRepository } from "./procurement-catalogue-draft";
import {
  procurementNativeOriginals,
  retainProcurementJson,
} from "./procurement-native-originals";
import {
  confirmProcurementImport,
  listArticleReferences,
  listProcurementImports,
  procurementPreview,
  procurementReviewDraftSchema,
  procurementReadyRows,
  type ManualProcurementChoice,
  type ProcurementPreview,
} from "./procurement-catalogue-service";
import { SourceOriginalButton } from "./source-original-button";
import { formatFrenchCalendarDate } from "../dates/calendar";
import { StoreContextRepository } from "../store/context-repository";
import { subscribeOutboxChanges } from "../sync/outbox-repository";
const picker = requireOptionalNativeModule<{
  getDocumentAsync(options: {
    type: string[];
    copyToCacheDirectory: boolean;
    multiple: boolean;
  }): Promise<{ canceled: boolean; assets?: { uri: string; name: string }[] }>;
}>("ExpoDocumentPicker");
const message = (e: unknown) => {
  const code = e instanceof Error ? e.message : "";
  if (code === "PROCUREMENT_STORE_PDV_REQUIRED")
    return "Renseigne le code PDV dans Mon magasin avant de lire ce fichier.";
  if (
    code === "PROCUREMENT_PDV_MISMATCH" ||
    code === "PROCUREMENT_LINK_PDV_MISMATCH"
  )
    return "Le code PDV du fichier ne correspond pas à celui du magasin.";
  if (code === "PROCUREMENT_REFERENCE_ORIGINAL_REQUIRED")
    return "L’original du référentiel doit être récupéré sur cet appareil avant le rapprochement.";
  if (code === "PROCUREMENT_ASOF_CONFLICT")
    return "Un catalogue différent est déjà enregistré pour cette même date source. Les deux originaux sont conservés ; vérifie-les avant de poursuivre.";
  if (code === "PROCUREMENT_PREVIEW_CHANGED")
    return "Les fiches ou les correspondances ont changé. Actualise l’aperçu avant de confirmer.";
  if (code === "PROCUREMENT_LINK_PENDING")
    return "Une correspondance est encore en attente ou en conflit. Termine sa synchronisation avant de la modifier.";
  if (code === "PROCUREMENT_SOURCE_SIZE_INVALID")
    return "Choisis un fichier JSON de moins de 10 Mio.";
  return "Le fichier ou ses correspondances ne peuvent pas être validés. Rien n’a été supprimé ; vérifie la source puis réessaie.";
};
export function ProcurementImportScreen() {
  const { session } = useAuth();
  return (
    <ScopedProcurementImportScreen
      key={`${session?.stores[0]?.storeId}:${session?.user.id}`}
    />
  );
}
function ScopedProcurementImportScreen() {
  const { sqlite, deviceId } = useLocalDatabase(),
    { session } = useAuth(),
    sync = useSync();
  const storeId = session?.stores[0]?.storeId,
    actorId = session?.user.id,
    manager = session?.stores[0]?.role === "MANAGER";
  const current = useRef({ storeId, actorId, manager, active: true });
  current.current = { storeId, actorId, manager, active: true };
  useEffect(() => {
    current.current.active = true;
    return () => {
      current.current.active = false;
    };
  }, []);
  const assertScope = useCallback(() => {
    const s = current.current;
    if (
      !s.active ||
      !storeId ||
      !actorId ||
      s.storeId !== storeId ||
      s.actorId !== actorId ||
      !s.manager
    )
      throw Error("PROCUREMENT_SCOPE_CHANGED");
  }, [storeId, actorId]);
  const repo = useMemo(
    () =>
      new ProcurementCatalogueDraftRepository(
        sqlite,
        procurementNativeOriginals,
      ),
    [sqlite],
  );
  const [imports, setImports] = useState<
      Awaited<ReturnType<typeof listProcurementImports>>
    >([]),
    [references, setReferences] = useState<
      Awaited<ReturnType<typeof listArticleReferences>>
    >([]);
  const [checksum, setChecksum] = useState<string | null>(null),
    [referenceId, setReferenceId] = useState<string | null>(null),
    [preview, setPreview] = useState<ProcurementPreview | null>(null);
  const [error, setError] = useState<string>(),
    [notice, setNotice] = useState<string>(),
    [needsOriginal, setNeedsOriginal] = useState(false),
    [previewRevision, setPreviewRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [pdv, setPdv] = useState<string | null>(null);
  const [review, setReview] = useState(false),
    [manual, setManual] = useState<Record<string, ManualProcurementChoice>>({}),
    [panel, setPanel] = useState<"references" | "proof" | null>(null),
    [proofGeneric, setProofGeneric] = useState<string>();
  const [matching, setMatching] = useState<string | null>(null),
    [search, setSearch] = useState(""),
    [picked, setPicked] = useState<number | null>(null),
    [reason, setReason] = useState("");
  const [visibleCount, setVisibleCount] = useState(80);
  const manualAt = (id: string) =>
    Object.hasOwn(manual, id) ? manual[id] : undefined;
  const operation = useRef(false),
    read = useRef(0),
    pendingProduct = useRef<string | null>(null),
    pendingReferenceRoute = useRef(false);
  const ctx = () => ({
    storeId: storeId!,
    actorId: actorId!,
    deviceId,
    now: () => new Date().toISOString(),
    id: randomUUID,
    assertCurrentScope: assertScope,
  });
  const refresh = useCallback(async () => {
    if (!storeId || !actorId) return;
    const ticket = ++read.current;
    try {
      const [files, refs, config] = await Promise.all([
        listProcurementImports(sqlite, storeId, actorId),
        listArticleReferences(sqlite, storeId),
        new StoreContextRepository(sqlite).get(storeId),
      ]);
      if (ticket !== read.current || !current.current.active) return;
      setImports(files);
      setReferences(refs);
      setPdv(config?.entity.pdvCode ?? null);
    } catch {
      if (current.current.active)
        setError(
          "La liste des catalogues ne peut pas être lue. Réessaie après actualisation.",
        );
    }
  }, [sqlite, storeId, actorId]);
  useFocusEffect(
    useCallback(() => {
      void refresh();
      return () => {
        read.current++;
      };
    }, [refresh]),
  );
  useEffect(() => {
    void refresh();
    return subscribeOutboxChanges(() => {
      void refresh();
    });
  }, [refresh, sync.lastSyncedAt]);
  const selectedReference = referenceId ?? references[0]?.id ?? null;
  useEffect(() => {
    let active = true;
    if (!checksum || !storeId || !actorId) {
      setPreview(null);
      return;
    }
    setLoading(true);
    setNeedsOriginal(false);
    setPreview((old) =>
      old?.draft.checksum === checksum && old.referenceId === selectedReference
        ? old
        : null,
    );
    void repo
      .get(storeId, actorId, checksum)
      .then(async (draft) => {
        if (!draft) throw Error("PROCUREMENT_DRAFT_CHANGED");
        return procurementPreview(
          sqlite,
          draft,
          selectedReference,
          procurementNativeOriginals,
        );
      })
      .then(async (next) => {
        const saved = await sqlite.getFirstAsync<{ value: string }>(
          "SELECT value FROM app_metadata WHERE key=?",
          `procurement-review:v1:${storeId}:${actorId}:${checksum}`,
        );
        if (!active || !current.current.active) return;
        setPreview(next);
        setError(undefined);
        let choices: Record<string, ManualProcurementChoice> = {};
        try {
          const parsed = procurementReviewDraftSchema.safeParse(
            saved ? JSON.parse(saved.value) : null,
          );
          if (parsed.success && parsed.data.signature === next.signature)
            choices = parsed.data.choices;
        } catch {
          /* corrupt private draft cannot become a confirmation */
        }
        setManual(choices);
      })
      .catch((e) => {
        if (active && current.current.active) {
          setError(message(e));
          setNeedsOriginal(
            e instanceof Error &&
              (e.message === "PROCUREMENT_REFERENCE_ORIGINAL_REQUIRED" ||
                ("code" in e && e.code === "ENOENT")),
          );
        }
      })
      .finally(() => {
        if (active && current.current.active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    repo,
    sqlite,
    checksum,
    selectedReference,
    storeId,
    actorId,
    pdv,
    previewRevision,
    sync.lastSyncedAt,
  ]);
  const choose = async () => {
    if (operation.current || !manager) return;
    operation.current = true;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      assertScope();
      if (!pdv) throw Error("PROCUREMENT_STORE_PDV_REQUIRED");
      if (!picker) throw Error("PICKER_UNAVAILABLE");
      const selected = await picker.getDocumentAsync({
        type: ["application/json", "text/plain"],
        copyToCacheDirectory: true,
        multiple: false,
      });
      assertScope();
      if (selected.canceled) return;
      const asset = selected.assets?.[0];
      if (!asset) throw Error("PROCUREMENT_SOURCE_FORMAT_INVALID");
      const original = await retainProcurementJson(asset.uri, assertScope);
      const result = await repo.stage(
        {
          id: randomUUID(),
          storeId: storeId!,
          ownerId: actorId!,
          sourceDocumentId: randomUUID(),
          sourceRecordId: randomUUID(),
          fileId: randomUUID(),
          filename: asset.name,
          localUri: original.localUri,
          checksum: original.checksum,
          importedAt: new Date().toISOString(),
          expectedPdv: pdv,
        },
        assertScope,
      );
      assertScope();
      setReferenceId(null);
      setChecksum(result.draft.checksum);
      setReview(false);
      setNotice(
        result.duplicate
          ? "Ce fichier est déjà conservé. Tu peux reprendre son aperçu."
          : undefined,
      );
      await refresh();
    } catch (e) {
      if (current.current.active) setError(message(e));
    } finally {
      operation.current = false;
      if (current.current.active) setBusy(false);
    }
  };
  const save = async () => {
    if (operation.current || !preview || !manager) return;
    operation.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const result = await confirmProcurementImport(
        sqlite,
        preview,
        Object.values(manual),
        procurementNativeOriginals,
        ctx(),
      );
      assertScope();
      setNotice(
        "Catalogue enregistré sur cet appareil. Les offres sont conservées ; les autres correspondances pourront attendre.",
      );
      setManual({});
      const draft = await repo.get(storeId!, actorId!, checksum!);
      if (draft)
        setPreview(
          await procurementPreview(
            sqlite,
            draft,
            selectedReference,
            procurementNativeOriginals,
          ),
        );
      await refresh();
      void sync.syncNow(storeId!).catch(() => {});
      return result;
    } catch (e) {
      if (current.current.active) setError(message(e));
    } finally {
      operation.current = false;
      if (current.current.active) setBusy(false);
    }
  };
  const saveManual = async () => {
    if (
      !preview ||
      matching === null ||
      picked === null ||
      !reason.trim() ||
      operation.current
    )
      return;
    operation.current = true;
    setBusy(true);
    try {
      assertScope();
      const option = preview.options.find(
        (o) => o.reference.sourceIndex === picked,
      );
      if (!option?.productId) throw Error("PROCUREMENT_REVIEW_REQUIRED");
      const next = {
        ...manual,
        [matching]: {
          genericId: matching,
          sourceIndex: picked,
          productId: option.productId,
          reason: reason.trim(),
        },
      };
      await sqlite.runAsync(
        "INSERT INTO app_metadata(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
        `procurement-review:v1:${storeId}:${actorId}:${checksum}`,
        JSON.stringify({ signature: preview.signature, choices: next }),
        new Date().toISOString(),
      );
      assertScope();
      setManual(next);
      setMatching(null);
    } catch (e) {
      if (current.current.active) setError(message(e));
    } finally {
      operation.current = false;
      if (current.current.active) setBusy(false);
    }
  };
  const close = () => {
    if (operation.current) return;
    if (matching !== null) {
      setMatching(null);
      return;
    }
    if (checksum) {
      setChecksum(null);
      setPreview(null);
      setNotice(undefined);
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/actions");
  };
  const ready = preview ? procurementReadyRows(preview) : [];
  const readyIds = new Set(ready.map((r) => r.genericId));
  const exceptions =
    preview?.rows.filter(
      (r) =>
        !readyIds.has(r.genericId) &&
        !preview.links.some(
          (l) =>
            l.entity.genericId === r.genericId &&
            l.entity.status === "ACTIVE" &&
            l.syncState !== "CONFLICT" &&
            l.syncState !== "ERROR",
        ),
    ) ?? [];
  const kept =
    preview?.rows.filter((r) =>
      preview.links.some(
        (l) =>
          l.entity.genericId === r.genericId &&
          l.entity.status === "ACTIVE" &&
          !["CONFLICT", "ERROR"].includes(l.syncState),
      ),
    ) ?? [];
  const shown = review ? exceptions : ready;
  const proof = preview?.rows.find((r) => r.genericId === proofGeneric);
  const options =
    preview?.options
      .filter(
        (o) =>
          !search ||
          normalizeProductLabel(
            [
              o.reference.label,
              o.reference.itm8,
              o.reference.ean,
              o.reference.plu ?? "",
            ].join(" "),
          ).includes(normalizeProductLabel(search)),
      )
      .slice(0, 30) ?? [];
  const total =
    ready.filter((r) => !manualAt(r.genericId)).length +
    Object.keys(manual).length;
  const footer =
    matching !== null ? (
      <PrimaryButton
        label="Retenir cette correspondance"
        onPress={() => void saveManual()}
        disabled={
          picked === null ||
          !reason.trim() ||
          !manager ||
          reason.trim().length > 500
        }
        loading={busy}
      />
    ) : preview ? (
      <PrimaryButton
        label={
          total
            ? `Confirmer les ${total} correspondances`
            : "Enregistrer les offres"
        }
        onPress={() => void save()}
        disabled={!manager || loading || !!error}
        loading={busy}
      />
    ) : undefined;
  const header = (
    <ImportScreenHeader
      title={
        matching
          ? "Vérifier une référence"
          : checksum
            ? "Offres de commande"
            : "Catalogue et offres"
      }
      onClose={close}
      closeIcon="chevron-back"
      closeLabel="Retour"
      disabled={busy}
      action={
        checksum && !matching ? (
          <IconButton
            label="Choisir le référentiel"
            icon="options-outline"
            disabled={busy}
            onPress={() => setPanel("references")}
          />
        ) : undefined
      }
    />
  );
  return (
    <>
      <AppScreen
        header={header}
        footer={footer}
        onRefresh={() => {
          void refresh().then(() => setPreviewRevision((v) => v + 1));
        }}
        refreshing={loading}
        keyboardAware
      >
        {error ? (
          <InlineAlert title="Import à vérifier" message={error} />
        ) : null}
        {notice ? <InlineAlert title="Catalogue" message={notice} /> : null}
        {!pdv ? (
          <>
            <InlineAlert
              title="Code PDV à renseigner"
              message="Dans Mon magasin, indique le code de ton point de vente pour contrôler les fichiers importés."
            />
            <SecondaryButton
              label="Ouvrir Mon magasin"
              onPress={() => router.push("/store-settings")}
            />
          </>
        ) : null}
        {!checksum ? (
          <>
            <Text className="text-3xl font-semibold text-ink">
              Ton catalogue, ses offres.
            </Text>
            <Text className="text-base leading-6 text-muted">
              Importe le référentiel Mercalys, puis le JSON de l’application de
              commande.
            </Text>
            <PrimaryButton
              label="Importer les offres JSON"
              onPress={() => void choose()}
              disabled={!manager || !pdv}
              loading={busy}
            />
            <SecondaryButton
              label="Importer le référentiel Mercalys"
              onPress={() => router.push("/mercalys-imports")}
            />
            {imports.map((f) => (
              <ImportDocumentRow
                key={f.checksum}
                title={f.original_filename}
                detail={
                  f.source_generated_at
                    ? `Catalogue du ${formatFrenchCalendarDate(f.source_generated_at.slice(0, 10))}`
                    : "Catalogue conservé"
                }
                format="JSON"
                onPress={() => {
                  setChecksum(f.checksum);
                  setReview(false);
                  setNotice(undefined);
                }}
              />
            ))}
            {!imports.length ? (
              <Text className="text-sm text-muted">
                Les fichiers conservés apparaîtront ici.
              </Text>
            ) : null}
          </>
        ) : matching !== null && preview ? (
          <>
            <Text className="text-2xl font-semibold text-ink">
              {preview.rows
                .find((r) => r.genericId === matching)
                ?.genericLabels.join(" / ")}
            </Text>
            <Text className="text-sm text-muted">
              Générique {matching}. Choisis une référence du référentiel, puis
              précise ta vérification. Aucun produit ne sera créé.
            </Text>
            <TextInput
              accessibilityLabel="Rechercher une référence Mercalys"
              value={search}
              onChangeText={setSearch}
              placeholder="Nom, ITM, EAN ou PLU"
              className="min-h-12 rounded-2xl border border-line bg-surface px-4 text-base text-ink"
            />
            <View className="gap-1">
              {options.map((o) => (
                <Pressable
                  key={o.reference.sourceIndex}
                  accessibilityRole="radio"
                  accessibilityState={{
                    checked: picked === o.reference.sourceIndex,
                  }}
                  onPress={() => setPicked(o.reference.sourceIndex)}
                  className="gap-1 border-b border-line py-4"
                  style={
                    picked === o.reference.sourceIndex
                      ? { backgroundColor: colors.forestSoft }
                      : undefined
                  }
                >
                  <Text className="text-base font-semibold text-ink">
                    {o.reference.label}
                  </Text>
                  <Text className="text-xs text-muted">
                    ITM {o.reference.itm8} · PLU{" "}
                    {o.reference.plu ?? "non renseigné"}
                  </Text>
                  <Text className="text-xs text-muted">
                    EAN {o.reference.ean}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text className="text-sm text-muted">
              Seules les références dont l’ITM et l’EAN désignent la même fiche
              sont proposées.
            </Text>
            <TextInput
              accessibilityLabel="Motif du rattachement manuel"
              value={reason}
              onChangeText={setReason}
              maxLength={500}
              placeholder="Ce que tu as vérifié…"
              multiline
              className="min-h-20 rounded-xl border border-line p-3 text-base text-ink"
            />
          </>
        ) : loading && !preview ? (
          <Text className="text-base text-muted">Lecture de l’aperçu…</Text>
        ) : preview ? (
          <>
            <Text className="text-3xl font-semibold text-ink">
              Tes offres,{"\n"}bien rattachées.
            </Text>
            <View
              style={{
                backgroundColor: colors.hero,
                borderRadius: 22,
                padding: 22,
                gap: 8,
              }}
            >
              <Text style={{ color: colors.heroMuted, fontSize: 12 }}>
                CATALOGUE DU{" "}
                {formatFrenchCalendarDate(
                  preview.draft.catalogue.asOf.slice(0, 10),
                )}
              </Text>
              <Text
                style={{
                  color: colors.heroInk,
                  fontSize: 36,
                  fontWeight: "600",
                }}
              >
                {preview.draft.catalogue.offers.length} offres
              </Text>
              <Text style={{ color: colors.heroMuted }}>
                {
                  new Set(
                    preview.draft.catalogue.offers.map((o) => o.genericId),
                  ).size
                }{" "}
                références génériques
              </Text>
            </View>
            {!selectedReference ? (
              <>
                <InlineAlert
                  title="Référentiel à importer"
                  message="Les offres peuvent être conservées. Les correspondances pourront être confirmées après l’import du référentiel."
                />
                <SecondaryButton
                  label="Importer le référentiel"
                  onPress={() => router.push("/mercalys-imports")}
                />
              </>
            ) : null}
            <View className="flex-row gap-2">
              {[false, true].map((v) => (
                <Pressable
                  key={String(v)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: review === v }}
                  onPress={() => {
                    setReview(v);
                    setVisibleCount(80);
                  }}
                  className="min-h-11 flex-1 items-center justify-center rounded-full border border-line px-3 py-3"
                  style={{
                    backgroundColor:
                      review === v ? colors.forest : colors.surface,
                  }}
                >
                  <Text
                    style={{
                      color: review === v ? colors.heroInk : colors.ink,
                    }}
                  >
                    {v
                      ? `À vérifier ${exceptions.length}`
                      : `Proposées ${ready.length}`}
                  </Text>
                </Pressable>
              ))}
            </View>
            {kept.length ? (
              <Text className="text-sm text-forest">
                {kept.length} références déjà rattachées · leurs choix sont
                conservés.
              </Text>
            ) : null}
            {shown.slice(0, visibleCount).map((row) => {
              const old = preview.links.find(
                (l) => l.entity.genericId === row.genericId,
              );
              return (
                <Pressable
                  key={row.genericId}
                  accessibilityRole="button"
                  disabled={busy || (!!old && old.syncState !== "SYNCED")}
                  onPress={() => {
                    if (review) {
                      setMatching(row.genericId);
                      setSearch("");
                      setPicked(manualAt(row.genericId)?.sourceIndex ?? null);
                      setReason(manualAt(row.genericId)?.reason ?? "");
                    } else {
                      setProofGeneric(row.genericId);
                      setPanel("proof");
                    }
                  }}
                  className="gap-1 border-b border-line py-4"
                >
                  <Text className="text-base font-semibold text-ink">
                    {row.genericLabels.join(" / ")}
                  </Text>
                  <Text className="text-sm text-muted">
                    {row.offerIds.length} offre(s) ·{" "}
                    {manualAt(row.genericId)
                      ? "choix retenu, à confirmer"
                      : row.state === "PLU_MATCH"
                        ? "PLU concordant"
                        : row.state === "ITM_CANDIDATE"
                          ? "proposition par code ITM"
                          : old?.syncState === "CONFLICT"
                            ? "conflit de synchronisation"
                            : old && old.syncState !== "SYNCED"
                              ? "choix en attente de synchronisation"
                              : row.state === "REVIEW"
                                ? "codes à vérifier"
                                : "sans correspondance"}
                  </Text>
                </Pressable>
              );
            })}
            {shown.length > visibleCount ? (
              <Text className="text-sm text-muted">
                {visibleCount} références affichées sur {shown.length}. Les{" "}
                {ready.length} propositions valides sont incluses dans la
                confirmation.
              </Text>
            ) : null}
            {shown.length > visibleCount ? (
              <SecondaryButton
                label="Afficher les références suivantes"
                onPress={() => setVisibleCount((n) => n + 80)}
              />
            ) : null}
            {preview.facts?.issues.length ? (
              <InlineAlert
                title="Lignes du référentiel à vérifier"
                message={`${preview.facts.issues.length} lignes ont une identité ou un PLU inexploitable. Elles ne sont pas utilisées pour rattacher les offres.`}
              />
            ) : null}
            <SourceOriginalButton
              sourceDocumentId={preview.draft.sourceDocumentId}
              label="Ouvrir le JSON original"
            />
          </>
        ) : null}
        {checksum && selectedReference && needsOriginal && !loading ? (
          <SecondaryButton
            label="Récupérer l’original du référentiel"
            disabled={busy}
            onPress={() => {
              if (operation.current || !sync.originals) return;
              operation.current = true;
              setBusy(true);
              void sync.originals
                .recover(selectedReference)
                .then(() => {
                  assertScope();
                  setReferenceId(null);
                  setChecksum(null);
                  setNotice(
                    "Original récupéré. Rouvre ton catalogue pour reprendre.",
                  );
                  return refresh();
                })
                .catch((e) => {
                  if (current.current.active) setError(message(e));
                })
                .finally(() => {
                  operation.current = false;
                  if (current.current.active) setBusy(false);
                });
            }}
          />
        ) : null}
      </AppScreen>
      <BottomSheet
        visible={panel !== null}
        title={
          panel === "references"
            ? "Référentiel utilisé"
            : "Pourquoi cette correspondance ?"
        }
        swipeToClose
        onClose={() => setPanel(null)}
        onDismiss={() => {
          const id = pendingProduct.current;
          pendingProduct.current = null;
          const referenceRoute = pendingReferenceRoute.current;
          pendingReferenceRoute.current = false;
          if (current.current.active) {
            if (id) router.push(`/product/${id}`);
            else if (referenceRoute) router.push("/mercalys-imports");
          }
        }}
      >
        {panel === "references" ? (
          <View className="gap-3">
            {references.map((r) => (
              <SecondaryButton
                key={r.id}
                label={`${selectedReference === r.id ? "✓ " : ""}${r.original_filename}`}
                onPress={() => {
                  setReferenceId(r.id);
                  setManual({});
                  setPanel(null);
                }}
              />
            ))}
            <SecondaryButton
              label="Importer un référentiel Mercalys"
              onPress={() => {
                pendingReferenceRoute.current = true;
                setPanel(null);
              }}
            />
          </View>
        ) : proof ? (
          <View className="gap-4">
            <Text className="text-xl font-semibold text-ink">
              {proof.genericLabels.join(" / ")}
            </Text>
            <Text className="text-base text-ink">
              Générique : {proof.genericId}
            </Text>
            {proof.candidates.map((r) => (
              <View key={r.sourceIndex} className="gap-2">
                <Text className="text-base text-ink">{r.label}</Text>
                <Text className="text-sm text-muted">
                  ITM {r.itm8} · PLU {r.plu ?? "non renseigné"}
                </Text>
              </View>
            ))}
            <Text className="text-sm leading-6 text-muted">
              {proof.state === "PLU_MATCH"
                ? "Le PLU explicite concorde."
                : "Le code ITM propose cette fiche ; la confirmation reste ton choix."}{" "}
              Le nom seul ne valide pas un rattachement.
            </Text>
            {proof.products[0]?.productId ? (
              <SecondaryButton
                label="Ouvrir la fiche produit"
                onPress={() => {
                  pendingProduct.current = proof.products[0]!.productId;
                  setPanel(null);
                }}
              />
            ) : null}
          </View>
        ) : null}
      </BottomSheet>
    </>
  );
}
