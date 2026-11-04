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
    [draft, setDraft] = useState<string[]>([]),
    [address, setAddress] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [saved, setSaved] = useState(false);
  const epoch = useRef(0),
    pending = useRef(false);
  useEffect(() => {
    const token = ++epoch.current;
    setOpen(false);
    setPolicy(undefined);
    setDraft([]);
    setAddress("");
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
    if (save && address.trim()) {
      setError("Ajoute l’adresse saisie à la liste avant d’enregistrer.");
      return;
    }
    const parsed = save ? emailSenderListSchema.safeParse(draft) : undefined;
    if (save && (!parsed?.success || !policy)) {
      setError("Conserve au moins une adresse email autorisée.");
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
      setDraft(result.allowedSenders);
      setAddress("");
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
  function addAddress() {
    if (pending.current) return;
    const parsed = emailSenderListSchema.safeParse([...draft, address]);
    if (!parsed.success) {
      setError(
        "Saisis une adresse email valide, différente de celles de la liste (20 maximum).",
      );
      return;
    }
    setDraft(parsed.data);
    setAddress("");
    setError(undefined);
    setSaved(false);
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
            Ajoute ou retire une adresse, puis enregistre la liste. Les
            documents déjà reçus restent conservés.
          </Text>
          {error ? <InlineAlert title="À vérifier" message={error} /> : null}
          {policy ? (
            <>
              {draft.map((sender) => (
                <View
                  key={sender}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    paddingVertical: 8,
                    borderBottomWidth: 1,
                    borderColor: colors.line,
                  }}
                >
                  <Text selectable style={{ flex: 1, color: colors.ink }}>
                    {sender}
                  </Text>
                  <SecondaryButton
                    label="Retirer"
                    accessibilityLabel={`Retirer ${sender}`}
                    disabled={busy}
                    onPress={() => {
                      if (pending.current) return;
                      setDraft((values) =>
                        values.filter((value) => value !== sender),
                      );
                      setSaved(false);
                      setError(undefined);
                    }}
                  />
                </View>
              ))}
              <TextInput
                accessibilityLabel="Nouvelle adresse email"
                placeholder="Nouvelle adresse email"
                placeholderTextColor={colors.muted}
                value={address}
                maxLength={320}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                editable={!busy && draft.length < 20}
                onSubmitEditing={addAddress}
                onChangeText={(value) => {
                  if (pending.current) return;
                  setAddress(value);
                  setSaved(false);
                }}
                style={{
                  minHeight: 48,
                  padding: 12,
                  borderWidth: 1,
                  borderColor: colors.line,
                  borderRadius: 12,
                  color: colors.ink,
                }}
              />
              <SecondaryButton
                label="Ajouter"
                disabled={busy || draft.length >= 20 || !address.trim()}
                onPress={addAddress}
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
