import { ReferenceCard } from "@/copilot/reference-card";
import { CopilotReferenceController } from "@/copilot/reference-controller";
import { readCopilotReferenceProposal } from "@fl-copilot/domain";
import { PlanValidationCard } from "@/copilot/plan-validation-card";
import { CopilotPlanValidationController } from "@/copilot/plan-validation-controller";
import { readCopilotPlanValidationProposal } from "@fl-copilot/domain";
import Swipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import { Pressable, Alert } from "react-native";
import { OfferValidationCard } from "@/copilot/offer-validation-card";
import { CopilotOfferValidationController } from "@/copilot/offer-validation-controller";
import { readCopilotOfferValidationProposal } from "@fl-copilot/domain";
import { ChoiceCreateCard } from "@/copilot/choice-create-card";
import { CopilotChoiceCreateController } from "@/copilot/choice-create-controller";
import { readCopilotChoiceCreateProposal } from "@fl-copilot/domain";
import { ChoiceRetentionCard } from "@/copilot/choice-retention-card";
import { CopilotChoiceRetentionController } from "@/copilot/choice-retention-controller";
import { readCopilotChoiceRetentionProposal } from "@fl-copilot/domain";
import { ChoiceReassociationCard } from "@/copilot/choice-reassociation-card";
import { CopilotChoiceReassociationController } from "@/copilot/choice-reassociation-controller";
import { readCopilotChoiceReassociationProposal } from "@fl-copilot/domain";
import { ChoiceUpdateCard } from "@/copilot/choice-update-card";
import { CopilotChoiceUpdateController } from "@/copilot/choice-update-controller";
import { readCopilotChoiceUpdateProposal } from "@fl-copilot/domain";
import { ChoiceWithdrawalCard } from "@/copilot/choice-withdrawal-card";
import { CopilotChoiceWithdrawalController } from "@/copilot/choice-withdrawal-controller";
import { readCopilotChoiceWithdrawalProposal } from "@fl-copilot/domain";
import { PreparationProposalCard } from "@/copilot/preparation-proposal-card";
import { CopilotPreparationProposalController } from "@/copilot/preparation-proposal-controller";
import { readCopilotPreparationProposal } from "@fl-copilot/domain";
import { OperationsProposalCard } from "@/copilot/operations-proposal-card";
import { CopilotOperationsProposalController } from "@/copilot/operations-proposal-controller";
import { readCopilotOperationsProposal } from "@fl-copilot/domain";
import { NeedProposalCard } from "@/copilot/need-proposal-card";
import { CopilotNeedProposalController } from "@/copilot/need-proposal-controller";
import { readCopilotNeedProposal } from "@fl-copilot/domain";
import { CatalogueProposalCard } from "@/copilot/catalogue-proposal-card";
import { CopilotCatalogueProposalController } from "@/copilot/catalogue-proposal-controller";
import { readCopilotCatalogueProposal } from "@fl-copilot/domain";
import { ExecutionProposalCard } from "@/copilot/execution-proposal-card";
import { CopilotExecutionProposalController } from "@/copilot/execution-proposal-controller";
import { readCopilotExecutionProposal } from "@fl-copilot/domain";
import { ContextCheckpointCard } from "@/copilot/context-checkpoint-card";
import { readContextCheckpoint } from "@fl-copilot/domain";
import { readKnowledgeSuggestion } from "@fl-copilot/domain";
import { KnowledgeSuggestionCard } from "@/copilot/knowledge-suggestion-card";
import { fetch as expoFetch } from "expo/fetch";
import { CopilotIntakeSummary } from "@/copilot/intake-summary";
import { MercalysImportScreen } from "@/documents/mercalys-import-screen";
import { MercalysBatchRepository } from "@/documents/mercalys-batch-repository";
import { CopilotInformationFormController } from "@/copilot/information-form-controller";
import { InformationFormCard } from "@/copilot/information-form-card";
import { ProductProposalCard } from "@/copilot/product-proposal-card";
import { CopilotProductProposalController } from "@/copilot/product-proposal-controller";
import {
  readCopilotInformationRequest,
  readCopilotProductProposal,
  type CopilotMessage,
} from "@fl-copilot/domain";
import { requireOptionalNativeModule } from "expo-modules-core";
import { captureCommercialPdf } from "@/documents/commercial-pdf-capture";
import { SourceDocumentRepository } from "@/documents/source-document-repository";
import { selectCopilotPdfs } from "@/copilot/pdf-selection";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import {
  randomUUID,
  digestStringAsync,
  CryptoDigestAlgorithm,
} from "expo-crypto";
import { ApiClient } from "@fl-copilot/api-client";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import { getApiBaseUrl } from "@/config/environment";
import { CopilotConversationRepository } from "@/copilot/conversation-repository";
import { CopilotLocalChatController } from "@/copilot/local-chat-controller";
import { CopilotLocalChatPanel } from "@/copilot/local-chat-panel";
import { CopilotTurnDelivery } from "@/copilot/turn-delivery";
import {
  AppScreen,
  AppHeader,
  PrimaryButton,
  SecondaryButton,
  BottomSheet,
  MenuRow,
  InlineAlert,
} from "@/components/ui";
import { colors } from "@/design/tokens";
const executionDigest = (s: string) =>
  digestStringAsync(CryptoDigestAlgorithm.SHA256, s);

interface NativePdfPicker {
  getDocumentAsync(options: {
    type: string[];
    copyToCacheDirectory: boolean;
    multiple: boolean;
    base64: boolean;
  }): Promise<
    | { canceled: true }
    | {
        canceled: false;
        assets: Array<{ uri: string; name: string; mimeType?: string }>;
      }
  >;
}
const pdfPicker =
  requireOptionalNativeModule<NativePdfPicker>("ExpoDocumentPicker");

export default function CopilotScreen() {
  const { session } = useAuth();
  const storeId = session?.stores[0]?.storeId,
    ownerId = session?.user.id;
  if (!storeId || !ownerId)
    return (
      <AppScreen>
        <AppHeader title="Copilote" />
        <InlineAlert
          title="Connexion nécessaire"
          message="Connectez-vous à votre magasin pour retrouver vos conversations."
        />
        <PrimaryButton
          label="Se connecter"
          onPress={() => router.replace("/login")}
        />
      </AppScreen>
    );
  return (
    <StoreChat
      key={`${storeId}/${ownerId}`}
      storeId={storeId}
      ownerId={ownerId}
    />
  );
}
function StoreChat({ storeId, ownerId }: { storeId: string; ownerId: string }) {
  const { sqlite, deviceId } = useLocalDatabase();
  const { withAccessToken, session } = useAuth();
  const canManageProducts =
    session?.stores.some(
      (store) => store.storeId === storeId && store.role === "MANAGER",
    ) ?? false;
  const canDeclareCommercialExecution = canManageProducts; // Current MANAGER role policy.
  const proposals = useMemo(
    () =>
      new CopilotProductProposalController(
        sqlite,
        { storeId, ownerId, deviceId, canManageProducts },
        randomUUID,
      ),
    [sqlite, storeId, ownerId, deviceId, canManageProducts],
  );
  // Current MANAGER policy; the runtime keeps the two capabilities independent.
  const canCaptureStoreEvents = canManageProducts,
    canManageStoreSettings = canManageProducts;
  const canPrepareCommercialWeek = canManageProducts;
  const preparationProposals = useMemo(
    () =>
      new CopilotPreparationProposalController(
        sqlite,
        { storeId, ownerId, deviceId, canPrepareCommercialWeek },
        executionDigest,
        randomUUID,
      ),
    [sqlite, storeId, ownerId, deviceId, canPrepareCommercialWeek],
  );
  const operationsProposals = useMemo(
    () =>
      new CopilotOperationsProposalController(
        sqlite,
        {
          storeId,
          ownerId,
          deviceId,
          canCaptureStoreEvents,
          canManageStoreSettings,
        },
        randomUUID,
      ),
    [
      sqlite,
      storeId,
      ownerId,
      deviceId,
      canCaptureStoreEvents,
      canManageStoreSettings,
    ],
  );
  const needProposals = useMemo(
    () =>
      new CopilotNeedProposalController(
        sqlite,
        { storeId, ownerId, deviceId, canManageProducts },
        executionDigest,
        randomUUID,
      ),
    [sqlite, storeId, ownerId, deviceId, canManageProducts],
  );
  const catalogueProposals = useMemo(
    () =>
      new CopilotCatalogueProposalController(
        sqlite,
        { storeId, ownerId, deviceId, canManageProducts },
        randomUUID,
      ),
    [sqlite, storeId, ownerId, deviceId, canManageProducts],
  );
  const executionProposals = useMemo(
    () =>
      new CopilotExecutionProposalController(
        sqlite,
        {
          storeId,
          ownerId,
          deviceId,
          canDeclareCommercialExecution,
        },
        executionDigest,
        randomUUID,
      ),
    [sqlite, storeId, ownerId, deviceId, canDeclareCommercialExecution],
  );
  const choiceUpdates = useMemo(
    () =>
      new CopilotChoiceUpdateController(
        sqlite,
        {
          storeId,
          ownerId,
          deviceId,
          canManageCommercialChoices: canManageProducts,
        },
        executionDigest,
        randomUUID,
      ),
    [sqlite, storeId, ownerId, deviceId, canManageProducts],
  );
  const choiceRetentions = useMemo(
    () =>
      new CopilotChoiceRetentionController(
        sqlite,
        {
          storeId,
          ownerId,
          deviceId,
          canManageCommercialChoices: canManageProducts,
        },
        executionDigest,
        randomUUID,
      ),
    [sqlite, storeId, ownerId, deviceId, canManageProducts],
  );
  const choiceCreates = useMemo(
    () =>
      new CopilotChoiceCreateController(
        sqlite,
        {
          storeId,
          ownerId,
          deviceId,
          canManageCommercialChoices: canManageProducts,
        },
        executionDigest,
        randomUUID,
      ),
    [sqlite, storeId, ownerId, deviceId, canManageProducts],
  );
  const references = useMemo(
    () =>
      new CopilotReferenceController(
        sqlite,
        {
          storeId,
          ownerId,
          deviceId,
          canManageCommercialReferences: canManageProducts,
        },
        executionDigest,
        randomUUID,
      ),
    [sqlite, storeId, ownerId, deviceId, canManageProducts],
  );
  const planValidations = useMemo(
    () =>
      new CopilotPlanValidationController(
        sqlite,
        {
          storeId,
          ownerId,
          deviceId,
          canValidateCommercialPlan: canManageProducts,
        },
        executionDigest,
        randomUUID,
      ),
    [sqlite, storeId, ownerId, deviceId, canManageProducts],
  );
  const offerValidations = useMemo(
    () =>
      new CopilotOfferValidationController(
        sqlite,
        {
          storeId,
          ownerId,
          deviceId,
          canValidateCommercialOffers: canManageProducts,
        },
        executionDigest,
        randomUUID,
      ),
    [sqlite, storeId, ownerId, deviceId, canManageProducts],
  );
  const choiceReassociations = useMemo(
    () =>
      new CopilotChoiceReassociationController(
        sqlite,
        {
          storeId,
          ownerId,
          deviceId,
          canManageCommercialChoices: canManageProducts,
        },
        executionDigest,
        randomUUID,
      ),
    [sqlite, storeId, ownerId, deviceId, canManageProducts],
  );
  const choiceWithdrawals = useMemo(
    () =>
      new CopilotChoiceWithdrawalController(
        sqlite,
        {
          storeId,
          ownerId,
          deviceId,
          canManageCommercialChoices: canManageProducts,
        },
        executionDigest,
        randomUUID,
      ),
    [sqlite, storeId, ownerId, deviceId, canManageProducts],
  );
  const forms = useMemo(
    () =>
      new CopilotInformationFormController(
        sqlite,
        { storeId, ownerId, deviceId },
        randomUUID,
      ),
    [sqlite, storeId, ownerId, deviceId],
  );
  const renderProposal = (
    message: CopilotMessage,
    onSubmitted: () => Promise<void>,
  ) => {
    try {
      readContextCheckpoint(message);
      return <ContextCheckpointCard key={message.id} message={message} />;
    } catch {
      /* Other supported private tool artifacts follow. */
    }
    try {
      readKnowledgeSuggestion(message);
      return <KnowledgeSuggestionCard key={message.id} message={message} />;
    } catch {
      /* Other supported private tool artifacts follow. */
    }
    try {
      readCopilotInformationRequest(message);
      return (
        <InformationFormCard
          key={message.id}
          message={message}
          controller={forms}
          onSubmitted={onSubmitted}
        />
      );
    } catch {
      /* Other supported tool artifacts are handled below. */
    }
    try {
      readCopilotChoiceReassociationProposal(message);
      return (
        <ChoiceReassociationCard
          key={message.id}
          message={message}
          controller={choiceReassociations}
          canConfirm={canManageProducts}
        />
      );
    } catch {
      /* Other artifacts follow. */
    }
    try {
      readCopilotChoiceUpdateProposal(message);
      return (
        <ChoiceUpdateCard
          key={message.id}
          message={message}
          controller={choiceUpdates}
          canConfirm={canManageProducts}
        />
      );
    } catch {
      /* Other artifacts follow. */
    }
    try {
      readCopilotChoiceRetentionProposal(message);
      return (
        <ChoiceRetentionCard
          key={message.id}
          message={message}
          controller={choiceRetentions}
          canConfirm={canManageProducts}
        />
      );
    } catch {
      /* Other artifacts follow. */
    }
    try {
      readCopilotChoiceCreateProposal(message);
      return (
        <ChoiceCreateCard
          key={message.id}
          message={message}
          controller={choiceCreates}
          canConfirm={canManageProducts}
        />
      );
    } catch {
      /* Other artifacts follow. */
    }
    try {
      readCopilotReferenceProposal(message);
      return (
        <ReferenceCard
          key={message.id}
          message={message}
          controller={references}
          canConfirm={canManageProducts}
          onSubmitted={onSubmitted}
        />
      );
    } catch {
      /* Other artifacts follow. */
    }
    try {
      readCopilotPlanValidationProposal(message);
      return (
        <PlanValidationCard
          key={message.id}
          message={message}
          controller={planValidations}
          canConfirm={canManageProducts}
          onSubmitted={onSubmitted}
        />
      );
    } catch {
      /* Other artifacts follow. */
    }
    try {
      readCopilotOfferValidationProposal(message);
      return (
        <OfferValidationCard
          key={message.id}
          message={message}
          controller={offerValidations}
          canConfirm={canManageProducts}
        />
      );
    } catch {
      /* Other artifacts follow. */
    }
    try {
      readCopilotChoiceWithdrawalProposal(message);
      return (
        <ChoiceWithdrawalCard
          key={message.id}
          message={message}
          controller={choiceWithdrawals}
          canConfirm={canManageProducts}
        />
      );
    } catch {
      /* Other artifacts follow. */
    }
    try {
      readCopilotPreparationProposal(message);
      return (
        <PreparationProposalCard
          key={message.id}
          message={message}
          controller={preparationProposals}
          canConfirm={canPrepareCommercialWeek}
        />
      );
    } catch {
      /* Other artifacts follow. */
    }
    try {
      const proposal = readCopilotOperationsProposal(message);
      return (
        <OperationsProposalCard
          key={message.id}
          message={message}
          controller={operationsProposals}
          canConfirm={
            proposal.content.input.kind === "SETTINGS"
              ? canManageStoreSettings
              : canCaptureStoreEvents
          }
        />
      );
    } catch {
      /* Other artifacts follow. */
    }
    try {
      readCopilotNeedProposal(message);
      return (
        <NeedProposalCard
          key={message.id}
          message={message}
          controller={needProposals}
          canConfirm={canManageProducts}
        />
      );
    } catch {
      /* Other artifacts follow. */
    }
    try {
      readCopilotCatalogueProposal(message);
      return (
        <CatalogueProposalCard
          key={message.id}
          message={message}
          controller={catalogueProposals}
          canConfirm={canManageProducts}
        />
      );
    } catch {
      /* Other artifacts follow. */
    }
    try {
      readCopilotExecutionProposal(message);
      return (
        <ExecutionProposalCard
          key={message.id}
          message={message}
          controller={executionProposals}
          canConfirm={canDeclareCommercialExecution}
        />
      );
    } catch {
      /* Other supported private tool artifacts follow. */
    }
    try {
      readCopilotProductProposal(message);
    } catch {
      return null;
    }
    return (
      <ProductProposalCard
        key={message.id}
        message={message}
        controller={proposals}
        canConfirm={canManageProducts}
      />
    );
  };
  const { syncNow } = useSync();
  const repo = useMemo(
    () => new CopilotConversationRepository(sqlite, { storeId, ownerId }),
    [sqlite, storeId, ownerId],
  );
  const controller = useMemo(
    () =>
      new CopilotLocalChatController(
        repo,
        { storeId, ownerId, deviceId },
        randomUUID,
      ),
    [repo, storeId, ownerId, deviceId],
  );
  const delivery = useMemo(() => {
    const api = new ApiClient(getApiBaseUrl());
    return new CopilotTurnDelivery(
      sqlite,
      { storeId, ownerId },
      {
        sync: () => syncNow(storeId),
        ask: (input, signal, onProgress, onActivity) =>
          withAccessToken((token) =>
            api.copilotTurn(token, storeId, ownerId, input, signal, {
              onProgress,
              onActivity,
              memorySuggestions: true,
              webResearch: true,
              choiceUpdate: canManageProducts,
              choiceRetention: canManageProducts,
              choiceCreate: canManageProducts,
              offerValidation: canManageProducts,
              planValidation: canManageProducts,
              commercialReference: canManageProducts,
              choiceReassociation: canManageProducts,
              choiceWithdrawal: canManageProducts,
              preparationProposals: canPrepareCommercialWeek,
              preparationLayout: canPrepareCommercialWeek,
              preparationCreate: canPrepareCommercialWeek,
              preparationSelection: canPrepareCommercialWeek,
              preparationRefresh: canPrepareCommercialWeek,
              storeOperations: canCaptureStoreEvents || canManageStoreSettings,
              needProposals: canManageProducts,
              catalogueProposals: canManageProducts,
              executionProposals: canDeclareCommercialExecution,
              fetch: expoFetch as typeof fetch,
            }),
          ),
      },
    );
  }, [
    sqlite,
    storeId,
    ownerId,
    syncNow,
    withAccessToken,
    canPrepareCommercialWeek,
    canDeclareCommercialExecution,
    canManageProducts,
    canCaptureStoreEvents,
    canManageStoreSettings,
  ]);
  const attachPdf = async (signal: AbortSignal, capacity: number) => {
    if (!pdfPicker) throw Error("COPILOT_PDF_PICKER_UNAVAILABLE");
    return selectCopilotPdfs(
      {
        pick: async () => {
          const result = await pdfPicker.getDocumentAsync({
            type: ["application/pdf"],
            copyToCacheDirectory: true,
            multiple: true,
            base64: false,
          });
          if (result.canceled) return undefined;
          if (!result.assets[0]) throw Error("COMMERCIAL_PDF_INVALID");
          return result.assets;
        },
        retain: async (asset) => {
          const result = await captureCommercialPdf(
            {
              uri: asset.uri,
              originalFilename: asset.name,
              mimeType: asset.mimeType,
              storeId,
              documentId: randomUUID(),
              fileId: randomUUID(),
              capturedAt: new Date().toISOString(),
            },
            new SourceDocumentRepository(sqlite),
          );
          return result.document.id;
        },
      },
      signal,
      capacity,
    );
  };
  const [conversations, setConversations] = useState<
    Awaited<ReturnType<CopilotConversationRepository["list"]>>
  >([]);
  const [active, setActive] = useState<string>();
  const [menu, setMenu] = useState(false);
  const [intakeConversation, setIntakeConversation] = useState<string>();
  const [draftRefresh, setDraftRefresh] = useState(0);
  const [intakeRevision, setIntakeRevision] = useState(0);
  const [intakeBusy, setIntakeBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();
  const createLocked = useRef(false);
  const topicRevision = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let alive = true;
    const revision = ++topicRevision.current;
    void repo
      .list()
      .then((rows) => {
        if (alive && revision === topicRevision.current)
          setConversations(
            rows.filter((row) => row.entity.status === "ACTIVE"),
          );
      })
      .catch(() => {
        if (alive)
          setError("Les conversations locales ne peuvent pas être lues.");
      });
    return () => {
      alive = false;
    };
  }, [repo]);
  const refreshMenu = useCallback(() => {
    setMenu(true);
    const revision = ++topicRevision.current;
    void repo
      .list()
      .then((rows) => {
        if (revision === topicRevision.current)
          setConversations(
            rows.filter((row) => row.entity.status === "ACTIVE"),
          );
      })
      .catch(() =>
        setError("Les conversations locales ne peuvent pas être lues."),
      );
  }, [repo]);
  const create = async () => {
    if (createLocked.current) return;
    createLocked.current = true;
    topicRevision.current++;
    setCreating(true);
    setError(undefined);
    try {
      const conversation = await controller.create();
      setConversations(await repo.list());
      setActive(conversation.id);
      setMenu(false);
    } catch {
      setError("La conversation n’a pas pu être créée. Réessayez.");
    } finally {
      createLocked.current = false;
      setCreating(false);
    }
  };
  const topics = (
    <View className="gap-3">
      <PrimaryButton
        label="Nouvelle conversation"
        disabled={creating}
        onPress={() => {
          void create();
        }}
      />
      {error ? (
        <InlineAlert title="Conversation indisponible" message={error} />
      ) : null}
      {conversations
        .filter((row) => row.entity.status === "ACTIVE")
        .map((row) => (
          <Swipeable
            key={row.entity.id}
            overshootRight={false}
            renderRightActions={(_progress, _translation, methods) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Supprimer la conversation ${row.entity.title}`}
                style={{
                  minWidth: 100,
                  justifyContent: "center",
                  alignItems: "center",
                  backgroundColor: colors.critical,
                  borderRadius: 16,
                  marginLeft: 8,
                }}
                onPress={() => {
                  methods.close();
                  Alert.alert(
                    "Supprimer cette conversation ?",
                    "Elle sera retirée du fil et du contexte du copilote. Les fichiers, les souvenirs mémorisés et les actions déjà confirmées sont conservés.",
                    [
                      { text: "Annuler", style: "cancel" },
                      {
                        text: "Supprimer",
                        style: "destructive",
                        onPress: () => {
                          const revision = ++topicRevision.current;
                          void controller
                            .removeConversation(row.entity.id)
                            .then(async () => {
                              const rows = await repo.list();
                              if (
                                !mounted.current ||
                                revision !== topicRevision.current
                              )
                                return;
                              setConversations(rows);
                              if (active === row.entity.id)
                                setActive(undefined);
                              void syncNow(storeId);
                            })
                            .catch(() => {
                              if (
                                mounted.current &&
                                revision === topicRevision.current
                              )
                                setError(
                                  "La conversation n’a pas pu être supprimée.",
                                );
                            });
                        },
                      },
                    ],
                  );
                }}
              >
                <Text style={{ color: "white", fontWeight: "600" }}>
                  Supprimer
                </Text>
              </Pressable>
            )}
          >
            <MenuRow
              title={row.entity.title}
              description={`Créée le ${new Date(row.entity.createdAt).toLocaleString("fr-FR")}`}
              icon="chatbubble-outline"
              onPress={() => {
                setActive(row.entity.id);
                setMenu(false);
              }}
            />
          </Swipeable>
        ))}
      <SecondaryButton
        label="Retour à l’application"
        onPress={() => router.back()}
      />
    </View>
  );
  if (!active)
    return (
      <AppScreen>
        <AppHeader
          title="Copilote"
          subtitle="Vos conversations et brouillons restent disponibles sur ce téléphone."
        />
        {topics}
      </AppScreen>
    );
  return (
    <SafeAreaView
      edges={["top", "bottom", "left", "right"]}
      style={{ flex: 1, backgroundColor: colors.canvas }}
    >
      <CopilotLocalChatPanel
        controller={controller}
        conversationId={active}
        scopeKey={`${storeId}/${ownerId}`}
        delivery={delivery}
        onConversations={refreshMenu}
        onRemember={(message) =>
          router.push({
            pathname: "/copilot-memory",
            params: { source: message.id },
          })
        }
        onAttachPdf={attachPdf}
        onOpenMercalys={() => setIntakeConversation(active)}
        externalDraftRevision={draftRefresh}
        intakeSummary={
          <CopilotIntakeSummary
            key={active}
            db={sqlite}
            storeId={storeId}
            ownerId={ownerId}
            conversationId={active}
            revision={intakeRevision}
            onOpen={() => setIntakeConversation(active)}
          />
        }
        renderToolMessage={renderProposal}
      />
      <Modal
        visible={!!intakeConversation}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => {
          if (!intakeBusy) {
            setIntakeConversation(undefined);
            setIntakeRevision((revision) => revision + 1);
          }
        }}
      >
        {intakeConversation ? (
          <MercalysImportScreen
            key={`${storeId}/${ownerId}/${intakeConversation}`}
            conversationId={intakeConversation}
            onBusyChange={setIntakeBusy}
            onClose={() => {
              setIntakeConversation(undefined);
              setIntakeRevision((revision) => revision + 1);
            }}
            onDiscuss={async (batchId) => {
              const conversationId = intakeConversation;
              const intake = new MercalysBatchRepository(sqlite, {
                storeId,
                ownerId,
                conversationId,
              });
              const question = await intake.discussionQuestion(batchId);
              await controller.appendIntakeQuestion(conversationId, question);
              setDraftRefresh((revision) => revision + 1);
              setIntakeRevision((revision) => revision + 1);
              setIntakeConversation(undefined);
            }}
          />
        ) : null}
      </Modal>
      <BottomSheet
        visible={menu}
        title="Conversations"
        onClose={() => setMenu(false)}
      >
        {topics}
        <Text className="text-sm text-muted">
          Chaque conversation garde son propre brouillon.
        </Text>
      </BottomSheet>
    </SafeAreaView>
  );
}
