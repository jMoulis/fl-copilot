import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { copilotMessageSchema, type CopilotMessage } from "@fl-copilot/domain";
import { InlineAlert, SecondaryButton } from "../components/ui";
import { useReviewedConflict } from "../components/use-reviewed-conflict";
import {
  VisualRecoveryChoices,
  visualRecoverySelectionReady,
  type VisualRecoverySelection,
} from "../products/visual-recovery-choices";
import type { CopilotVisualActionController } from "./visual-action-controller";
type Review = Awaited<
  ReturnType<CopilotVisualActionController["openRecovery"]>
>;
type Selected = {
  scope: object;
  review: Review;
  kind: string;
  id: string;
  value: VisualRecoverySelection;
};
export function VisualRecoveryCard({
  message,
  controller,
  canConfirm,
  onSaved,
  retryFile,
}: {
  message: CopilotMessage;
  controller: CopilotVisualActionController;
  canConfirm: boolean;
  onSaved(): void;
  retryFile?: (assetId: string) => Promise<void>;
}) {
  const messageJson = JSON.stringify(message);
  const scope = useMemo(
    () => ({ messageJson, controller, canConfirm }),
    [messageJson, controller, canConfirm],
  );
  const [selected, setSelected] = useState<Selected>(),
    [completed, setCompleted] = useState<{
      scope: object;
      result: NonNullable<Review["result"]>;
    }>(),
    [fileNotice, setFileNotice] = useState<{ scope: object; text: string }>();
  const committed = useRef<Selected | undefined>(undefined);
  useLayoutEffect(() => {
    committed.current = selected;
    return () => {
      if (committed.current === selected) committed.current = undefined;
    };
  }, [selected]);
  const read = useCallback(
    () =>
      controller.openRecovery(
        copilotMessageSchema.parse(JSON.parse(messageJson)),
      ),
    [controller, messageJson],
  );
  const state = useReviewedConflict({
    scope,
    read,
    canChoose: (r) => {
      const target = r.review?.targets.find(
        (t) => t.kind === selected?.kind && t.id === selected?.id,
      );
      return (
        canConfirm &&
        selected?.scope === scope &&
        selected.review === r &&
        committed.current === selected &&
        r.status === "READY" &&
        !!target &&
        visualRecoverySelectionReady(target.review, selected.value)
      );
    },
    choose: async (r, _local, lifetime) => {
      const capture = selected,
        target = r.review?.targets.find(
          (t) => t.kind === capture?.kind && t.id === capture?.id,
        );
      if (
        !capture ||
        !target ||
        capture.review !== r ||
        !capture.value.action ||
        !r.review
      )
        throw Error("VISUAL_RECOVERY_STALE");
      const result = await controller.confirmRecovery(
        r.message,
        {
          basisHash: r.review.basisHash,
          kind: target.kind,
          entityId: target.id,
          recoveryAction: capture.value.action,
          comparisonReviewed: true,
          reactivate: capture.value.reactivate,
          rightsConfirmed: capture.value.rightsConfirmed,
        },
        lifetime.signal,
        () => lifetime.canResolve() && committed.current === capture,
      );
      if (lifetime.canResolve() && result.result) {
        setCompleted({ scope, result: result.result });
        if (result.result.retryFileAssetId && retryFile)
          void Promise.resolve()
            .then(() =>
              lifetime.canResolve()
                ? retryFile(result.result!.retryFileAssetId!)
                : undefined,
            )
            .catch(() => {
              if (lifetime.canResolve())
                setFileNotice({
                  scope,
                  text: "La reprise du choix est enregistrée. Le fichier reste à envoyer ou à télécharger ; son état est suivi dans Synchronisation.",
                });
            });
      }
    },
    onSuccess: () => {
      try {
        onSaved();
      } catch {
        /* The metadata decision is already committed. */
      }
    },
    errorText: () =>
      "Le choix ou les droits ont changé. La reprise n’a pas été appliquée ; relisez les informations avant de confirmer.",
  });
  const r = state.review,
    done = completed?.scope === scope || r?.status === "COMPLETED";
  const selection =
    selected?.scope === scope && selected.review === r ? selected : undefined;
  const target = r?.review?.targets.find(
    (t) => t.kind === selection?.kind && t.id === selection?.id,
  );
  const editable =
    canConfirm && r?.status === "READY" && !done && state.isCurrent();
  const change = (value: VisualRecoverySelection) => {
    if (!editable || !selection || committed.current !== selection) return;
    setSelected({ ...selection, value });
    state.setCompared(value.checked);
  };
  return (
    <View style={{ gap: 12, padding: 16 }}>
      {state.reading ? (
        <ActivityIndicator accessibilityLabel="Lecture des choix visuels refusés" />
      ) : null}
      {done ? (
        <InlineAlert
          title="Reprise enregistrée"
          message="La décision est conservée sur cet appareil. L’envoi des métadonnées et des fichiers reste suivi dans Synchronisation. Les autres éléments éventuels demandent leur propre revue."
        />
      ) : null}
      {!canConfirm ? (
        <InlineAlert
          title="Droits nécessaires"
          message="Un responsable de ce magasin doit confirmer la reprise."
        />
      ) : null}
      {r?.status === "UNCHANGED" ? (
        <InlineAlert
          title="Aucun choix refusé à reprendre"
          message="La lecture locale n’a trouvé aucun choix visuel refusé lié à ce produit. Cela ne confirme pas la disponibilité de l’image sur le serveur."
        />
      ) : null}
      {r?.status === "STALE" ? (
        <InlineAlert
          title="Fiche modifiée"
          message="La fiche a changé depuis cette demande. Demandez une nouvelle revue au copilote ; aucun choix n’a été appliqué."
        />
      ) : null}
      {r?.review && !done
        ? r.review.targets.map((t) => (
            <SecondaryButton
              key={`${t.kind}:${t.id}`}
              label={`${target === t ? "✓ " : ""}${t.label}`}
              disabled={!editable}
              onPress={() => {
                if (!state.isCurrent() || !canConfirm) return;
                setSelected({
                  scope,
                  review: r,
                  kind: t.kind,
                  id: t.id,
                  value: {
                    action: null,
                    checked: false,
                    reactivate: false,
                    rightsConfirmed: false,
                  },
                });
                state.setCompared(false);
              }}
            />
          ))
        : null}
      {target && selection && !done ? (
        <VisualRecoveryChoices
          review={target.review}
          selection={selection.value}
          busy={state.busy || state.reading || !canConfirm || !!state.error}
          canConfirm={canConfirm && editable && state.compared}
          onAction={(action) =>
            change({
              action,
              checked: false,
              reactivate: false,
              rightsConfirmed: false,
            })
          }
          onChecked={() =>
            change({ ...selection.value, checked: !selection.value.checked })
          }
          onReactivate={() =>
            change({
              ...selection.value,
              reactivate: !selection.value.reactivate,
            })
          }
          onRights={() =>
            change({
              ...selection.value,
              rightsConfirmed: !selection.value.rightsConfirmed,
            })
          }
          onConfirm={() => {
            if (selection && committed.current === selection)
              void state.resolve(true);
          }}
        />
      ) : null}
      {state.error ? (
        <InlineAlert title="Reprise à vérifier" message={state.error} />
      ) : null}
      {fileNotice?.scope === scope ? (
        <InlineAlert
          title="Fichier encore en attente"
          message={fileNotice.text}
        />
      ) : null}
      {!done ? (
        <SecondaryButton
          label="Relire les choix locaux"
          disabled={state.busy || state.reading}
          onPress={() => {
            setSelected(undefined);
            state.reload();
          }}
        />
      ) : null}
    </View>
  );
}
