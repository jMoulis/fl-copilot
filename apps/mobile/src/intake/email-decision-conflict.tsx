import { useEffect, useRef, useState } from "react";
import { Text } from "react-native";
import { router } from "expo-router";
import {
  emailIntakeDecisionSchema,
  type EmailIntakeDecision,
} from "@fl-copilot/sync-contracts";
import type { SyncConflict } from "../sync/conflict-repository";
import { useSync } from "../sync/sync-provider";
import { useAuth } from "../auth/auth-provider";
import { canDisplayConflict } from "../sync/private-conflict-scope";
import {
  InlineAlert,
  PrimaryButton,
  SecondaryButton,
  SectionCard,
} from "../components/ui";
export function EmailDecisionConflict({
  conflict,
}: {
  conflict: SyncConflict;
}) {
  const { session } = useAuth(),
    { emailIntake } = useSync();
  const local = emailIntakeDecisionSchema.safeParse(conflict.localPayload),
    remote = emailIntakeDecisionSchema.safeParse(conflict.remotePayload);
  const store = session?.stores.find(
    (store) => store.storeId === conflict.storeId,
  );
  if (
    !local.success ||
    !remote.success ||
    local.data.id !== remote.data.id ||
    local.data.conversationId !== remote.data.conversationId ||
    !canDisplayConflict(conflict, store?.storeId, session?.user.id)
  )
    return (
      <InlineAlert
        title="Comparaison indisponible"
        message="Actualisez la synchronisation avec le compte à l’origine de cet email."
      />
    );
  const permitted = store?.role === "MANAGER" && !!emailIntake;
  return (
    <EmailDecisionConflictView
      key={`${local.data.ownerId}:${local.data.actionId}:${remote.data.actionId}`}
      local={local.data}
      remote={remote.data}
      canAdopt={permitted}
      onAdopt={async () => {
        if (!emailIntake) throw Error("EMAIL_INTAKE_SESSION_REQUIRED");
        await emailIntake.adoptDecision(local.data.conversationId, conflict.id);
      }}
      onOpenConversation={() =>
        router.push({
          pathname: "/copilot",
          params: { conversationId: local.data.conversationId },
        })
      }
    />
  );
}
/** Presentation of actual permissions, not a claim that files have already been processed. */
export function EmailDecisionConflictView({
  local,
  remote,
  canAdopt,
  onAdopt,
  onOpenConversation,
}: {
  local: EmailIntakeDecision;
  remote: EmailIntakeDecision;
  canAdopt: boolean;
  onAdopt: () => Promise<void>;
  onOpenConversation: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [resolved, setResolved] = useState(false),
    [error, setError] = useState<string>();
  const pending = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function adopt() {
    if (pending.current || !canAdopt || resolved) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await onAdopt();
      if (mounted.current) setResolved(true);
    } catch {
      if (mounted.current)
        setError(
          "Le conflit ou vos droits ont changé. Votre choix et les fichiers restent conservés ; actualisez avant de réessayer.",
        );
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <>
      <SectionCard title="Votre choix">
        <DecisionSummary decision={local} />
      </SectionCard>
      <SectionCard title="Choix synchronisé">
        <DecisionSummary decision={remote} />
      </SectionCard>
      <SectionCard title="Résoudre le conflit">
        <Text className="text-base leading-6 text-muted">
          Cet email a déjà reçu une décision synchronisée. Utilisez le choix
          synchronisé pour éviter un second traitement. Les fichiers et les deux
          tentatives restent conservés.
        </Text>
        {resolved ? (
          <InlineAlert
            title="Conflit résolu"
            message="Le choix synchronisé est conservé. Cette résolution ne modifie pas les données métier déjà publiées."
          />
        ) : (
          <PrimaryButton
            label={busy ? "Résolution…" : "Utiliser le choix synchronisé"}
            disabled={!canAdopt || busy}
            onPress={() => void adopt()}
          />
        )}
        {!canAdopt ? (
          <InlineAlert
            title="Accès modifié"
            message="Le responsable du magasin doit résoudre cette confirmation."
          />
        ) : null}
        {error ? (
          <InlineAlert title="Résolution impossible" message={error} />
        ) : null}
        <SecondaryButton
          label="Ouvrir la conversation"
          disabled={busy}
          onPress={onOpenConversation}
        />
      </SectionCard>
    </>
  );
}
function DecisionSummary({ decision }: { decision: EmailIntakeDecision }) {
  return (
    <>
      <Text className="text-base font-semibold text-ink">
        {decision.choice === "ADMIT"
          ? `${decision.files.length} fichier${decision.files.length > 1 ? "s" : ""} admis pour traitement`
          : "Email écarté"}
      </Text>
      <Text className="text-sm text-muted">
        {new Date(decision.createdAt).toLocaleString("fr-FR")}
      </Text>
      {decision.choice === "ADMIT" ? (
        <Text className="text-sm leading-5 text-muted">
          La confirmation autorise le traitement. Elle ne signifie pas que les
          fichiers sont analysés ou publiés.
        </Text>
      ) : null}
    </>
  );
}
