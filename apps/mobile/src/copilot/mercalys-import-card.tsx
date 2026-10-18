import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { ActivityIndicator, Text, View } from "react-native";
import {
  mercalysProductTargetBlocker,
  type CopilotMessage,
} from "@fl-copilot/domain";
import { SecondaryButton } from "../components/ui";
import { colors } from "../design/tokens";
import {
  MercalysImportProductPicker,
  mercalysTargetBlockerText,
} from "./mercalys-import-product-picker";
import type {
  CopilotMercalysImportController,
  ImportReport,
} from "./mercalys-import-controller";
export function MercalysImportCard({
  message,
  controller,
  onUpdated,
}: {
  message: CopilotMessage;
  controller: CopilotMercalysImportController;
  onUpdated(): void;
}) {
  const [report, setReport] = useState<ImportReport>(),
    [progress, setProgress] = useState<string>(),
    [error, setError] = useState<string>(),
    [busy, setBusy] = useState(false),
    [expanded, setExpanded] = useState<string>();
  const abort = useRef<AbortController | undefined>(undefined),
    revision = useRef(0),
    locked = useRef(false);
  const run = useCallback(
    async (choice?: {
      review: Extract<ImportReport["items"][number], { status: "REVIEW" }>;
      value: Parameters<CopilotMercalysImportController["resolve"]>[2];
    }) => {
      if (locked.current) return;
      locked.current = true;
      const current = revision.current,
        a = new AbortController();
      abort.current = a;
      setBusy(true);
      setError(undefined);
      try {
        if (choice)
          await controller.resolve(
            message,
            choice.review,
            choice.value,
            a.signal,
          );
        const result = await controller.run(message, a.signal, (label) => {
          if (revision.current === current) setProgress(label);
        });
        if (revision.current === current) {
          setReport(result);
          onUpdated();
        }
      } catch {
        if (choice && !a.signal.aborted) {
          const fresh = await controller
            .run(message, a.signal)
            .catch(() => undefined);
          if (fresh && revision.current === current) setReport(fresh);
        }
        if (revision.current === current && !a.signal.aborted)
          setError(
            "Le traitement est interrompu. Les originaux et les données déjà enregistrées sont conservés. Reprenez ici pour terminer.",
          );
      } finally {
        locked.current = false;
        if (abort.current === a) abort.current = undefined;
        if (revision.current === current) {
          setBusy(false);
          setProgress(undefined);
        }
      }
    },
    [controller, message, onUpdated],
  );
  useFocusEffect(
    useCallback(() => {
      revision.current++;
      setBusy(false);
      setProgress(undefined);
      void run();
      return () => {
        revision.current++;
        abort.current?.abort();
      };
    }, [run]),
  );
  return (
    <View
      style={{
        padding: 16,
        gap: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.forest,
      }}
    >
      <Text style={{ fontWeight: "700", color: colors.forest }}>
        Import Mercalys
      </Text>
      <Text>
        Les références uniques et les fichiers sans ambiguïté sont traités
        automatiquement. Les décisions ci-dessous concernent uniquement les
        doutes.
      </Text>
      {busy ? (
        <View style={{ gap: 8 }}>
          <ActivityIndicator accessibilityLabel="Traitement des fichiers" />
          <Text accessibilityLiveRegion="polite">
            {progress ?? "Vérification des fichiers…"}
          </Text>
          <SecondaryButton
            label="Interrompre"
            onPress={() => abort.current?.abort()}
          />
        </View>
      ) : null}
      {report ? (
        <>
          <Text accessibilityLiveRegion="polite">
            {
              report.items.filter(
                (i) => i.status === "PUBLISHED" && !i.alreadyPublished,
              ).length
            }{" "}
            nouveaux fichiers publiés ·{" "}
            {
              report.items.filter(
                (i) => i.status === "PUBLISHED" && i.alreadyPublished,
              ).length
            }{" "}
            déjà enregistrés ·{" "}
            {report.items.filter((i) => i.status === "REVIEW").length} à
            examiner · {report.items.filter((i) => i.status === "ERROR").length}{" "}
            à reprendre
          </Text>
          {report.items
            .filter((i) => i.status !== "PUBLISHED")
            .map((item) => (
              <View
                key={item.itemId}
                style={{
                  gap: 8,
                  borderTopWidth: 1,
                  borderColor: colors.line,
                  paddingTop: 12,
                }}
              >
                <Text style={{ fontWeight: "600" }}>{item.filename}</Text>
                {item.status === "KEPT" ? (
                  <Text>Version existante conservée.</Text>
                ) : item.status === "ERROR" ? (
                  <Text>
                    {item.code === "IMPORT_REVIEW_LIMIT"
                      ? "Ce fichier dépasse la taille de revue automatique. Son original est conservé."
                      : item.code === "AGGREGATED_PERIOD_WITHOUT_DAILY_DATES"
                        ? "Ce fichier contient une période agrégée sans dates quotidiennes. Il faut un export détaillé ; aucune journée ne sera inventée."
                        : item.code === "MERCALYS_BATCH_FILE_CHANGED"
                          ? "L’original conservé a changé. Sélectionnez de nouveau le fichier."
                          : item.code === "FORMAT_UNRECOGNIZED"
                            ? "Ce fichier n’est pas reconnu comme un export Mercalys de ventes ou de casse."
                            : "Ce fichier reste à reprendre. Aucun remplacement automatique."}
                  </Text>
                ) : (
                  <>
                    <Text>
                      {item.summary.readyCount} lignes prêtes ·{" "}
                      {item.summary.productReviewCount} à rapprocher ·{" "}
                      {item.summary.errorCount} anomalies
                    </Text>
                    {item.resolutions.slice(0, 5).map((r) => (
                      <View key={r.key} style={{ gap: 8 }}>
                        <Text style={{ fontWeight: "600" }}>
                          À quel produit correspond « {r.label} » ?
                        </Text>
                        {r.identifiers.length ? (
                          <Text>
                            {r.identifiers
                              .map((i) => `${i.type} ${i.value}`)
                              .join(" · ")}
                          </Text>
                        ) : null}
                        {r.sourceLabels.length > 1 ? (
                          <Text>
                            Cette référence apparaît sous plusieurs libellés
                            dans le lot : {r.sourceLabels.join(" ; ")}. Le choix
                            s’appliquera à cette référence.
                          </Text>
                        ) : null}
                        {r.candidateProductIds.map((id) => {
                          const p = item.catalog.products.find(
                            (p) => p.id === id,
                          );
                          const blocker = item.conflictedProductIds.includes(id)
                            ? ("SYNC_CONFLICT" as const)
                            : mercalysProductTargetBlocker(
                                message.storeId,
                                r,
                                id,
                                item.catalog,
                              );
                          return p ? (
                            <View key={id} style={{ gap: 4 }}>
                              <SecondaryButton
                                label={`Associer à ${p.label}`}
                                disabled={busy || blocker !== null}
                                onPress={() =>
                                  void run({
                                    review: item,
                                    value: {
                                      resolutionKey: r.key,
                                      productId: id,
                                    },
                                  })
                                }
                              />
                              {blocker ? (
                                <Text>
                                  {mercalysTargetBlockerText[blocker]}
                                </Text>
                              ) : null}
                            </View>
                          ) : null;
                        })}
                        <MercalysImportProductPicker
                          key={`${item.basisHash}:${r.key}`}
                          storeId={message.storeId}
                          source={r}
                          catalog={item.catalog}
                          conflictedProductIds={item.conflictedProductIds}
                          busy={busy}
                          onConfirm={(productId) =>
                            void run({
                              review: item,
                              value: {
                                resolutionKey: r.key,
                                productId,
                                catalogueSelection: true,
                              },
                            })
                          }
                        />
                        {r.canCreateAsDistinct ? (
                          <SecondaryButton
                            label={`Créer « ${r.label} » comme produit distinct`}
                            disabled={busy}
                            onPress={() =>
                              void run({
                                review: item,
                                value: {
                                  resolutionKey: r.key,
                                  productId: null,
                                },
                              })
                            }
                          />
                        ) : null}
                        {!r.candidateProductIds.length &&
                        !r.canCreateAsDistinct ? (
                          <Text>
                            Si aucune proposition ne convient, recherchez le
                            produit dans le référentiel. Un code déjà attribué
                            ou un alias refusé nécessite un examen d’identité
                            distinct.
                          </Text>
                        ) : null}
                      </View>
                    ))}
                    {item.resolutions.length > 5 ? (
                      <Text>
                        Les autres rapprochements apparaîtront après ces
                        décisions. Les lignes répétées sont regroupées.
                      </Text>
                    ) : null}
                    {item.overlap ? (
                      <>
                        <Text>
                          Ce fichier recouvre des données existantes :{" "}
                          {item.overlap.counts.MODIFIED} modifiées,{" "}
                          {item.overlap.counts.ADDED} nouvelles,{" "}
                          {item.overlap.counts.REMOVED} absentes,{" "}
                          {item.overlap.counts.AMBIGUOUS} ambiguës.
                        </Text>
                        <SecondaryButton
                          label={
                            expanded === item.itemId
                              ? "Masquer les différences"
                              : "Voir les différences"
                          }
                          disabled={busy}
                          onPress={() =>
                            setExpanded((v) =>
                              v === item.itemId ? undefined : item.itemId,
                            )
                          }
                        />
                        {expanded === item.itemId
                          ? item.overlap.rows
                              .filter((r) => r.category !== "UNCHANGED")
                              .map((r) => (
                                <View key={r.key} style={{ gap: 3 }}>
                                  <Text style={{ fontWeight: "600" }}>
                                    {r.productLabel} ·{" "}
                                    {r.businessDate
                                      .split("-")
                                      .reverse()
                                      .join("/")}
                                  </Text>
                                  {Object.entries({
                                    quantity: "Quantité",
                                    purchaseValue: "Achat (€)",
                                    rceValue: "RCE (€)",
                                    salesValue: "Vente (€)",
                                    vatValue: "TVA (€)",
                                    marginValue: "Marge (€)",
                                    marginRate: "Taux de marge (%)",
                                  }).map(([key, label]) => (
                                    <Text key={key}>
                                      {label} :{" "}
                                      {r.existingValues?.[key as "quantity"] ??
                                        "—"}{" "}
                                      →{" "}
                                      {r.incomingValues?.[key as "quantity"] ??
                                        "—"}
                                    </Text>
                                  ))}
                                </View>
                              ))
                          : null}
                        <SecondaryButton
                          label="Conserver les données existantes"
                          disabled={busy}
                          onPress={() =>
                            void run({
                              review: item,
                              value: { overlap: "KEEP_EXISTING" },
                            })
                          }
                        />
                        {item.overlap.safeToApply ? (
                          <SecondaryButton
                            label="Appliquer ce fichier corrigé"
                            disabled={busy || expanded !== item.itemId}
                            onPress={() =>
                              void run({
                                review: item,
                                value: { overlap: "APPLY_NEW" },
                              })
                            }
                          />
                        ) : (
                          <Text>
                            Le remplacement attend la résolution des ambiguïtés.
                          </Text>
                        )}
                      </>
                    ) : null}
                  </>
                )}
              </View>
            ))}
          <Text>
            Les chiffres publiés sont enregistrés sur cet appareil et attendent,
            si nécessaire, la synchronisation. Les classifications incertaines
            restent à préciser sans bloquer les montants.
          </Text>
        </>
      ) : null}
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: colors.critical }}
        >
          {error}
        </Text>
      ) : null}
      {!busy ? (
        <SecondaryButton
          label="Reprendre / actualiser"
          onPress={() => void run()}
        />
      ) : null}
    </View>
  );
}
