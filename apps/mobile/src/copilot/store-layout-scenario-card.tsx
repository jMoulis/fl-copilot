import { LayoutPreparationPanel } from "./layout-preparation-panel";
import type { LayoutPreparationController } from "./layout-preparation-controller";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import type { CopilotMessage } from "@fl-copilot/domain";
import { BottomSheet, InlineAlert, SecondaryButton } from "../components/ui";
import { StoreLayoutMap } from "../store/layout-map";
import { initialLayoutViewport } from "../store/layout-view-model";
import { CommercialOriginalButton } from "../commercial/original-button";
import type { CopilotStoreLayoutScenarioReader } from "./store-layout-scenario-reader";
type State = Awaited<ReturnType<CopilotStoreLayoutScenarioReader["open"]>>;
/** The schematic uses only the immutable source revision. Newer plans never replace its geometry implicitly. */
export function StoreLayoutScenarioView({
  state,
  onRefresh,
  refreshing,
  renderOriginal,
  error,
  renderPreparation,
  saved = false,
}: {
  state: Omit<State, "message">;
  saved?: boolean;
  renderPreparation?: () => ReactNode;
  onRefresh: () => void;
  refreshing: boolean;
  error?: string;
  renderOriginal?: (id: string) => ReactNode;
}) {
  const [visible, setVisible] = useState(false),
    [viewport, setViewport] = useState(initialLayoutViewport),
    [selected, setSelected] = useState<string | null>(null);
  const { scenario, layout } = state;
  const annotations = useMemo(() => {
    const result: Record<string, string> = {};
    scenario.assignments.forEach((a, i) => {
      result[a.furnitureId] = [result[a.furnitureId], String(i + 1)]
        .filter(Boolean)
        .join(" · ");
    });
    return result;
  }, [scenario]);
  const freshness =
    state.freshness === "CURRENT"
      ? "Sources inchangées sur cet appareil"
      : state.freshness === "REVIEW_REQUIRED"
        ? "Proposition à revoir"
        : "Sources à vérifier";
  return (
    <View className="gap-3 rounded-2xl border border-line bg-white p-4">
      <Text className="font-semibold text-ink">{scenario.title}</Text>
      <Text className="text-muted">
        {saved ? "Implantation enregistrée" : "Proposition"} · semaine du{" "}
        {new Date(scenario.weekStart + "T12:00:00Z").toLocaleDateString(
          "fr-FR",
        )}{" "}
        · {scenario.assignments.length} affectation
        {scenario.assignments.length > 1 ? "s" : ""}
      </Text>
      <Text className="text-muted">{freshness}</Text>
      <SecondaryButton
        label="Voir le schéma et les affectations"
        onPress={() => setVisible(true)}
      />
      <BottomSheet
        visible={visible}
        title={
          saved ? "Implantation de la semaine" : "Proposition d’implantation"
        }
        swipeToClose
        onClose={() => setVisible(false)}
      >
        <Text className="font-semibold text-ink">{scenario.title}</Text>
        <Text className="text-muted">
          Semaine du{" "}
          {new Date(scenario.weekStart + "T12:00:00Z").toLocaleDateString(
            "fr-FR",
          )}{" "}
          · Plan source v{scenario.physicalVersion}. Les meubles conservent
          leurs positions enregistrées.
        </Text>
        {state.freshness !== "CURRENT" ? (
          <InlineAlert
            title={freshness}
            message="Le schéma conserve son plan d’origine. Relisez les changements avant d’utiliser cette proposition."
          />
        ) : null}
        {state.issues.map((message, i) => (
          <Text key={i} className="text-muted">
            {message}
          </Text>
        ))}
        {layout ? (
          <StoreLayoutMap
            content={layout.content}
            selectedId={selected}
            viewport={viewport}
            onViewport={setViewport}
            onSelect={setSelected}
            annotations={annotations}
          />
        ) : null}
        {layout ? (
          <Text className="text-muted">
            Retrouvez chaque numéro dans la liste ci-dessous. Les mobiles sans
            position connue figurent uniquement dans la liste.
          </Text>
        ) : null}
        {scenario.geometry.status !== "CHECKED" ? (
          <InlineAlert
            title={
              scenario.geometry.status === "BLOCKED"
                ? "Contraintes physiques à revoir"
                : "Mesures à compléter ou confirmer"
            }
            message={
              scenario.geometry.status === "BLOCKED"
                ? "Des incompatibilités dans le plan source restent à résoudre. Ce schéma ne confirme pas la faisabilité de l’implantation."
                : "Certaines mesures du plan source manquent ou restent à confirmer. La capacité de présentation reste inconnue."
            }
          />
        ) : null}
        {scenario.assignments.map((a, i) => (
          <View
            key={`${a.furnitureId}:${a.surfaceId}`}
            className="gap-3 rounded-xl border border-line p-3"
            style={{ borderWidth: selected === a.furnitureId ? 2 : 1 }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Repérer l’affectation ${i + 1} : ${a.targetLabel}`}
              onPress={() => setSelected(a.furnitureId)}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <Text className="font-semibold text-ink">
                {i + 1}. {a.targetLabel}
              </Text>
            </Pressable>
            {a.items.map((ref) => {
              const item = scenario.items.find(
                (x) => x.id === ref.id && x.kind === ref.kind,
              )!;
              return (
                <View key={`${ref.kind}:${ref.id}`} className="gap-1">
                  <Text className="font-semibold text-ink">{item.label}</Text>
                  <Text className="text-muted">
                    {item.kind === "OFFER"
                      ? `Offre retenue · ${new Date(item.saleStart! + "T12:00:00Z").toLocaleDateString("fr-FR")} au ${new Date(item.saleEnd! + "T12:00:00Z").toLocaleDateString("fr-FR")} · version ${item.version}`
                      : `Produit · version ${item.productVersion}`}
                  </Text>
                  {item.source && renderOriginal
                    ? renderOriginal(item.source.sourceDocumentId)
                    : null}
                </View>
              );
            })}
            {a.reason ? (
              <Text className="text-ink">Proposition : {a.reason}</Text>
            ) : null}
          </View>
        ))}
        {scenario.assumptions.length ? (
          <View className="gap-2">
            <Text className="font-semibold text-ink">
              Hypothèses de la proposition
            </Text>
            {scenario.assumptions.map((v, i) => (
              <Text key={i} className="text-muted">
                {v}
              </Text>
            ))}
          </View>
        ) : null}
        <Text className="text-muted">
          {saved
            ? "Répartition enregistrée pour cette semaine, sans déclaration de mise en place."
            : "Répartition proposée, sans validation du plan ni déclaration de mise en place."}{" "}
          Quantités et capacité restent à confirmer. Ce schéma n’est pas une
          image générée.
        </Text>
        {visible && renderPreparation ? renderPreparation() : null}
        <Text className="text-muted">
          {freshness}. La vérification utilise les données locales ;
          synchronisez pour récupérer les dernières modifications.
        </Text>
        {error ? (
          <InlineAlert title="Vérification indisponible" message={error} />
        ) : null}
        <SecondaryButton
          label={
            refreshing
              ? "Vérification…"
              : "Vérifier à nouveau les sources locales"
          }
          disabled={refreshing}
          onPress={onRefresh}
        />
      </BottomSheet>
    </View>
  );
}
export function StoreLayoutScenarioCard({
  message,
  reader,
  preparation,
}: {
  message: CopilotMessage;
  reader: CopilotStoreLayoutScenarioReader;
  preparation?: LayoutPreparationController;
}) {
  const [state, setState] = useState<State>(),
    [error, setError] = useState<string>(),
    [refreshing, setRefreshing] = useState(false),
    epoch = useRef(0),
    active = useRef(true),
    busy = useRef(false);
  useEffect(() => {
    const generation = ++epoch.current;
    active.current = true;
    busy.current = false;
    setState(undefined);
    setError(undefined);
    setRefreshing(false);
    void reader
      .open(message)
      .then((v) => {
        if (active.current && generation === epoch.current) setState(v);
      })
      .catch(() => {
        if (active.current && generation === epoch.current)
          setError(
            "Cette proposition n’est pas disponible sur cet appareil. Synchronisez la discussion et le plan pour réessayer.",
          );
      });
    return () => {
      active.current = false;
    };
  }, [reader, message]);
  const refresh = async () => {
    if (busy.current) return;
    busy.current = true;
    const generation = epoch.current;
    setRefreshing(true);
    setError(undefined);
    try {
      const value = await reader.open(message);
      if (active.current && generation === epoch.current) setState(value);
    } catch {
      if (active.current && generation === epoch.current)
        setError(
          "Les sources n’ont pas pu être vérifiées. La proposition précédente reste conservée.",
        );
    } finally {
      if (generation === epoch.current) {
        busy.current = false;
        if (active.current) setRefreshing(false);
      }
    }
  };
  return (
    <View className="gap-3">
      {state ? (
        <StoreLayoutScenarioView
          state={state}
          error={error}
          renderPreparation={
            preparation
              ? () => (
                  <LayoutPreparationPanel
                    controller={preparation}
                    message={message}
                  />
                )
              : undefined
          }
          refreshing={refreshing}
          onRefresh={() => {
            void refresh();
          }}
          renderOriginal={(id) => (
            <CommercialOriginalButton sourceDocumentId={id} />
          )}
        />
      ) : (
        <Text className="text-muted">
          Vérification de la proposition d’implantation…
        </Text>
      )}
      {error && !state ? (
        <InlineAlert title="Proposition indisponible" message={error} />
      ) : null}
      {error && !state ? (
        <SecondaryButton
          label="Réessayer"
          disabled={refreshing}
          onPress={() => {
            void refresh();
          }}
        />
      ) : null}
    </View>
  );
}
