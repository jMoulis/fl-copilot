import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import type { CopilotMessage } from "@fl-copilot/domain";
import { InlineAlert, PrimaryButton, SecondaryButton } from "../components/ui";
import type { LayoutPreparationController } from "./layout-preparation-controller";
import { commercialPreparationError } from "../commercial/preparation-presentation";
import { useSync } from "../sync/sync-provider";
type State = Awaited<ReturnType<LayoutPreparationController["open"]>>;
export function LayoutPreparationReview({
  state,
  busy,
  error,
  onConfirm,
  onRefresh,
  onOpen,
}: {
  state?: State;
  busy: boolean;
  error?: string;
  onConfirm: () => void;
  onRefresh: () => void;
  onOpen: () => void;
}) {
  const old = state?.before?.physicalAllocation;
  return (
    <View className="gap-3 rounded-xl border border-line p-3">
      <Text className="font-semibold text-ink">Ma préparation commerciale</Text>
      {state?.status === "COMPLETED" ? (
        <>
          <Text className="text-ink">
            Implantation enregistrée dans la version{" "}
            {state.result.preparationVersion} du brouillon.
          </Text>
          <Text className="text-muted">
            La préparation actuelle peut avoir évolué depuis. Le plan commercial
            n’est pas validé par cet enregistrement, et aucune mise en place
            n’est déclarée.
          </Text>
          <SecondaryButton
            label="Voir la préparation actuelle"
            onPress={onOpen}
          />
        </>
      ) : state?.status === "READY" ? (
        <>
          <Text className="text-ink">
            {state.before
              ? `Mettre à jour le brouillon v${state.before.version}`
              : "Créer le brouillon de cette semaine"}{" "}
            ·{" "}
            {state.after.offerRefs.length -
              (state.before?.offerRefs.length ?? 0)}{" "}
            offre(s) ajoutée(s).
          </Text>
          <Text className="text-muted">
            Les notes, TG commerciales et autres offres du brouillon sont
            conservées. Les produits hors offre restent des produits
            d’assortiment ; aucune offre promotionnelle n’est créée pour eux.
          </Text>
          {old ? (
            <View className="gap-2">
              <Text className="font-semibold text-ink">
                Implantation actuellement enregistrée, qui sera remplacée
              </Text>
              {old.assignments.map((a, i) => (
                <Text key={i} className="text-muted">
                  {a.targetLabel} :{" "}
                  {a.items
                    .map(
                      (r) =>
                        old.items.find(
                          (x) => x.id === r.id && x.kind === r.kind,
                        )!.label,
                    )
                    .join(", ")}
                </Text>
              ))}
            </View>
          ) : null}
          <Text className="text-muted">
            Seule l’implantation proposée ci-dessus sera liée au brouillon. Vous
            validerez le plan commercial séparément.
          </Text>
          <PrimaryButton
            label={
              busy
                ? "Enregistrement…"
                : "Enregistrer l’implantation dans le brouillon"
            }
            disabled={busy}
            onPress={onConfirm}
          />
        </>
      ) : !error ? (
        <Text className="text-muted">
          Vérification du brouillon et des sources…
        </Text>
      ) : null}
      {error ? (
        <InlineAlert title="Implantation non enregistrée" message={error} />
      ) : null}
      {state?.status !== "COMPLETED" ? (
        <SecondaryButton
          label="Actualiser la comparaison"
          disabled={busy}
          onPress={onRefresh}
        />
      ) : null}
    </View>
  );
}
export function LayoutPreparationPanel({
  controller,
  message,
}: {
  controller: LayoutPreparationController;
  message: CopilotMessage;
}) {
  const [state, setState] = useState<State>(),
    [error, setError] = useState<string>(),
    [busy, setBusy] = useState(false),
    active = useRef(true),
    working = useRef(false),
    generation = useRef(0),
    cancel = useRef<AbortController | undefined>(undefined);
  const { syncNow } = useSync();
  useEffect(() => {
    const g = ++generation.current;
    active.current = true;
    working.current = false;
    setState(undefined);
    setBusy(false);
    setError(undefined);
    void controller
      .open(message)
      .then((s) => {
        if (active.current && g === generation.current) setState(s);
      })
      .catch((e) => {
        if (active.current && g === generation.current)
          setError(
            commercialPreparationError(
              e instanceof Error ? e.message : undefined,
            ),
          );
      });
    return () => {
      active.current = false;
      cancel.current?.abort();
    };
  }, [controller, message]);
  async function run(confirm: boolean) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError(undefined);
    const g = generation.current,
      abort = new AbortController();
    cancel.current = abort;
    try {
      const next =
        confirm && state?.status === "READY"
          ? await controller.confirm(message, state.before, abort.signal)
          : await controller.open(message);
      if (active.current && g === generation.current) {
        setState(next);
        if (confirm) void syncNow(message.storeId).catch(() => undefined);
      }
    } catch (e) {
      if (active.current && g === generation.current)
        setError(
          commercialPreparationError(
            e instanceof Error ? e.message : undefined,
          ),
        );
    } finally {
      if (g === generation.current) {
        working.current = false;
        if (active.current) setBusy(false);
      }
    }
  }
  return (
    <LayoutPreparationReview
      state={state}
      error={error}
      busy={busy}
      onConfirm={() => {
        void run(true);
      }}
      onRefresh={() => {
        void run(false);
      }}
      onOpen={() =>
        router.push({
          pathname: "/week-preparation",
          params: { weekStart: JSON.parse(message.text).scenario.weekStart },
        })
      }
    />
  );
}
