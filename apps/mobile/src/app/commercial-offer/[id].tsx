import { readCommercialOfferEditorSource } from "@/commercial/choice-source";
import { useCallback, useMemo, useState, useRef, useEffect } from "react";
import { Text, TextInput, Alert } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import {
  digestStringAsync,
  CryptoDigestAlgorithm,
  randomUUID,
} from "expo-crypto";
import { commercialChoiceProductUnitMatches } from "@fl-copilot/commercial-core";
import { commercialOfferChoiceSchema } from "@fl-copilot/sync-contracts";
import type {
  Product,
  CommercialMechanism,
  CopilotSourceOffer,
} from "@fl-copilot/domain";
import { commercialMechanismSchema } from "@fl-copilot/domain";
import { normalizeProductLabel } from "@fl-copilot/domain";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import { ProductMasterRepository } from "@/products/product-master-repository";
import {
  CommercialChoiceRepository,
  type LocalCommercialChoice,
} from "@/commercial/offer-choice-repository";
import { CommercialOriginalButton } from "@/commercial/original-button";
import { MechanismEditor } from "@/commercial/mechanism-editor";
import {
  commercialChoiceSummary,
  commercialMechanismDescription,
  commercialChoiceError,
} from "@/commercial/choice-presentation";
import { DateSelector } from "@/components/date-selector";
import {
  AppScreen,
  AppHeader,
  SectionCard,
  InlineAlert,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
} from "@/components/ui";
const digest = (text: string) =>
  digestStringAsync(CryptoDigestAlgorithm.SHA256, text);
export default function CommercialOfferScreen() {
  const {
    id,
    operationIndex: op,
    itemIndex: item,
    choiceId: requestedChoiceId,
  } = useLocalSearchParams<{
    id: string;
    operationIndex: string;
    itemIndex: string;
    choiceId?: string;
  }>();
  const operationIndex = Number(op),
    itemIndex = Number(item);
  const { session } = useAuth(),
    storeId = session?.stores[0]?.storeId,
    ownerId = session?.user.id,
    role = session?.stores[0]?.role;
  const { sqlite, deviceId } = useLocalDatabase();
  const { syncNow } = useSync();
  const editorScope = useMemo(
    () => ({
      storeId,
      ownerId,
      role,
      sqlite,
      deviceId,
      id,
      requestedChoiceId,
      operationIndex,
      itemIndex,
    }),
    [
      storeId,
      ownerId,
      role,
      sqlite,
      deviceId,
      id,
      requestedChoiceId,
      operationIndex,
      itemIndex,
    ],
  );
  const currentScope = useRef(editorScope);
  currentScope.current = editorScope;
  const activeScope = useRef<
    { scope: typeof editorScope; controller: AbortController } | undefined
  >(undefined);
  const choiceIdentity = useRef(""),
    saving = useRef<{ scope: typeof editorScope; token: symbol } | undefined>(
      undefined,
    );
  const initialized = useRef(""),
    editingRef = useRef(true);
  const repository = useMemo(
    () => new CommercialChoiceRepository(sqlite, digest),
    [sqlite],
  );
  const [sourceOffer, setSourceOffer] = useState<CopilotSourceOffer | null>(
      null,
    ),
    [sourceAvailable, setSourceAvailable] = useState(true),
    [existing, setExisting] = useState<LocalCommercialChoice | null>(null),
    [products, setProducts] = useState<Product[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(true);
  const [editPrice, setEditPrice] = useState(false);
  const [productId, setProductId] = useState(""),
    [search, setSearch] = useState(""),
    [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [initialMechanism, setInitialMechanism] =
      useState<CommercialMechanism | null>(null),
    [mechanism, setMechanism] = useState<unknown>(null),
    [applicable, setApplicable] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [note, setNote] = useState(""),
    [issues, setIssues] = useState<Record<string, string>>({}),
    [error, setError] = useState<string>();
  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);
  useEffect(() => setConfirmed(false), [productId, start, end, mechanism]);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      const actor = { scope: editorScope, controller: new AbortController() };
      activeScope.current = actor;
      if (saving.current?.scope !== editorScope) saving.current = undefined;
      setBusy(!!saving.current);
      const nextKey = `${storeId}:${session?.user.id}:${id}:${requestedChoiceId ?? ""}:${operationIndex}:${itemIndex}`;
      if (initialized.current !== nextKey) {
        setLoading(true);
        setSourceOffer(null);
        setExisting(null);
        choiceIdentity.current = "";
      }
      void (async () => {
        if (!storeId || !id) throw Error("COMMERCIAL_CHOICE_SOURCE_INVALID");
        const loaded = await readCommercialOfferEditorSource(
          sqlite,
          storeId,
          { id, choiceId: requestedChoiceId, operationIndex, itemIndex },
          (choiceId) => repository.get(storeId, choiceId),
          digest,
        );
        const master = await new ProductMasterRepository(sqlite).listProducts(
          storeId,
        );
        if (!active) return;
        const { saved, offer, choiceId, sourceAvailable: available } = loaded;
        choiceIdentity.current = choiceId;
        const proposal = offer.proposal;
        setSourceOffer(offer);
        setSourceAvailable(available);
        setProducts(
          master.map((p) => p.entity).filter((p) => p.status === "ACTIVE"),
        );
        const key = `${storeId}:${session?.user.id}:${id}:${requestedChoiceId ?? ""}:${operationIndex}:${itemIndex}`;
        if (initialized.current === key) {
          if (!editingRef.current) {
            setExisting(saved);
            setEditing(false);
          }
          setLoading(false);
          return;
        }
        initialized.current = key;
        setExisting(saved);
        setProductId(saved?.entity.productId ?? "");
        setStart(saved?.entity.saleStart ?? proposal.saleStart ?? "");
        setEnd(saved?.entity.saleEnd ?? proposal.saleEnd ?? "");
        setInitialMechanism(saved?.entity.mechanism ?? proposal.mechanism);
        setMechanism(saved?.entity.mechanism ?? proposal.mechanism);
        setEditPrice(!(saved?.entity.mechanism ?? proposal.mechanism));
        setNote(saved?.entity.note ?? "");
        setSearch(
          (
            offer.itemFields.find((f) => f.name === "productLabel")?.rawValue ??
            offer.rawProductLabel
          ).split(" ")[0] ?? "",
        );
        setEditing(
          !saved ||
            saved.entity.status === "WITHDRAWN" ||
            saved.syncState === "ERROR",
        );
        setApplicable(false);
        setConfirmed(false);
        setLoading(false);
      })().catch((reason) => {
        if (active) {
          setError(
            commercialChoiceError(
              reason instanceof Error ? reason.message : undefined,
            ),
          );
          setLoading(false);
        }
      });
      return () => {
        active = false;
        actor.controller.abort();
        if (activeScope.current === actor) activeScope.current = undefined;
      };
    }, [
      editorScope,
      id,
      requestedChoiceId,
      operationIndex,
      itemIndex,
      storeId,
      session?.user.id,
      sqlite,
      repository,
    ]),
  );
  async function save(withdraw = false) {
    const actor = activeScope.current;
    const isCurrent = () =>
      !!actor &&
      activeScope.current === actor &&
      !actor.controller.signal.aborted &&
      currentScope.current === editorScope &&
      editorScope.role === "MANAGER" &&
      !!editorScope.ownerId;
    if (!isCurrent()) return;
    const assertCurrentScope = () => {
      if (!isCurrent()) throw Error("COMMERCIAL_CHOICE_SCOPE_CHANGED");
    };
    if (
      !storeId ||
      !sourceOffer ||
      (!sourceAvailable && !withdraw) ||
      session?.stores[0]?.role !== "MANAGER" ||
      busy ||
      saving.current
    )
      return;
    setIssues({});
    setError(undefined);
    const source = sourceOffer.source;
    const now = new Date().toISOString(),
      choiceId = choiceIdentity.current;
    const version =
      (existing?.syncState === "ERROR"
        ? (existing.remoteVersion ?? 0)
        : (existing?.entity.version ?? 0)) + 1;
    const value =
      withdraw && existing
        ? { ...existing.entity, status: "WITHDRAWN", version, updatedAt: now }
        : {
            id: choiceId,
            storeId,
            source,
            operationKind: sourceOffer.operationKind,
            operationLabel: sourceOffer.operationLabel,
            rawProductLabel: sourceOffer.rawProductLabel,
            productId,
            saleStart: start,
            saleEnd: end,
            mechanism,
            applicabilityConfirmed: applicable,
            criticalFieldsConfirmed: confirmed,
            status: "RETAINED",
            note: note.trim() || null,
            version,
            createdAt: existing?.entity.createdAt ?? now,
            updatedAt: now,
          };
    const parsed = commercialOfferChoiceSchema.safeParse(value);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0]);
        next[key] =
          key === "productId"
            ? "Choisissez le produit correspondant dans votre référentiel."
            : key === "mechanism"
              ? "Vérifiez le mécanisme, ses montants, son opérateur et ses unités."
              : key === "applicabilityConfirmed"
                ? "Confirmez que l’opération s’applique à votre magasin."
                : key === "criticalFieldsConfirmed"
                  ? "Confirmez la vérification du produit, des dates et du mécanisme."
                  : issue.message;
      }
      setIssues(next);
      return;
    }
    const operation = { scope: editorScope, token: Symbol("choice-save") };
    saving.current = operation;
    let committed = false;
    setBusy(true);
    try {
      const saved = await repository.save(parsed.data, {
        commandId: randomUUID(),
        deviceId,
        assertCurrentScope,
      });
      committed = true;
      if (currentScope.current === editorScope) editingRef.current = false;
      if (!isCurrent()) return;
      // The canonical writer returns only after the row, history and Outbox commit.
      // Show that local receipt immediately; the asynchronous pull supplies remote status.
      setExisting({
        entity: saved,
        remoteVersion: existing?.remoteVersion ?? null,
        remote: existing?.remote ?? null,
        syncState: "PENDING",
        lastErrorCode: null,
      });
      setInitialMechanism(parsed.data.mechanism);
      setProductId(parsed.data.productId);
      setStart(parsed.data.saleStart);
      setEnd(parsed.data.saleEnd);
      setNote(parsed.data.note ?? "");
      setEditing(false);
      void syncNow(storeId)
        .then(async () => {
          const latest = await repository.get(storeId, choiceId);
          if (isCurrent() && !editingRef.current) setExisting(latest);
        })
        .catch(() => undefined);
    } catch (reason) {
      if (!isCurrent()) return;
      const code = reason instanceof Error ? reason.message : undefined;
      setError(commercialChoiceError(code));
      if (code === "COMMERCIAL_CHOICE_PRODUCT_INVALID")
        setIssues({ productId: commercialChoiceError(code) });
    } finally {
      if (saving.current === operation) {
        saving.current = undefined;
        if (
          currentScope.current === editorScope &&
          activeScope.current?.scope === editorScope
        ) {
          setBusy(false);
          if (committed && !isCurrent()) {
            try {
              const latest = await repository.get(storeId, choiceId);
              if (
                currentScope.current === editorScope &&
                activeScope.current?.scope === editorScope &&
                !saving.current
              ) {
                setExisting(latest);
                setEditing(false);
              }
            } catch {
              if (
                currentScope.current === editorScope &&
                activeScope.current?.scope === editorScope &&
                !saving.current
              )
                setError(
                  "La sauvegarde locale est confirmée, mais le choix ne peut pas encore être relu. Revenez à la liste pour le retrouver.",
                );
            }
          } else if (!committed && !isCurrent())
            setError(
              "La sauvegarde n’a pas été confirmée. Vos saisies restent affichées.",
            );
        }
      }
    }
  }
  const selected = products.find((p) => p.id === productId);
  const proposedMechanism = commercialMechanismSchema.safeParse(mechanism);
  const unitsDiffer =
    selected &&
    proposedMechanism.success &&
    !commercialChoiceProductUnitMatches(
      { mechanism: proposedMechanism.data },
      selected.salesUnit,
    );
  const matches = products
    .filter((p) =>
      normalizeProductLabel(p.label).includes(normalizeProductLabel(search)),
    )
    .slice(0, 8);
  if (loading)
    return (
      <AppScreen>
        <AppHeader title="Choisir cette offre" />
        <Text>Lecture du document…</Text>
      </AppScreen>
    );
  return (
    <AppScreen>
      <AppHeader
        title={sourceOffer?.rawProductLabel ?? "Choisir cette offre"}
        subtitle={sourceOffer?.operationLabel}
      />
      <SecondaryButton
        label="Retour"
        onPress={() => router.back()}
        disabled={busy}
      />
      {error ? <InlineAlert title="Choix à vérifier" message={error} /> : null}
      {existing ? (
        <SectionCard
          title={
            existing.entity.status === "RETAINED"
              ? "Retenue pour mon magasin"
              : "Offre retirée"
          }
        >
          <Text className="text-base text-ink">
            {commercialChoiceSummary(existing.entity)}
          </Text>
          <Text className="text-base text-ink">
            Produit associé : {selected?.label ?? "Fiche produit indisponible"}
          </Text>
          <StatusBadge
            status={
              existing.syncState === "SYNCED"
                ? "synced"
                : existing.syncState === "CONFLICT"
                  ? "conflict"
                  : existing.syncState === "ERROR"
                    ? "error"
                    : "pending"
            }
          />
          <Text className="text-sm text-muted">
            Ce choix prépare votre plan. Il ne confirme aucune installation ni
            action exécutée.
          </Text>
          {existing.syncState === "ERROR" ? (
            <InlineAlert
              title="Synchronisation refusée"
              message={commercialChoiceError(existing.lastErrorCode)}
            />
          ) : null}
          {existing.syncState === "CONFLICT" ? (
            <SecondaryButton
              label="Comparer dans Synchronisation"
              onPress={() => router.push("/sync-center")}
            />
          ) : !editing && session?.stores[0]?.role === "MANAGER" ? (
            <>
              <SecondaryButton
                label="Modifier ce choix"
                disabled={busy || !sourceAvailable}
                onPress={() => {
                  setInitialMechanism(existing.entity.mechanism);
                  setProductId(existing.entity.productId);
                  setStart(existing.entity.saleStart);
                  setEnd(existing.entity.saleEnd);
                  setNote(existing.entity.note ?? "");
                  setEditing(true);
                  setConfirmed(false);
                  setApplicable(false);
                }}
              />
              {existing.entity.status === "RETAINED" ? (
                <SecondaryButton
                  label="Retirer cette offre"
                  disabled={busy}
                  onPress={() =>
                    Alert.alert(
                      "Retirer cette offre ?",
                      "Le choix et sa source restent dans l’historique.",
                      [
                        { text: "Annuler", style: "cancel" },
                        { text: "Retirer", onPress: () => void save(true) },
                      ],
                    )
                  }
                />
              ) : null}
            </>
          ) : null}
        </SectionCard>
      ) : null}
      {!sourceAvailable ? (
        <InlineAlert
          title="Original à consulter"
          message="La référence d’origine n’est pas disponible sur cet appareil. Consultez ou synchronisez le PDF original avant de modifier ce choix."
        />
      ) : null}
      {sourceOffer ? (
        <CommercialOriginalButton
          sourceDocumentId={sourceOffer.source.sourceDocumentId}
        />
      ) : null}
      {sourceOffer ? (
        <SectionCard
          title="Référence du PDF"
          description={`Page ${sourceOffer.pageNumber}`}
        >
          <Text selectable className="text-base text-ink">
            {sourceOffer.itemEvidence.map((e) => e.quote).join("\n")}
          </Text>
          {[...sourceOffer.operationFields, ...sourceOffer.itemFields]
            .filter((f) =>
              [
                "saleStart",
                "saleEnd",
                "sellingPrice",
                "priceOperator",
                "customerMechanism",
                "applicabilityCondition",
                "salesUnit",
              ].includes(f.name),
            )
            .map((field, index) => (
              <Text key={index} selectable className="text-sm text-muted">
                {field.rawValue ?? "À préciser"}
              </Text>
            ))}
        </SectionCard>
      ) : null}
      {editing &&
      sourceOffer &&
      sourceAvailable &&
      session?.stores[0]?.role === "MANAGER" &&
      existing?.syncState !== "CONFLICT" ? (
        <>
          <SectionCard title="Produit du magasin">
            {selected ? (
              <>
                <Text className="text-base font-semibold text-ink">
                  {selected.label}
                </Text>
                <SecondaryButton
                  label="Changer le produit"
                  disabled={busy}
                  onPress={() => setProductId("")}
                />
              </>
            ) : (
              <>
                <TextInput
                  editable={!busy}
                  accessibilityLabel="Rechercher un produit"
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Nom du produit"
                  className={`rounded-xl border p-3 text-base text-ink ${issues.productId ? "border-danger" : "border-line"}`}
                />
                {matches.map((p) => (
                  <SecondaryButton
                    key={p.id}
                    label={p.label}
                    disabled={busy}
                    onPress={() => setProductId(p.id)}
                  />
                ))}
                {!matches.length ? (
                  <Text className="text-sm text-muted">
                    Aucun produit trouvé. Ajoutez-le au référentiel puis revenez
                    à l’offre.
                  </Text>
                ) : null}
                <SecondaryButton
                  label="Ouvrir le référentiel produits"
                  disabled={busy}
                  onPress={() => router.push("/products")}
                />
              </>
            )}
            {issues.productId ? (
              <Text accessibilityRole="alert" className="text-danger">
                {issues.productId}
              </Text>
            ) : null}
          </SectionCard>
          <SectionCard title="Dates de vente">
            <Text className="text-base text-ink">Début</Text>
            <DateSelector
              disabled={busy}
              value={start}
              onConfirm={setStart}
              issue={issues.saleStart}
            />
            <Text className="text-base text-ink">Fin</Text>
            <DateSelector
              disabled={busy}
              value={end}
              onConfirm={setEnd}
              issue={issues.saleEnd}
            />
          </SectionCard>
          <SectionCard title="Prix et mécanique">
            {!editPrice && initialMechanism ? (
              <>
                <Text className="text-base text-ink">
                  {commercialMechanismDescription(initialMechanism)}
                </Text>
                <SecondaryButton
                  label="Corriger le mécanisme"
                  disabled={busy}
                  onPress={() => setEditPrice(true)}
                />
              </>
            ) : (
              <MechanismEditor
                disabled={busy}
                key={`${choiceIdentity.current}:${existing?.entity.version ?? 0}`}
                initial={initialMechanism}
                onChange={setMechanism}
                issue={issues.mechanism}
              />
            )}
            {!editPrice && issues.mechanism ? (
              <Text accessibilityRole="alert" className="text-danger">
                {issues.mechanism}
              </Text>
            ) : null}
          </SectionCard>
          {unitsDiffer ? (
            <InlineAlert
              title="Unités à distinguer"
              message="L’unité de cette offre diffère de celle du référentiel. Vérifiez le produit et le prix dans le PDF : le choix conserve l’unité de l’offre, sans modifier la fiche produit ni calculer une conversion."
            />
          ) : null}
          <SectionCard title="Confirmer mon choix">
            <SecondaryButton
              label={`${applicable ? "✓ " : ""}Cette opération s’applique à mon magasin`}
              disabled={busy}
              onPress={() => setApplicable((v) => !v)}
            />
            {issues.applicabilityConfirmed ? (
              <Text accessibilityRole="alert" className="text-danger">
                {issues.applicabilityConfirmed}
              </Text>
            ) : null}
            <SecondaryButton
              label={`${confirmed ? "✓ " : ""}J’ai vérifié le produit, les dates et le mécanisme`}
              disabled={busy}
              onPress={() => setConfirmed((v) => !v)}
            />
            {issues.criticalFieldsConfirmed ? (
              <Text accessibilityRole="alert" className="text-danger">
                {issues.criticalFieldsConfirmed}
              </Text>
            ) : null}
            <TextInput
              editable={!busy}
              accessibilityLabel="Note sur ce choix"
              placeholder="Précision ou correction (facultatif)"
              value={note}
              onChangeText={setNote}
              multiline
              maxLength={1200}
              className="rounded-xl border border-line p-3 text-base text-ink"
            />
            <PrimaryButton
              label={busy ? "Enregistrement…" : "Retenir pour mon magasin"}
              disabled={busy}
              onPress={() => void save()}
            />
          </SectionCard>
        </>
      ) : null}
    </AppScreen>
  );
}
