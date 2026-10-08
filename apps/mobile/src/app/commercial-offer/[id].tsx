import { useCallback, useMemo, useState, useRef, useEffect } from "react";
import { Text, TextInput, Alert } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import {
  digestStringAsync,
  CryptoDigestAlgorithm,
  randomUUID,
} from "expo-crypto";
import {
  commercialChoiceId,
  commercialOfferProposal,
  commercialChoiceProductUnitMatches,
} from "@fl-copilot/commercial-core";
import {
  commercialOfferChoiceSchema,
  synchronizedCommercialVisualReadingSchema,
  type SynchronizedCommercialVisualReading,
} from "@fl-copilot/sync-contracts";
import type { Product, CommercialMechanism } from "@fl-copilot/domain";
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
  } = useLocalSearchParams<{
    id: string;
    operationIndex: string;
    itemIndex: string;
  }>();
  const operationIndex = Number(op),
    itemIndex = Number(item);
  const { session } = useAuth(),
    storeId = session?.stores[0]?.storeId;
  const { sqlite, deviceId } = useLocalDatabase();
  const { syncNow } = useSync();
  const choiceIdentity = useRef(""),
    saving = useRef(false);
  const initialized = useRef(""),
    editingRef = useRef(true);
  const repository = useMemo(
    () => new CommercialChoiceRepository(sqlite, digest),
    [sqlite],
  );
  const [reading, setReading] =
      useState<SynchronizedCommercialVisualReading | null>(null),
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
  const operation = reading?.reading?.operations[operationIndex],
    sourceItem = operation?.items[itemIndex];
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        if (
          !storeId ||
          !id ||
          !Number.isInteger(operationIndex) ||
          !Number.isInteger(itemIndex)
        )
          throw Error("COMMERCIAL_CHOICE_SOURCE_INVALID");
        const row = await sqlite.getFirstAsync<{ payload_json: string }>(
          "SELECT payload_json FROM commercial_visual_readings WHERE id=? AND store_id=?",
          id,
          storeId,
        );
        if (!row) throw Error("COMMERCIAL_CHOICE_SOURCE_INVALID");
        const r = synchronizedCommercialVisualReadingSchema.parse(
            JSON.parse(row.payload_json),
          ),
          o = r.reading?.operations[operationIndex],
          i = o?.items[itemIndex];
        if (!o || i?.kind !== "OFFER")
          throw Error("COMMERCIAL_CHOICE_SOURCE_INVALID");
        const source = {
          sourceDocumentId: r.sourceDocumentId,
          readingId: r.id,
          checksum: r.checksum,
          operationIndex,
          itemIndex,
        };
        const choiceId = await commercialChoiceId(storeId, source, digest);
        choiceIdentity.current = choiceId;
        const [saved, master] = await Promise.all([
          repository.get(storeId, choiceId),
          new ProductMasterRepository(sqlite).listProducts(storeId),
        ]);
        if (!active) return;
        const proposal = commercialOfferProposal(o, i);
        setReading(r);
        setProducts(
          master.map((p) => p.entity).filter((p) => p.status === "ACTIVE"),
        );
        const key = `${id}:${operationIndex}:${itemIndex}`;
        if (initialized.current === key) {
          if (!editingRef.current) setExisting(saved);
          setLoading(false);
          return;
        }
        initialized.current = key;
        setExisting(saved);
        setProductId(saved?.entity.productId ?? "");
        setStart(saved?.entity.saleStart ?? proposal.saleStart);
        setEnd(saved?.entity.saleEnd ?? proposal.saleEnd);
        setInitialMechanism(saved?.entity.mechanism ?? proposal.mechanism);
        setMechanism(saved?.entity.mechanism ?? proposal.mechanism);
        setEditPrice(!(saved?.entity.mechanism ?? proposal.mechanism));
        setNote(saved?.entity.note ?? "");
        setSearch(
          (
            i.fields.find((f) => f.name === "productLabel")?.rawValue ?? i.label
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
      };
    }, [id, operationIndex, itemIndex, storeId, sqlite, repository]),
  );
  async function save(withdraw = false) {
    if (
      !storeId ||
      !reading ||
      !operation ||
      !sourceItem ||
      busy ||
      saving.current
    )
      return;
    setIssues({});
    setError(undefined);
    const source = {
      sourceDocumentId: reading.sourceDocumentId,
      readingId: reading.id,
      checksum: reading.checksum,
      operationIndex,
      itemIndex,
    };
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
            operationKind: operation.kind,
            operationLabel: operation.label,
            rawProductLabel: sourceItem.label,
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
    saving.current = true;
    setBusy(true);
    try {
      await repository.save(parsed.data, { commandId: randomUUID(), deviceId });
      setExisting(await repository.get(storeId, choiceId));
      setInitialMechanism(parsed.data.mechanism);
      setProductId(parsed.data.productId);
      setStart(parsed.data.saleStart);
      setEnd(parsed.data.saleEnd);
      setNote(parsed.data.note ?? "");
      setEditing(false);
      void syncNow(storeId)
        .then(async () => {
          const latest = await repository.get(storeId, choiceId);
          if (!editingRef.current) setExisting(latest);
        })
        .catch(() => undefined);
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : undefined;
      setError(commercialChoiceError(code));
      if (code === "COMMERCIAL_CHOICE_PRODUCT_INVALID")
        setIssues({ productId: commercialChoiceError(code) });
    } finally {
      saving.current = false;
      setBusy(false);
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
        title={sourceItem?.label ?? "Choisir cette offre"}
        subtitle={operation?.label}
      />
      <SecondaryButton
        label="Retour au document"
        onPress={() => router.back()}
        disabled={busy}
      />
      {error ? (
        <InlineAlert title="Choix non enregistré" message={error} />
      ) : null}
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
          ) : !editing ? (
            <>
              <SecondaryButton
                label="Modifier ce choix"
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
      {reading ? (
        <CommercialOriginalButton sourceDocumentId={reading.sourceDocumentId} />
      ) : null}
      {operation && sourceItem ? (
        <SectionCard
          title="Référence du PDF"
          description={`Page ${reading?.pageNumber}`}
        >
          <Text selectable className="text-base text-ink">
            {sourceItem.evidence.map((e) => e.quote).join("\n")}
          </Text>
          {[...operation.fields, ...sourceItem.fields]
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
      {editing && sourceItem && existing?.syncState !== "CONFLICT" ? (
        <>
          <SectionCard title="Produit du magasin">
            {selected ? (
              <>
                <Text className="text-base font-semibold text-ink">
                  {selected.label}
                </Text>
                <SecondaryButton
                  label="Changer le produit"
                  onPress={() => setProductId("")}
                />
              </>
            ) : (
              <>
                <TextInput
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
              value={start}
              onConfirm={setStart}
              issue={issues.saleStart}
            />
            <Text className="text-base text-ink">Fin</Text>
            <DateSelector
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
                  onPress={() => setEditPrice(true)}
                />
              </>
            ) : (
              <MechanismEditor
                key={`${reading?.id}:${existing?.entity.version ?? 0}`}
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
              onPress={() => setApplicable((v) => !v)}
            />
            {issues.applicabilityConfirmed ? (
              <Text accessibilityRole="alert" className="text-danger">
                {issues.applicabilityConfirmed}
              </Text>
            ) : null}
            <SecondaryButton
              label={`${confirmed ? "✓ " : ""}J’ai vérifié le produit, les dates et le mécanisme`}
              onPress={() => setConfirmed((v) => !v)}
            />
            {issues.criticalFieldsConfirmed ? (
              <Text accessibilityRole="alert" className="text-danger">
                {issues.criticalFieldsConfirmed}
              </Text>
            ) : null}
            <TextInput
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
