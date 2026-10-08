import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import {
  digestStringAsync,
  CryptoDigestAlgorithm,
  randomUUID,
} from "expo-crypto";
import {
  commercialOfferValidationCurrent,
  commercialOfferValidationSource,
  commercialPreparationReadiness,
  type CommercialPlanIssue,
} from "@fl-copilot/commercial-core";
import {
  commercialVersionDecisionSchema,
  type CommercialWeekPreparation,
} from "@fl-copilot/sync-contracts";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import {
  SectionCard,
  SecondaryButton,
  PrimaryButton,
  InlineAlert,
} from "@/components/ui";
import { readCommercialChoices } from "./offer-choice-repository";
import { readCommercialVisualReadings } from "./visual-repository";
import {
  ValidatedOfferRepository,
  readValidatedOffers,
} from "./validated-offer-repository";
import { CommercialPreparationRepository } from "./week-preparation-repository";
import { commercialChoiceSummary } from "./choice-presentation";
import { commercialOfferValidationError } from "./offer-validation-presentation";
import { CommercialOriginalButton } from "./original-button";
const digest = (s: string) =>
  digestStringAsync(CryptoDigestAlgorithm.SHA256, s);
const fieldLabels: Record<string, string> = {
  purchasePrice: "Prix d’achat indiqué",
  supplierCondition: "Condition fournisseur",
  preorderStart: "Début de précommande",
  preorderDeadline: "Limite de précommande",
  deliveryStart: "Début de livraison",
  deliveryEnd: "Fin de livraison",
  executionDeadline: "Échéance de mise en place",
  applicabilityCondition: "Applicabilité",
  sellingPrice: "Prix indiqué dans la source",
  salesUnit: "Unité dans la source",
  priceOperator: "Opérateur du prix",
  customerMechanism: "Mécanisme indiqué",
  saleStart: "Début de vente indiqué",
  saleEnd: "Fin de vente indiquée",
};
async function readContext(
  sqlite: ReturnType<typeof useLocalDatabase>["sqlite"],
  plan: CommercialWeekPreparation,
) {
  const [choices, validated, prefs, products, prep] = await Promise.all([
    readCommercialChoices(sqlite, plan.storeId),
    readValidatedOffers(sqlite, plan.storeId),
    sqlite.getAllAsync<{ payload_json: string; sync_state: string }>(
      "SELECT payload_json,sync_state FROM commercial_version_decisions WHERE store_id=?",
      plan.storeId,
    ),
    sqlite.getAllAsync<{ id: string; label: string }>(
      "SELECT id,label FROM products WHERE store_id=? AND status='ACTIVE' AND deleted_at IS NULL",
      plan.storeId,
    ),
    new CommercialPreparationRepository(sqlite, digest).get(
      plan.storeId,
      plan.weekStart,
    ),
  ]);
  const selected = plan.offerRefs.flatMap((ref) => {
    const c = choices.find((c) => c.entity.id === ref.choiceId);
    return c ? [c] : [];
  });
  const docs = [
    ...new Set(selected.map((c) => c.entity.source.sourceDocumentId)),
  ];
  const pages = (
    await Promise.all(
      docs.map((id) => readCommercialVisualReadings(sqlite, plan.storeId, id)),
    )
  ).flat();
  const issues = commercialPreparationReadiness(
    plan,
    choices.map((c) => c.entity),
    validated.filter((v) => v.syncState !== "ERROR").map((v) => v.entity),
    prefs.map((r) =>
      commercialVersionDecisionSchema.parse(JSON.parse(r.payload_json)),
    ),
  );
  if (
    !prep ||
    prep.entity.version !== plan.version ||
    ["ERROR", "CONFLICT"].includes(prep.syncState)
  )
    issues.push({
      code: "DRAFT_REVIEW",
      messageFr:
        "Le brouillon enregistré a changé ou sa synchronisation doit être résolue. Rouvrez la semaine avant de valider.",
    });
  for (const c of selected) {
    if (["ERROR", "CONFLICT"].includes(c.syncState))
      issues.push({
        code: "CHOICE_SYNC",
        choiceId: c.entity.id,
        messageFr:
          "Résolvez l’erreur ou le conflit de ce choix dans Synchronisation.",
      });
    if (!products.some((p) => p.id === c.entity.productId))
      issues.push({
        code: "PRODUCT_INVALID",
        choiceId: c.entity.id,
        messageFr: "Le produit associé n’est plus actif. Revoyez cette offre.",
      });
    try {
      commercialOfferValidationSource(c.entity, pages);
    } catch {
      issues.push({
        code: "SOURCE_INVALID",
        choiceId: c.entity.id,
        messageFr:
          "L’extrait source n’est pas disponible. Synchronisez puis rouvrez la source.",
      });
    }
  }
  for (const row of prefs) {
    if (!["ERROR", "CONFLICT"].includes(row.sync_state)) continue;
    const d = commercialVersionDecisionSchema.parse(
      JSON.parse(row.payload_json),
    );
    if (
      selected.some((c) =>
        [d.before.documentId, d.after.documentId].includes(
          c.entity.source.sourceDocumentId,
        ),
      )
    )
      issues.push({
        code: "REFERENCE_SYNC",
        messageFr:
          "Un choix de référence PDF est en erreur ou en conflit. Résolvez-le dans Synchronisation.",
      });
  }
  return {
    selected,
    validated,
    issues,
    pages,
    products,
    preferences: prefs.map((r) =>
      commercialVersionDecisionSchema.parse(JSON.parse(r.payload_json)),
    ),
  };
}
type Context = Awaited<ReturnType<typeof readContext>>;
export function CommercialOfferValidationView({
  plan,
  unsavedChanges,
  onValidated,
}: {
  plan: CommercialWeekPreparation;
  unsavedChanges: boolean;
  onValidated?: () => void;
}) {
  const { sqlite, deviceId } = useLocalDatabase(),
    { syncNow } = useSync();
  const repo = useMemo(
    () => new ValidatedOfferRepository(sqlite, digest),
    [sqlite],
  );
  const [data, setData] = useState<Context>(),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void readContext(sqlite, plan)
        .then((d) => {
          if (active) {
            setData(d);
            setConfirmed(false);
          }
        })
        .catch(() => {
          if (active)
            setError(
              "Les validations du brouillon ne peuvent pas être lues. Rouvrez la semaine.",
            );
        });
      return () => {
        active = false;
      };
    }, [sqlite, plan]),
  );
  const pending =
    data?.selected.filter(
      (c) =>
        !data.validated.some(
          (v) =>
            v.syncState !== "ERROR" &&
            commercialOfferValidationCurrent(v.entity, c.entity),
        ),
    ) ?? [];
  const blocked =
    unsavedChanges ||
    !data ||
    data.issues.some((i) => !["NOT_VALIDATED", "EMPTY_TG"].includes(i.code));
  async function validate() {
    if (busy || blocked || !confirmed || !pending.length) return;
    setBusy(true);
    setError(undefined);
    try {
      await repo.validate(
        plan.storeId,
        pending.map((c) => ({
          choiceId: c.entity.id,
          choiceVersion: c.entity.version,
        })),
        {
          deviceId,
          commandIds: pending.map(() => randomUUID()),
          createdAt: new Date().toISOString(),
        },
      );
      setData(await readContext(sqlite, plan));
      setConfirmed(false);
      onValidated?.();
      void syncNow(plan.storeId)
        .then(async () => setData(await readContext(sqlite, plan)))
        .catch(() => undefined);
    } catch (reason) {
      setError(
        commercialOfferValidationError(
          reason instanceof Error ? reason.message : undefined,
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  function issue(i: CommercialPlanIssue, index: number) {
    return (
      <Text
        key={index}
        accessibilityRole="alert"
        className="text-base text-danger"
      >
        {i.messageFr}
      </Text>
    );
  }
  return (
    <SectionCard
      title="Validation commerciale des offres sélectionnées"
      description="Seules les offres du brouillon enregistré sont concernées. Valider leur contenu commercial ne finalise pas le plan et ne confirme aucune installation."
    >
      {unsavedChanges ? (
        <InlineAlert
          title="Brouillon modifié"
          message="Enregistrez vos modifications avant de valider les offres sélectionnées."
        />
      ) : null}
      {error ? (
        <InlineAlert title="Validation à vérifier" message={error} />
      ) : null}
      {!data ? (
        <Text className="text-muted">Lecture des validations…</Text>
      ) : (
        <>
          {data.selected.map((c) => {
            const v = data.validated.find((v) =>
              commercialOfferValidationCurrent(v.entity, c.entity),
            );
            let source;
            try {
              source = commercialOfferValidationSource(c.entity, data.pages);
            } catch {
              source = null;
            }
            return (
              <SectionCard key={c.entity.id} title={c.entity.rawProductLabel}>
                <Text className="text-base text-ink">
                  Produit associé :{" "}
                  {data.products.find((p) => p.id === c.entity.productId)
                    ?.label ?? "Produit indisponible"}
                </Text>
                <Text selectable className="text-base text-ink">
                  {commercialChoiceSummary(c.entity)}
                </Text>
                <Text className="font-semibold text-ink">
                  {v?.syncState === "SYNCED"
                    ? "Offre validée · synchronisée"
                    : v?.syncState === "PENDING"
                      ? "Offre validée sur cet appareil · à synchroniser"
                      : v?.syncState === "ERROR"
                        ? "Envoi de la validation refusé"
                        : "Cette version reste à valider commercialement"}
                </Text>
                {v?.syncState === "ERROR" ? (
                  <InlineAlert
                    title="Validation conservée sur cet appareil"
                    message={commercialOfferValidationError(
                      v.lastErrorCode ?? undefined,
                    )}
                  />
                ) : null}
                {data.issues
                  .filter((i) => i.choiceId === c.entity.id)
                  .map(issue)}
                {data.preferences
                  .filter(
                    (d) =>
                      [d.before.documentId, d.after.documentId].includes(
                        c.entity.source.sourceDocumentId,
                      ) &&
                      (d.preference === "KEEP_PREVIOUS"
                        ? d.before.documentId
                        : d.after.documentId) !==
                        c.entity.source.sourceDocumentId,
                  )
                  .map((d) => (
                    <SecondaryButton
                      key={d.id}
                      label="Revoir ma référence PDF après correction"
                      disabled={busy}
                      onPress={() =>
                        router.push({
                          pathname: "/commercial-comparison",
                          params: {
                            beforeId: d.before.documentId,
                            afterId: d.after.documentId,
                          },
                        })
                      }
                    />
                  ))}
                {source ? (
                  <View className="gap-2">
                    <Text className="font-semibold text-ink">
                      Conditions de la source à vérifier
                    </Text>
                    <Text className="text-sm text-muted">
                      Les échéances et conditions fournisseur restent les
                      mentions de la source ; aucune commande ni mise en place
                      n’est enregistrée ici.
                    </Text>
                    {source.sourceFields
                      .filter((f) => fieldLabels[f.name])
                      .map((f, i) => (
                        <Text key={i} selectable className="text-sm text-muted">
                          {fieldLabels[f.name]} :{" "}
                          {f.rawValue ?? "Non précisé dans la lecture"}
                        </Text>
                      ))}
                    <Text selectable className="text-sm text-muted">
                      {source.evidence
                        .map((e) => `Page ${e.pageNumber} · ${e.quote}`)
                        .join("\n")}
                    </Text>
                  </View>
                ) : null}
                <CommercialOriginalButton
                  sourceDocumentId={c.entity.source.sourceDocumentId}
                />
                <SecondaryButton
                  label="Revoir le produit, les dates ou le prix de cette offre"
                  disabled={busy}
                  onPress={() =>
                    router.push({
                      pathname: "/commercial-offer/[id]",
                      params: {
                        id: c.entity.source.readingId,
                        operationIndex: String(c.entity.source.operationIndex),
                        itemIndex: String(c.entity.source.itemIndex),
                      },
                    })
                  }
                />
              </SectionCard>
            );
          })}
          {data.issues.filter((i) => !i.choiceId).map(issue)}
          {data.issues.some((i) =>
            [
              "REFERENCE_SYNC",
              "CHOICE_SYNC",
              "DRAFT_REVIEW",
              "SOURCE_INVALID",
            ].includes(i.code),
          ) ? (
            <SecondaryButton
              label="Ouvrir Synchronisation"
              disabled={busy}
              onPress={() => router.push("/sync-center")}
            />
          ) : null}
          {pending.length ? (
            <>
              <SecondaryButton
                label={`${confirmed ? "✓ " : ""}J’ai vérifié les produits, les dates, les mécanismes et les conditions dans les sources`}
                disabled={busy || blocked}
                onPress={() => setConfirmed((c) => !c)}
              />
              <PrimaryButton
                label={
                  busy
                    ? "Validation…"
                    : `Valider les ${pending.length} offre${pending.length > 1 ? "s" : ""} sélectionnée${pending.length > 1 ? "s" : ""}`
                }
                disabled={busy || blocked || !confirmed}
                onPress={() => void validate()}
              />
            </>
          ) : null}
          {!data.issues.length ? (
            <InlineAlert
              title="Offres sélectionnées validées"
              message="Aucun point bloquant détecté dans cette vérification du brouillon. La validation finale du plan et le suivi d’exécution restent à venir."
            />
          ) : null}
        </>
      )}
    </SectionCard>
  );
}
