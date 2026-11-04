import { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import {
  emailSenderListSchema,
  type EmailSenderPolicy,
  type EmailSenderPolicyUpdate,
} from "@fl-copilot/sync-contracts";
import { PrimaryButton, SecondaryButton, InlineAlert } from "../components/ui";
import { colors } from "../design/tokens";

export function EmailSenderSettings({
  inbox,
  bindingId,
}: {
  inbox: {
    senderPolicy(): Promise<EmailSenderPolicy>;
    updateSenderPolicy(
      input: EmailSenderPolicyUpdate,
    ): Promise<EmailSenderPolicy>;
  };
  bindingId: string;
}) {
  const [open, setOpen] = useState(false),
    [policy, setPolicy] = useState<EmailSenderPolicy>(),
    [draft, setDraft] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [saved, setSaved] = useState(false);
  const epoch = useRef(0),
    pending = useRef(false);
  useEffect(() => {
    const token = ++epoch.current;
    setOpen(false);
    setPolicy(undefined);
    setDraft("");
    setError(undefined);
    setSaved(false);
    setBusy(false);
    pending.current = false;
    return () => {
      epoch.current = token + 1;
    };
  }, [bindingId, inbox]);
  async function run(save: boolean) {
    if (pending.current) return;
    const parsed = save
      ? emailSenderListSchema.safeParse(
          draft
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean),
        )
      : undefined;
    if (save && (!parsed?.success || !policy)) {
      setError(
        "Saisis entre 1 et 20 adresses email distinctes, une par ligne.",
      );
      return;
    }
    const token = epoch.current;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      const result =
        save && policy && parsed?.success
          ? await inbox.updateSenderPolicy({
              bindingId,
              expectedVersion: policy.version,
              allowedSenders: parsed.data,
            })
          : await inbox.senderPolicy();
      if (token !== epoch.current) return;
      if (result.bindingId !== bindingId) throw Error("Binding changed");
      setPolicy(result);
      setDraft(result.allowedSenders.join("\n"));
      setSaved(save);
    } catch {
      if (token === epoch.current)
        setError(
          "La liste ne peut pas être enregistrée ou relue. Vérifie ta connexion. Si elle a changé ailleurs, actualise-la avant de modifier.",
        );
    } finally {
      if (token === epoch.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <View style={{ gap: 12 }}>
      <SecondaryButton
        label={
          open ? "Fermer les expéditeurs" : "Gérer les expéditeurs autorisés"
        }
        disabled={busy}
        onPress={() => {
          setOpen(!open);
          if (!open && !policy) void run(false);
        }}
      />
      {open ? (
        <>
          <Text style={{ color: colors.ink, fontWeight: "600" }}>
            Expéditeurs autorisés
          </Text>
          <Text style={{ color: colors.muted }}>
            Une adresse par ligne. Les changements concernent les prochains
            envois ; les documents déjà reçus restent conservés.
          </Text>
          {error ? <InlineAlert title="À vérifier" message={error} /> : null}
          {policy ? (
            <>
              <TextInput
                accessibilityLabel="Adresses email autorisées"
                value={draft}
                maxLength={6500}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                editable={!busy}
                onChangeText={(value) => {
                  setDraft(value);
                  setSaved(false);
                }}
                style={{
                  minHeight: 120,
                  padding: 12,
                  borderWidth: 1,
                  borderColor: colors.line,
                  borderRadius: 12,
                  color: colors.ink,
                  textAlignVertical: "top",
                }}
              />
              <PrimaryButton
                label={busy ? "En cours…" : "Enregistrer les expéditeurs"}
                disabled={busy}
                onPress={() => void run(true)}
              />
            </>
          ) : busy ? (
            <Text style={{ color: colors.muted }}>
              Lecture de la configuration…
            </Text>
          ) : null}
          {saved ? (
            <Text
              accessibilityLiveRegion="polite"
              style={{ color: colors.forest }}
            >
              Expéditeurs enregistrés.
            </Text>
          ) : null}
          <SecondaryButton
            label="Actualiser la liste"
            disabled={busy}
            onPress={() => void run(false)}
          />
        </>
      ) : null}
    </View>
  );
}
