import { router, useLocalSearchParams } from "expo-router";
import { z } from "zod";
import { isVisualEntityType } from "@fl-copilot/domain";
import {
  AppScreen,
  AppHeader,
  InlineAlert,
  SecondaryButton,
} from "@/components/ui";
import { VisualRecoveryForm } from "@/products/visual-recovery";
export default function VisualRecoveryScreen() {
  const params = useLocalSearchParams<{ kind?: string; id?: string }>();
  const id = z.uuid().safeParse(params.id),
    kind = params.kind;
  return (
    <AppScreen>
      <AppHeader
        title="Reprendre le visuel"
        subtitle="Votre photo et votre choix restent conservés après un refus d’enregistrement."
      />
      {id.success && kind && isVisualEntityType(kind) ? (
        <VisualRecoveryForm
          kind={kind}
          id={id.data}
          onRecovered={() => router.back()}
        />
      ) : (
        <InlineAlert
          title="Modification indisponible"
          message="Ouvrez la modification à reprendre depuis Synchronisation ou la fiche produit."
        />
      )}
      <SecondaryButton label="Retour" onPress={() => router.back()} />
    </AppScreen>
  );
}
