import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { randomUUID } from "expo-crypto";
import { z } from "zod";
import type { EmailIntakeReceipt } from "@fl-copilot/sync-contracts";
import type { SyncContextValue } from "../sync/sync-provider";
import { InlineAlert, PrimaryButton, SecondaryButton } from "../components/ui";
import { colors } from "../design/tokens";
import { MAX_RECEIPT_VIEWS } from "@fl-copilot/domain";
import {
  newEmailAdmissionSelection,
  selectedEmailFiles,
  groupEmailTicketViews,
  setEmailFilePurpose,
  separateEmailTickets,
  emailAdmissionFiles,
  type EmailAdmissionSelection,
  type EmailFilePurpose,
} from "./email-admission-selection";
import {
  EmailProcessingControls,
  type EmailProcessingControlsPort,
} from "./email-processing-controls";
type Inbox = Pick<
  NonNullable<SyncContextValue["emailIntake"]>,
  | "status"
  | "list"
  | "refresh"
  | "createBinding"
  | "revokeBinding"
  | "decision"
  | "decide"
> &
  EmailProcessingControlsPort;
type Cached = Awaited<ReturnType<Inbox["list"]>>;
/** Refresh on focus/ordinary sync only; never add a second inbox polling loop. */
export function EmailInboxIndicator({
  inbox,
  conversationId,
  revision,
  configurationRevision,
  onOpen,
}: {
  inbox: Inbox;
  conversationId: string;
  revision?: string;
  configurationRevision: number;
  onOpen(): void;
}) {
  const [count, setCount] = useState(0);
  const available = useRef<boolean | undefined>(undefined);
  const setupRevision = useRef(configurationRevision);
  const checkedRevision = useRef<string | undefined>(undefined);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (setupRevision.current !== configurationRevision) {
        setupRevision.current = configurationRevision;
        available.current = undefined;
      }
      async function read() {
        const cached = await inbox.list(conversationId);
        if (active)
          setCount(
            cached.receipts.filter((receipt) => receipt.status !== "DISMISSED")
              .length,
          );
      }
      void (async () => {
        try {
          await read();
          if (!active) return;
          if (
            available.current === undefined ||
            checkedRevision.current !== revision
          ) {
            const enabled = await inbox.status(conversationId);
            if (!active) return;
            available.current = enabled;
            checkedRevision.current = revision;
          }
          if (!active || !available.current) return;
          await inbox.refresh(conversationId);
          if (active) await read();
        } catch {
          /* Preserve the local indicator; the explicit screen explains read/network errors. */
        }
      })();
      return () => {
        active = false;
      };
    }, [inbox, conversationId, revision, configurationRevision]),
  );
  if (!count) return null;
  return (
    <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
      <SecondaryButton
        label={`${count} email${count > 1 ? "s" : ""} reçu${count > 1 ? "s" : ""}`}
        onPress={onOpen}
      />
    </View>
  );
}
/** Remote configuration is explicit; already received documents render from SQLite first. */
export function EmailInbox({
  inbox,
  conversationId,
  initialSender,
  revision,
  onClose,
  onOpenSync,
}: {
  inbox: Inbox;
  conversationId: string;
  initialSender: string;
  revision?: string;
  onClose(): void;
  onOpenSync(conflictId?: string): void;
}) {
  const [cached, setCached] = useState<Cached>({ bindings: [], receipts: [] }),
    [enabled, setEnabled] = useState<boolean>(),
    [bindingKnown, setBindingKnown] = useState(false),
    [error, setError] = useState<string>(),
    [busy, setBusy] = useState(false),
    [sender, setSender] = useState(initialSender),
    [next, setNext] = useState<string | null>(null),
    [open, setOpen] = useState<string>(),
    [revoking, setRevoking] = useState<string>();
  const alive = useRef(true),
    pending = useRef(false),
    bindingRequest = useRef<{ sender: string; id: string } | undefined>(
      undefined,
    );
  const loadEpoch = useRef(0);
  const selections = useRef(new Map<string, EmailAdmissionSelection>());
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const load = useCallback(async () => {
    const epoch = ++loadEpoch.current;
    const value = await inbox.list(conversationId);
    if (alive.current && epoch === loadEpoch.current) setCached(value);
  }, [inbox, conversationId]);
  useEffect(() => {
    void load().catch(() => {
      if (alive.current)
        setError(
          "Les documents locaux ne peuvent pas être relus. Réessayez ; les fichiers restent conservés.",
        );
    });
  }, [load, revision]);
  const run = useCallback(
    async (work: () => Promise<void>, message: string) => {
      if (pending.current) return;
      pending.current = true;
      setBusy(true);
      setError(undefined);
      try {
        await work();
      } catch {
        if (alive.current) setError(message);
      } finally {
        pending.current = false;
        if (alive.current) setBusy(false);
      }
    },
    [],
  );
  const refresh = useCallback(
    async (cursor?: string) => {
      await run(async () => {
        if (alive.current) setBindingKnown(false);
        // Retrying local reading must not depend on a successful network request.
        await load();
        const available = await inbox.status(conversationId);
        if (alive.current) setEnabled(available);
        if (available) {
          const continuation = await inbox.refresh(conversationId, cursor);
          if (alive.current) setNext(continuation);
        }
        await load();
        if (alive.current) setBindingKnown(available);
      }, "La réception ne peut pas être actualisée. Les documents déjà chargés restent disponibles.");
    },
    [inbox, conversationId, run, load],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const active = cached.bindings.filter((binding) => !binding.revokedAt);
  const invalidSender =
    error === "Saisissez une adresse email valide pour l’expéditeur.";
  async function create() {
    const parsed = z.email().max(320).safeParse(sender.trim().toLowerCase());
    if (!parsed.success) {
      setError("Saisissez une adresse email valide pour l’expéditeur.");
      return;
    }
    if (bindingRequest.current?.sender !== parsed.data)
      bindingRequest.current = { sender: parsed.data, id: randomUUID() };
    const request = bindingRequest.current;
    await run(async () => {
      await inbox.createBinding(conversationId, request.id, request.sender);
      await load();
    }, "L’adresse ne peut pas être créée. Vérifiez la connexion et la synchronisation de cette conversation, puis réessayez.");
  }
  return (
    <SafeAreaView
      edges={["top", "bottom", "left", "right"]}
      style={{ flex: 1, backgroundColor: colors.canvas }}
    >
      <View style={{ padding: 20, gap: 12 }}>
        <Text
          accessibilityRole="header"
          style={{ fontSize: 24, fontWeight: "700", color: colors.ink }}
        >
          Documents reçus par email
        </Text>
        <SecondaryButton label="Revenir au chat" onPress={onClose} />
      </View>
      <FlatList
        data={cached.receipts}
        keyExtractor={(receipt) => receipt.id}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }}
        ListHeaderComponent={
          <View style={{ gap: 16 }}>
            <Text style={{ color: colors.muted, lineHeight: 22 }}>
              Envoyez les fichiers à l’adresse de cette conversation, puis
              confirmez les documents à traiter ici.
            </Text>
            {error ? <InlineAlert title="À vérifier" message={error} /> : null}
            {enabled === false ? (
              <InlineAlert
                title="Réception non activée"
                message="L’adresse de réception n’est pas encore configurée. Les documents déjà conservés sur ce téléphone restent consultables."
              />
            ) : null}
            {active.map((binding) => (
              <View
                key={binding.id}
                style={{
                  padding: 16,
                  borderWidth: 1,
                  borderColor: colors.line,
                  borderRadius: 16,
                  gap: 12,
                }}
              >
                <Text selectable style={{ color: colors.ink, fontSize: 16 }}>
                  {binding.recipient}
                </Text>
                <Text style={{ color: colors.muted }}>
                  Expéditeur prévu : {binding.allowedSender}
                </Text>
                <SecondaryButton
                  label="Copier l’adresse"
                  disabled={busy}
                  onPress={() => {
                    void run(async () => {
                      const clipboard = await import("expo-clipboard");
                      if (!(await clipboard.setStringAsync(binding.recipient)))
                        throw Error("clipboard unavailable");
                    }, "La copie a échoué. Vous pouvez sélectionner l’adresse affichée.");
                  }}
                />
                {revoking === binding.id ? (
                  <View style={{ gap: 12 }}>
                    <InlineAlert
                      title="Retirer cette adresse ?"
                      message="Les prochains emails ne seront plus reçus ici. Les fichiers déjà conservés sont maintenus."
                    />
                    <PrimaryButton
                      label="Confirmer le retrait"
                      disabled={busy}
                      onPress={() =>
                        void run(async () => {
                          await inbox.revokeBinding(conversationId, binding.id);
                          await load();
                          if (alive.current) setRevoking(undefined);
                        }, "Le retrait ne peut pas être vérifié. Actualisez avant de réutiliser cette adresse.")
                      }
                    />
                    <SecondaryButton
                      label="Conserver cette adresse"
                      disabled={busy}
                      onPress={() => setRevoking(undefined)}
                    />
                  </View>
                ) : (
                  <SecondaryButton
                    label="Retirer cette adresse"
                    disabled={busy}
                    onPress={() => setRevoking(binding.id)}
                  />
                )}
              </View>
            ))}
            {!active.length && enabled === true ? (
              <View style={{ gap: 12 }}>
                {!bindingKnown ? (
                  <Text style={{ color: colors.muted }}>
                    Actualisez la configuration avant de créer une adresse.
                  </Text>
                ) : null}
                <Text style={{ color: colors.muted }}>
                  Depuis quelle adresse enverrez-vous les documents ?
                </Text>
                <TextInput
                  value={sender}
                  onChangeText={(text) => {
                    setSender(text);
                    if (invalidSender) setError(undefined);
                  }}
                  editable={!busy}
                  accessibilityLabel="Adresse email de l’expéditeur"
                  accessibilityHint={invalidSender ? error : undefined}
                  aria-invalid={invalidSender}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{
                    borderColor: invalidSender ? colors.critical : colors.line,
                    borderWidth: 1,
                    borderRadius: 12,
                    padding: 14,
                    color: colors.ink,
                    backgroundColor: colors.surface,
                  }}
                />
                <PrimaryButton
                  label="Créer l’adresse de réception"
                  disabled={busy || !bindingKnown}
                  onPress={() => void create()}
                />
              </View>
            ) : null}
            <SecondaryButton
              label={busy ? "Actualisation…" : "Actualiser la réception"}
              disabled={busy}
              onPress={() => void refresh()}
            />
          </View>
        }
        ListEmptyComponent={
          <Text style={{ color: colors.muted, paddingVertical: 20 }}>
            Aucun email chargé dans cette conversation.
          </Text>
        }
        renderItem={({ item }) => (
          <EmailReceivedCard
            key={item.id}
            inbox={inbox}
            receipt={item}
            conversationId={conversationId}
            revision={revision}
            expanded={open === item.id}
            onExpand={() => setOpen(open === item.id ? undefined : item.id)}
            selection={selections.current}
            onChanged={load}
            onOpenSync={onOpenSync}
          />
        )}
        ListFooterComponent={
          next ? (
            <SecondaryButton
              label="Charger les emails précédents"
              disabled={busy}
              onPress={() => void refresh(next)}
            />
          ) : null
        }
      />
    </SafeAreaView>
  );
}
function EmailReceivedCard({
  inbox,
  receipt,
  conversationId,
  revision,
  expanded,
  onExpand,
  selection,
  onChanged,
  onOpenSync,
}: {
  inbox: Inbox;
  receipt: EmailIntakeReceipt;
  conversationId: string;
  revision?: string;
  expanded: boolean;
  onExpand(): void;
  selection: Map<string, EmailAdmissionSelection>;
  onChanged(): Promise<void>;
  onOpenSync(conflictId?: string): void;
}) {
  const [decision, setDecision] =
      useState<Awaited<ReturnType<Inbox["decision"]>>>(null),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [discarding, setDiscarding] = useState(false),
    [grouping, setGrouping] = useState(false),
    [views, setViews] = useState<Set<string>>(new Set()),
    [purposeFile, setPurposeFile] = useState<string>(),
    [error, setError] = useState<string>(),
    [, changed] = useState(0);
  const alive = useRef(true),
    pending = useRef(false),
    readEpoch = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    const epoch = ++readEpoch.current;
    setLoaded(false);
    void inbox
      .decision(conversationId, receipt.id)
      .then((value) => {
        if (current && epoch === readEpoch.current) {
          setDecision(value);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (current && epoch === readEpoch.current)
          setError("La confirmation ne peut pas être relue.");
      });
    return () => {
      current = false;
    };
  }, [inbox, conversationId, receipt.id, receipt.version, revision]);
  let draft = selection.get(receipt.id);
  if (!draft) {
    draft = newEmailAdmissionSelection();
    selection.set(receipt.id, draft);
  }
  const selected = selectedEmailFiles(receipt, draft);
  const groups = new Map<string, string[]>();
  for (const file of selected) {
    const group = draft.tickets.get(file.id);
    if (group) groups.set(group, [...(groups.get(group) ?? []), file.id]);
  }
  function choosePurpose(fileId: string, purpose: EmailFilePurpose) {
    if (busy || !canChoose) return;
    try {
      setEmailFilePurpose(receipt, draft!, fileId, purpose);
      changed((value) => value + 1);
      setPurposeFile(undefined);
      setError(undefined);
    } catch {
      setError(
        "La sélection a changé. Vérifiez les fichiers avant de confirmer.",
      );
    }
  }
  function groupViews() {
    if (busy || !canChoose) return;
    try {
      groupEmailTicketViews(receipt, draft!, [...views], randomUUID);
      setViews(new Set());
      setGrouping(false);
      changed((value) => value + 1);
      setError(undefined);
    } catch {
      setError(
        `Choisissez entre 2 et ${MAX_RECEIPT_VIEWS} photos sélectionnées du même ticket.`,
      );
    }
  }
  const canChoose =
    loaded && !decision && receipt.status === "AWAITING_CONFIRMATION";
  async function decide(choice: "ADMIT" | "DISMISS") {
    if (
      pending.current ||
      !canChoose ||
      grouping ||
      (choice === "ADMIT" && !selected.length)
    )
      return;
    pending.current = true;
    readEpoch.current++;
    setBusy(true);
    setError(undefined);
    try {
      const files =
        choice === "ADMIT"
          ? emailAdmissionFiles(receipt, draft!, randomUUID)
          : [];
      const value = await inbox.decide({
        conversationId,
        receiptId: receipt.id,
        choice,
        files,
      });
      if (alive.current) setDecision({ decision: value, state: "PENDING" });
      await onChanged();
    } catch {
      if (alive.current)
        setError(
          "Le choix n’a pas pu être enregistré. Actualisez les documents ; les fichiers et votre sélection restent conservés.",
        );
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const status =
    decision?.state === "CONFLICT"
      ? "Choix à comparer"
      : decision?.state === "ERROR"
        ? "Confirmation à examiner"
        : decision?.state === "PENDING"
          ? "Choix à synchroniser"
          : decision?.decision.choice === "DISMISS" ||
              receipt.status === "DISMISSED"
            ? "Email écarté"
            : decision?.state === "SYNCED" &&
                decision.decision.choice === "ADMIT"
              ? "Fichiers confirmés"
              : receipt.status === "AWAITING_CONFIRMATION"
                ? "À confirmer"
                : receipt.status === "QUARANTINED"
                  ? "Email à examiner"
                  : receipt.status === "COMPLETE"
                    ? "Traitement terminé"
                    : receipt.status === "PARTIAL"
                      ? "Traitement partiel"
                      : receipt.status === "PROCESSING"
                        ? "Traitement en cours"
                        : "Fichiers confirmés";
  return (
    <View
      style={{
        padding: 16,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: 16,
        gap: 12,
      }}
    >
      <Text style={{ color: colors.ink, fontWeight: "600", fontSize: 17 }}>
        {receipt.subject || "Email sans objet"}
      </Text>
      <Text style={{ color: colors.muted }}>
        {receipt.sender} ·{" "}
        {new Date(receipt.receivedAt).toLocaleDateString("fr-FR")}
      </Text>
      <Text style={{ color: colors.forest }}>
        {receipt.files.length} pièce
        {receipt.files.length > 1 ? "s jointes" : " jointe"} · {status}
      </Text>
      {decision?.decision.choice === "ADMIT" ? (
        <Text style={{ color: colors.muted }}>
          {decision.decision.files.length} fichier
          {decision.decision.files.length > 1 ? "s" : ""} confirmé
          {decision.decision.files.length > 1 ? "s" : ""} ·{" "}
          {receipt.files.length - decision.decision.files.length} non
          sélectionné
          {receipt.files.length - decision.decision.files.length > 1 ? "s" : ""}
        </Text>
      ) : null}
      <SecondaryButton
        label={expanded ? "Masquer les fichiers" : "Voir les fichiers"}
        onPress={onExpand}
      />
      {canChoose && expanded ? (
        <View style={{ gap: 10 }}>
          {grouping ? (
            <>
              <InlineAlert
                title="Vues d’un même ticket"
                message={`Cochez de 2 à ${MAX_RECEIPT_VIEWS} photos du même ticket. Les autres fichiers garderont leur traitement indépendant.`}
              />
              <PrimaryButton
                label={`Regrouper ces ${views.size} vues`}
                disabled={
                  busy || views.size < 2 || views.size > MAX_RECEIPT_VIEWS
                }
                onPress={groupViews}
              />
              <SecondaryButton
                label="Annuler le regroupement"
                disabled={busy}
                onPress={() => {
                  setGrouping(false);
                  setViews(new Set());
                  setError(undefined);
                }}
              />
            </>
          ) : selected.length >= 2 ? (
            <SecondaryButton
              label="Regrouper les vues d’un même ticket"
              disabled={busy}
              onPress={() => {
                setGrouping(true);
                setViews(new Set());
                setPurposeFile(undefined);
                setError(undefined);
              }}
            />
          ) : null}
          {!grouping
            ? [...groups].map(([group, files], index) => (
                <View key={group} style={{ gap: 6 }}>
                  <Text style={{ color: colors.muted }}>
                    Ticket {index + 1} · {files.length} vue
                    {files.length > 1 ? "s" : ""} sélectionnée
                    {files.length > 1 ? "s" : ""}
                  </Text>
                  <SecondaryButton
                    label={`Traiter le ticket ${index + 1} comme des tickets séparés`}
                    disabled={busy}
                    onPress={() => {
                      separateEmailTickets(draft!, group);
                      changed((value) => value + 1);
                    }}
                  />
                </View>
              ))
            : null}
        </View>
      ) : null}
      {expanded
        ? receipt.files.map((file) => {
            const eligible =
              canChoose &&
              ["READY", "PENDING", "FAILED"].includes(file.status) &&
              !file.sourceDocumentId;
            const included = !draft!.excluded.has(file.id);
            const checked = grouping ? views.has(file.id) : included;
            const accepted = decision?.decision.files.find(
              (selected) => selected.fileId === file.id,
            );
            const groupViews = accepted
              ? receipt.files.filter((member) =>
                  decision?.decision.files.some(
                    (selected) =>
                      selected.fileId === member.id &&
                      selected.processingId === accepted.processingId,
                  ),
                )
              : [];
            const leader = groupViews[0]?.id === file.id;
            const purpose = draft!.tickets.has(file.id)
              ? "Vues d’un même ticket"
              : draft!.purposes.get(file.id) === "WASTE_TICKET"
                ? "Ticket de casse"
                : draft!.purposes.get(file.id) === "STORE_PHOTO"
                  ? "Photo du rayon"
                  : "Détection automatique";
            // Hints only expose a choice; they never select an intent or bypass byte checks.
            const showPurpose =
              /^image\//i.test(file.mediaType ?? "") ||
              /\.(jpe?g|png|heic|heif|webp)$/i.test(file.filename ?? "") ||
              draft!.purposes.has(file.id) ||
              draft!.tickets.has(file.id);
            return (
              <View key={file.id}>
                <Pressable
                  accessibilityRole={eligible ? "checkbox" : undefined}
                  aria-checked={eligible ? checked : undefined}
                  accessibilityState={
                    eligible
                      ? { checked, disabled: busy || (grouping && !included) }
                      : undefined
                  }
                  accessibilityLabel={`${grouping ? "Vue du ticket : " : ""}${file.filename ?? "Fichier sans nom"}`}
                  disabled={!eligible || busy || (grouping && !included)}
                  onPress={() => {
                    if (grouping) {
                      if (
                        !views.has(file.id) &&
                        views.size >= MAX_RECEIPT_VIEWS
                      ) {
                        setError(
                          `Un même ticket accepte ${MAX_RECEIPT_VIEWS} vues au maximum.`,
                        );
                        return;
                      }
                      setViews((previous) => {
                        const next = new Set(previous);
                        if (next.has(file.id)) next.delete(file.id);
                        else next.add(file.id);
                        return next;
                      });
                      setError(undefined);
                      return;
                    }
                    if (checked) draft!.excluded.add(file.id);
                    else draft!.excluded.delete(file.id);
                    changed((value) => value + 1);
                  }}
                  style={{
                    gap: 6,
                    paddingVertical: 12,
                    borderTopColor: colors.line,
                    borderTopWidth: 1,
                  }}
                >
                  <Text style={{ color: colors.ink }}>
                    {eligible ? (checked ? "✓ " : "○ ") : ""}
                    {file.filename ?? "Fichier sans nom"}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 13 }}>
                    {decision?.decision.choice === "ADMIT" &&
                    !decision.decision.files.some(
                      (selected) => selected.fileId === file.id,
                    )
                      ? "Non sélectionné · "
                      : ""}
                    {file.status === "READY"
                      ? "Original conservé"
                      : file.status === "PENDING"
                        ? "Réception en cours"
                        : file.status === "FAILED"
                          ? "Réception à reprendre"
                          : file.status === "APPLIED"
                            ? "Document enregistré"
                            : "Format non pris en charge"}
                  </Text>
                </Pressable>
                {eligible && included && !grouping && showPurpose ? (
                  <View style={{ gap: 8, paddingBottom: 12 }}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Usage : ${purpose}`}
                      accessibilityState={{ disabled: busy }}
                      disabled={busy}
                      style={{ minHeight: 44, justifyContent: "center" }}
                      onPress={() =>
                        setPurposeFile(
                          purposeFile === file.id ? undefined : file.id,
                        )
                      }
                    >
                      <Text style={{ color: colors.forest, fontSize: 14 }}>
                        {purpose} · Modifier
                      </Text>
                    </Pressable>
                    {purposeFile === file.id ? (
                      <>
                        <SecondaryButton
                          label="Déterminer l’usage pendant le traitement"
                          disabled={busy}
                          onPress={() => choosePurpose(file.id, "AUTO")}
                        />
                        <SecondaryButton
                          label="Un ticket de casse indépendant"
                          disabled={busy}
                          onPress={() => choosePurpose(file.id, "WASTE_TICKET")}
                        />
                        <SecondaryButton
                          label="Une photo du rayon"
                          disabled={busy}
                          onPress={() => choosePurpose(file.id, "STORE_PHOTO")}
                        />
                      </>
                    ) : null}
                  </View>
                ) : null}
                {accepted && groupViews.length > 1 ? (
                  <Text style={{ color: colors.muted, paddingBottom: 8 }}>
                    Vue{" "}
                    {groupViews.findIndex((view) => view.id === file.id) + 1}/
                    {groupViews.length} d’un même ticket de casse.
                  </Text>
                ) : null}
                {accepted &&
                groupViews.length === 1 &&
                accepted.mode !== "AUTO" ? (
                  <Text style={{ color: colors.muted, paddingBottom: 8 }}>
                    {accepted.mode === "STORE_PHOTO"
                      ? "Photo du rayon"
                      : "Ticket de casse indépendant"}
                  </Text>
                ) : null}
                {decision?.state === "SYNCED" &&
                decision.decision.choice === "ADMIT" &&
                accepted &&
                leader ? (
                  <EmailProcessingControls
                    inbox={inbox}
                    original={{
                      conversationId,
                      receiptId: receipt.id,
                      fileId: file.id,
                    }}
                    revision={revision}
                  />
                ) : null}
              </View>
            );
          })
        : null}
      {error ? <InlineAlert title="À vérifier" message={error} /> : null}
      {canChoose && expanded && !grouping ? (
        discarding ? (
          <View style={{ gap: 12 }}>
            <InlineAlert
              title="Écarter cet email ?"
              message="Les fichiers conservés seront maintenus. Aucun de ces documents ne sera envoyé au traitement."
            />
            <PrimaryButton
              label="Confirmer : écarter cet email"
              disabled={busy}
              onPress={() => void decide("DISMISS")}
            />
            <SecondaryButton
              label="Conserver ces fichiers"
              disabled={busy}
              onPress={() => setDiscarding(false)}
            />
          </View>
        ) : (
          <>
            <PrimaryButton
              label={
                busy
                  ? "Enregistrement…"
                  : `Confirmer ${selected.length} fichier${selected.length > 1 ? "s" : ""}`
              }
              disabled={busy || !selected.length}
              onPress={() => void decide("ADMIT")}
            />
            <SecondaryButton
              label="Écarter cet email"
              disabled={busy}
              onPress={() => setDiscarding(true)}
            />
          </>
        )
      ) : null}
      {decision?.state === "CONFLICT" ? (
        <SecondaryButton
          label="Comparer les choix"
          onPress={() => onOpenSync(decision.decision.actionId)}
        />
      ) : null}
      {decision?.state === "ERROR" ? (
        <SecondaryButton
          label="Voir la synchronisation"
          onPress={() => onOpenSync()}
        />
      ) : null}
      {decision?.decision.choice === "ADMIT" ? (
        <Text style={{ color: colors.muted, lineHeight: 21 }}>
          La confirmation autorise le traitement. Les documents ne sont pas
          nécessairement analysés ou publiés.
        </Text>
      ) : null}
    </View>
  );
}
