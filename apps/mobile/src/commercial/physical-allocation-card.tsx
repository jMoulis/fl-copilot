import { useEffect, useState, useRef, useCallback } from "react";
import type { StoreLayoutScenario } from "@fl-copilot/domain";
import { StoreLayoutScenarioView } from "../copilot/store-layout-scenario-card";
import { useLocalDatabase } from "../providers/database-provider";
import { readPhysicalAllocationSources } from "./physical-allocation-sources";
import { assertPhysicalAllocationCurrent } from "@fl-copilot/commercial-core";
import { StoreLayoutRepository } from "../store/layout-repository";
import { CommercialOriginalButton } from "./original-button";
import { joinedProductToolDatabase } from "../copilot/product-tool-transaction";
import { Text, View } from "react-native";
import { InlineAlert, SecondaryButton } from "../components/ui";
type State = Omit<
  Awaited<
    ReturnType<
      import("../copilot/store-layout-scenario-reader").CopilotStoreLayoutScenarioReader["open"]
    >
  >,
  "message"
>;
export function PhysicalAllocationCard({
  scenario,
}: {
  scenario: StoreLayoutScenario;
}) {
  const { sqlite } = useLocalDatabase(),
    [state, setState] = useState<State>(),
    [error, setError] = useState<string>(),
    [busy, setBusy] = useState(false),
    epoch = useRef(0),
    running = useRef(false),
    active = useRef(true);
  const load = useCallback(async () => {
    let next: State | undefined;
    await sqlite.withExclusiveTransactionAsync(async (tx) => {
      const layout = await new StoreLayoutRepository(
        joinedProductToolDatabase(tx),
        () => {
          throw Error("READ_ONLY");
        },
      ).getRevision(scenario.storeId, scenario.physicalRevisionId);
      let freshness: State["freshness"] = "CURRENT",
        issues: string[] = [];
      try {
        const sources = await readPhysicalAllocationSources(
          tx,
          scenario.storeId,
          scenario,
        );
        if (
          !layout ||
          !sources.layout.head ||
          !sources.layout.reference ||
          scenario.items.some(
            (i) =>
              !sources.products.some((p) => p.id === i.productId) ||
              (i.kind === "OFFER" &&
                !sources.choices.some((c) => c.id === i.id)),
          )
        ) {
          freshness = "UNVERIFIABLE";
          issues = [
            "Certaines sources manquent sur cet appareil. Synchronisez pour les retrouver ; les affectations d’origine restent conservées.",
          ];
        } else
          assertPhysicalAllocationCurrent(scenario.storeId, scenario, sources);
      } catch {
        freshness = "REVIEW_REQUIRED";
        issues = [
          "Le plan ou une référence doit être revu. Cette implantation conserve son schéma et ses affectations d’origine.",
        ];
      }
      next = { scenario, layout, freshness, issues };
    });
    if (!next) throw Error("UNAVAILABLE");
    return next;
  }, [sqlite, scenario]);
  useEffect(() => {
    const g = ++epoch.current;
    active.current = true;
    running.current = false;
    setState(undefined);
    setError(undefined);
    setBusy(false);
    void load()
      .then((v) => {
        if (active.current && g === epoch.current) setState(v);
      })
      .catch(() => {
        if (active.current && g === epoch.current)
          setError(
            "L’implantation reste enregistrée, mais ses sources ne peuvent pas être lues sur cet appareil.",
          );
      });
    return () => {
      active.current = false;
    };
  }, [load]);
  async function refresh() {
    if (running.current) return;
    running.current = true;
    const g = epoch.current;
    setBusy(true);
    setError(undefined);
    try {
      const v = await load();
      if (active.current && g === epoch.current) setState(v);
    } catch {
      if (active.current && g === epoch.current)
        setError(
          "La vérification a échoué. Le schéma précédent reste conservé.",
        );
    } finally {
      if (g === epoch.current) {
        running.current = false;
        if (active.current) setBusy(false);
      }
    }
  }
  return state ? (
    <StoreLayoutScenarioView
      saved
      state={state}
      error={error}
      refreshing={busy}
      onRefresh={() => {
        void refresh();
      }}
      renderOriginal={(id) => (
        <CommercialOriginalButton sourceDocumentId={id} />
      )}
    />
  ) : (
    <View className="gap-3">
      {error ? (
        <>
          <InlineAlert title="Implantation à vérifier" message={error} />
          <SecondaryButton
            label="Réessayer"
            disabled={busy}
            onPress={() => {
              void refresh();
            }}
          />
        </>
      ) : (
        <Text className="text-muted">
          Lecture de l’implantation enregistrée…
        </Text>
      )}
    </View>
  );
}
