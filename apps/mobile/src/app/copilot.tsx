import { createVisualSourcePhotoPort } from "@/copilot/visual-source-photo";
import { nativeVisualFileStorage } from "@/products/visual-file-storage";
import { readTranscriptionReviewProposal } from "@fl-copilot/domain";
import { CopilotTranscriptionReviewController } from "@/copilot/transcription-review-controller";
import { TranscriptionReviewCard } from "@/copilot/transcription-review-card";
import { readVisualActionProposal } from "@fl-copilot/domain";
import { CopilotVisualActionController } from "@/copilot/visual-action-controller";
import { VisualActionCard } from "@/copilot/visual-action-card";
import { LayoutIllustrationGenerationRepository } from "../copilot/layout-illustration-generation-repository";
import { LayoutIllustrationTransfer } from "../copilot/layout-illustration-transfer";
import { nativeLayoutIllustrationFiles } from "../copilot/layout-illustration-native-files";
import { LayoutIllustrationRepository } from "@/copilot/layout-illustration-repository";
import { EmailInbox, EmailInboxIndicator } from "@/intake/email-inbox";
import { z } from "zod";
import { CopilotStorePhotoIntake } from "@/copilot/store-photo-intake";
import { LayoutPreparationController } from "@/copilot/layout-preparation-controller";
import { readStoreLayoutScenarioCard } from "@fl-copilot/domain";
import { CopilotStoreLayoutScenarioReader } from "@/copilot/store-layout-scenario-reader";
import { StoreLayoutScenarioCard } from "@/copilot/store-layout-scenario-card";
import { readCopilotLayoutEditProposal } from "@fl-copilot/domain";
import { CopilotStoreLayoutEditController } from "@/copilot/store-layout-edit-controller";
import { StoreLayoutEditCard } from "@/copilot/store-layout-edit-card";
import { readActionExecutionProposal } from "@fl-copilot/domain";
import { CopilotActionExecutionRepository } from "../copilot/action-execution-repository";
import { ActionExecutionCard } from "../copilot/action-execution-card";
import { CopilotDecisionRepository } from "@/copilot/decision-repository";
import { RecommendationDecisionCard } from "@/copilot/recommendation-decision-card";
import { readRecommendationTrackingCard } from "@fl-copilot/domain";
import { CopilotReceiptCameraIntake } from "@/copilot/receipt-camera-intake";
import { ReceiptCameraSession } from "@/copilot/receipt-camera-session";
import type { ReceiptPhotoSelection } from "@/copilot/receipt-photo-intake";
import { CopilotReceiptViewsIntake } from "@/copilot/receipt-views-intake";
import { ReceiptViewsReview } from "@/copilot/receipt-views-review";
import {
  MAX_RECEIPT_VIEWS,
  type CopilotReceiptViewsSelection,
} from "@fl-copilot/domain";
import { readStoreConflictProposal } from "@fl-copilot/domain";
import { CopilotStoreConflictController } from "@/copilot/store-conflict-controller";
import { StoreConflictCard } from "@/copilot/store-conflict-card";
import { readReceiptRecoveryProposal } from "@fl-copilot/domain";
import { CopilotReceiptRecoveryController } from "@/copilot/receipt-recovery-controller";
import { ReceiptRecoveryCard } from "@/copilot/receipt-recovery-card";
import { readCopilotImportReference } from "@fl-copilot/domain";
import { MercalysImportCard } from "@/copilot/mercalys-import-card";
import { ReferenceCard } from "@/copilot/reference-card";
import { CopilotReferenceController } from "@/copilot/reference-controller";
import { readCopilotReferenceProposal } from "@fl-copilot/domain";
import { PlanValidationCard } from "@/copilot/plan-validation-card";
import { CopilotPlanValidationController } from "@/copilot/plan-validation-controller";
import { readCopilotPlanValidationProposal } from "@fl-copilot/domain";
import { ConversationMenuRow } from "@/copilot/conversation-menu-row";
import { Platform } from "react-native";
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
import { ReceiptCorrectionCard } from "@/copilot/receipt-correction-card";
import { CopilotReceiptCorrectionController } from "@/copilot/receipt-correction-controller";
import { readReceiptCorrectionProposal } from "@fl-copilot/domain";
import { ReceiptPublicationCard } from "@/copilot/receipt-publication-card";
import { CopilotReceiptPublicationController } from "@/copilot/receipt-publication-controller";
import { readReceiptPublicationProposal } from "@fl-copilot/domain";
import { IdentityReviewCard } from "@/copilot/identity-review-card";
import { CopilotIdentityReviewController } from "@/copilot/identity-review-controller";
import { readIdentityReviewProposal } from "@fl-copilot/domain";
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
import { CopilotReceiptPhotoIntake } from "@/copilot/receipt-photo-intake";
import { resolveWasteReceiptImageExtension } from "@/documents/waste-receipt-capture";
import { selectCopilotPdfs } from "@/copilot/pdf-selection";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
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
import { useVisualLibrary } from "@/products/use-visual-library";
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
  const { conversationId: requestedConversation } = useLocalSearchParams<{
    conversationId?: string;
  }>();
  const visuals = useVisualLibrary();
  const { sqlite, deviceId } = useLocalDatabase();
  const { withAccessToken, session } = useAuth();
  const canManageProducts =
    session?.stores.some(
      (store) => store.storeId === storeId && store.role === "MANAGER",
    ) ?? false;
  const photoCaptureAllowed = useRef(canManageProducts);
  photoCaptureAllowed.current = canManageProducts;
  const [receiptViewsReview, setReceiptViewsReview] = useState<{
    assets: CopilotReceiptViewsSelection["assets"];
    finish(assets: CopilotReceiptViewsSelection["assets"] | null): void;
  } | null>(null);
  const cancelReceiptViewsReview = useRef<(() => void) | undefined>(undefined);
  const [receiptCamera, setReceiptCamera] = useState<{
    session: ReceiptCameraSession;
    Sheet: typeof import("@/copilot/receipt-camera-sheet").default;
    finish(result?: ReceiptPhotoSelection): void;
  } | null>(null);
  const cancelReceiptCamera = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    photoCaptureAllowed.current = canManageProducts;
    if (!canManageProducts) {
      cancelReceiptViewsReview.current?.();
      cancelReceiptCamera.current?.();
    }
    return () => {
      photoCaptureAllowed.current = false;
      cancelReceiptViewsReview.current?.();
      cancelReceiptCamera.current?.();
    };
  }, [canManageProducts]);
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
  const layoutPreparationLink = useMemo(
    () =>
      new LayoutPreparationController(
        sqlite,
        { storeId, ownerId, deviceId, canPrepareCommercialWeek },
        executionDigest,
        randomUUID,
      ),
    [sqlite, storeId, ownerId, deviceId, canPrepareCommercialWeek],
  );
  const layoutIllustrations = useMemo(
    () =>
      new LayoutIllustrationRepository(
        sqlite,
        { storeId, ownerId, canPrepare: canManageProducts },
        async (text) => `sha256:${await executionDigest(text)}`,
      ),
    [sqlite, storeId, ownerId, canManageProducts],
  );
  const illustrationFileSession = useRef<{
    storeId: string;
    userId: string;
  } | null>(null);
  illustrationFileSession.current =
    session?.user.id === ownerId &&
    session.stores.some((s) => s.storeId === storeId)
      ? { storeId, userId: ownerId }
      : null;
  useEffect(
    () => () => {
      illustrationFileSession.current = null;
    },
    [],
  );
  const illustrationFiles = useMemo(() => {
    const api = new ApiClient(getApiBaseUrl());
    return new LayoutIllustrationTransfer(
      sqlite,
      layoutIllustrations,
      {
        manifest: (store, id) =>
          withAccessToken(
            (token) => api.layoutIllustrationManifest(token, store, id),
            ownerId,
          ),
        download: (store, manifest, variant) =>
          withAccessToken(
            (token) =>
              api.downloadLayoutIllustrationFile(
                token,
                store,
                manifest,
                variant,
              ),
            ownerId,
          ),
      },
      nativeLayoutIllustrationFiles,
      () => illustrationFileSession.current,
    );
  }, [sqlite, layoutIllustrations, ownerId, withAccessToken]);
  const illustrationGeneration = useMemo(() => {
    const api = new ApiClient(getApiBaseUrl());
    return {
      repository: new LayoutIllustrationGenerationRepository(
        sqlite,
        { storeId, ownerId, canPrepare: canManageProducts },
        async (text) => `sha256:${await executionDigest(text)}`,
      ),
      quote: (id: string) =>
        withAccessToken(
          (token) => api.layoutIllustrationQuote(token, storeId, id),
          ownerId,
        ),
    };
  }, [sqlite, storeId, ownerId, canManageProducts, withAccessToken]);
  const layoutScenarios = useMemo(
    () => new CopilotStoreLayoutScenarioReader(sqlite, { storeId, ownerId }),
    [sqlite, storeId, ownerId],
  );
  const layoutEdits = useMemo(
    () =>
      new CopilotStoreLayoutEditController(
        sqlite,
        {
          storeId,
          ownerId,
          deviceId,
          canManageStoreLayout: canManageStoreSettings,
        },
        randomUUID,
      ),
    [sqlite, storeId, ownerId, deviceId, canManageStoreSettings],
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
  const storeConflicts = useMemo(
    () =>
      new CopilotStoreConflictController(
        sqlite,
        {
          storeId,
          ownerId,
          deviceId,
          canCaptureStoreEvents,
          canManageStoreSettings,
          canManageStoreLayout: canManageStoreSettings,
          canManageVisualLibrary: canManageProducts,
          canManageProducts,
          canManageCommercialChoices: canManageProducts,
          canPrepareCommercialWeek: canManageProducts,
          canValidateCommercialPlan: canManageProducts,
          canManageCommercialReferences: canManageProducts,
          canDeclareCommercialExecution,
        },
        executionDigest,
        randomUUID,
      ),
    [
      sqlite,
      storeId,
      ownerId,
      deviceId,
      canCaptureStoreEvents,
      canManageStoreSettings,
      canManageProducts,
      canDeclareCommercialExecution,
    ],
  );
  const receiptRecoveries = useMemo(
    () =>
      new CopilotReceiptRecoveryController(
        sqlite,
        { storeId, ownerId, deviceId, canRecoverWaste: canManageProducts },
        executionDigest,
        randomUUID,
      ),
    [sqlite, storeId, ownerId, deviceId, canManageProducts],
  );
  const receiptCorrections = useMemo(
    () =>
      new CopilotReceiptCorrectionController(
        sqlite,
        { storeId, ownerId, deviceId, canCorrectWaste: canManageProducts },
        executionDigest,
      ),
    [sqlite, storeId, ownerId, deviceId, canManageProducts],
  );
  const receiptPublications = useMemo(
    () =>
      new CopilotReceiptPublicationController(
        sqlite,
        { storeId, ownerId, deviceId, canPublishWaste: canManageProducts },
        executionDigest,
        randomUUID,
      ),
    [sqlite, storeId, ownerId, deviceId, canManageProducts],
  );
  const identityReviews = useMemo(
    () =>
      new CopilotIdentityReviewController(
        sqlite,
        { storeId, ownerId, deviceId, canManageProducts },
        randomUUID,
      ),
    [sqlite, storeId, ownerId, deviceId, canManageProducts],
  );
  const transcriptionReview = useMemo(
    () =>
      new CopilotTranscriptionReviewController(
        sqlite,
        {
          storeId,
          ownerId,
          deviceId,
          canReviewTranscriptions: canManageProducts,
        },
        executionDigest,
      ),
    [sqlite, storeId, ownerId, deviceId, canManageProducts],
  );
  const {
    syncNow,
    emailIntake,
    lastSyncedAt,
    originals,
    visuals: visualFiles,
  } = useSync();
  const visualSourcePort = useMemo(
    () =>
      originals
        ? createVisualSourcePhotoPort(
            storeId,
            originals,
            nativeVisualFileStorage,
          )
        : undefined,
    [storeId, originals],
  );
  const visualActions = useMemo(
    () =>
      new CopilotVisualActionController(
        sqlite,
        {
          storeId,
          ownerId,
          deviceId,
          canManageVisualLibrary: canManageProducts,
        },
        executionDigest,
        randomUUID,
        undefined,
        visualSourcePort,
      ),
    [sqlite, storeId, ownerId, deviceId, canManageProducts, visualSourcePort],
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
  const recommendationDecisions = useMemo(
    () =>
      new CopilotDecisionRepository(
        sqlite,
        { storeId, ownerId, deviceId, canDecide: true },
        executionDigest,
        randomUUID,
      ),
    [sqlite, storeId, ownerId, deviceId],
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
  const actionExecutions = useMemo(
    () =>
      new CopilotActionExecutionRepository(
        sqlite,
        { storeId, ownerId, deviceId, canRecord: true },
        executionDigest,
        randomUUID,
      ),
    [sqlite, storeId, ownerId, deviceId],
  );
  const executionLinks = useMemo(
    () =>
      new CopilotExecutionLinkRepository(
        sqlite,
        { storeId, ownerId, deviceId, canLink: true },
        executionDigest,
        randomUUID,
      ),
    [sqlite, storeId, ownerId, deviceId],
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

  const [emailConversation, setEmailConversation] = useState<string>();
  const [emailConfigurationRevision, setEmailConfigurationRevision] =
    useState(0);
  const emailNavigation = useRef<(() => void) | undefined>(undefined),
    emailMounted = useRef(true);
  useEffect(() => {
    emailMounted.current = true;
    return () => {
      emailMounted.current = false;
    };
  }, []);
  function closeEmail(after?: () => void) {
    if (Platform.OS === "ios") emailNavigation.current = after;
    setEmailConversation(undefined);
    setEmailConfigurationRevision((value) => value + 1);
    setImportMessageRevision((value) => value + 1);
    if (Platform.OS !== "ios") after?.();
  }

  useEffect(() => {
    if (!canManageProducts) {
      emailNavigation.current = undefined;
      setEmailConversation(undefined);
    }
  }, [canManageProducts]);

  const renderProposal = (
    message: CopilotMessage,
    onSubmitted: () => Promise<void>,
  ) => {
    try {
      readCopilotImportReference(message);
      return (
        <MercalysImportCard
          key={message.id}
          message={message}
          canOpen={!!canManageProducts}
          onOpen={() => setIntakeConversation(message.conversationId)}
        />
      );
    } catch {
      /* Other private artifacts follow. */
    }
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
      readStoreLayoutScenarioCard(message);
      return (
        <StoreLayoutScenarioCard
          key={message.id}
          message={message}
          reader={layoutScenarios}
          illustration={{
            repository: layoutIllustrations,
            files: illustrationFiles,
            generation: illustrationGeneration,
            deviceId,
            canPrepare: canManageProducts,
          }}
          preparation={
            canPrepareCommercialWeek ? layoutPreparationLink : undefined
          }
        />
      );
    } catch {
      /* Other artifacts follow. */
    }
    try {
      readCopilotLayoutEditProposal(message);
      return (
        <StoreLayoutEditCard
          key={message.id}
          message={message}
          controller={layoutEdits}
          canConfirm={canManageStoreSettings}
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
      readStoreConflictProposal(message);
      return (
        <StoreConflictCard
          key={message.id}
          message={message}
          controller={storeConflicts}
        />
      );
    } catch {
      /* Other artifacts follow. */
    }
    try {
      readReceiptRecoveryProposal(message);
      return (
        <ReceiptRecoveryCard
          key={message.id}
          message={message}
          controller={receiptRecoveries}
          canConfirm={canManageProducts}
        />
      );
    } catch {
      /* Other artifacts follow. */
    }
    try {
      readReceiptCorrectionProposal(message);
      return (
        <ReceiptCorrectionCard
          key={message.id}
          message={message}
          controller={receiptCorrections}
          canConfirm={canManageProducts}
        />
      );
    } catch {
      /* Other artifacts follow. */
    }
    try {
      readReceiptPublicationProposal(message);
      return (
        <ReceiptPublicationCard
          key={message.id}
          message={message}
          controller={receiptPublications}
          canConfirm={canManageProducts}
        />
      );
    } catch {
      /* Other artifacts follow. */
    }
    try {
      readIdentityReviewProposal(message);
      return (
        <IdentityReviewCard
          key={message.id}
          message={message}
          controller={identityReviews}
          canConfirm={canManageProducts}
        />
      );
    } catch {
      /* Other artifacts follow. */
    }
    try {
      readTranscriptionReviewProposal(message);
      return (
        <TranscriptionReviewCard
          key={message.id}
          message={message}
          controller={transcriptionReview}
          canConfirm={canManageProducts}
          onSaved={() => {
            void syncNow(storeId).catch(() => undefined);
          }}
        />
      );
    } catch {
      /* Other artifacts follow. */
    }
    try {
      readVisualActionProposal(message);
      return (
        <VisualActionCard
          key={message.id}
          message={message}
          controller={visualActions}
          canConfirm={canManageProducts}
          onSaved={() => {
            void syncNow(storeId).catch(() => undefined);
          }}
          retryFile={async (assetId) => {
            await visualFiles?.retry(assetId);
          }}
          requestPreview={async (assetId) => {
            await visuals.requestPreview(assetId);
            await syncNow(storeId);
          }}
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
      readRecommendationTrackingCard(message);
      return (
        <RecommendationDecisionCard
          key={message.id}
          message={message}
          repository={recommendationDecisions}
          canConfirm={true}
        />
      );
    } catch {
      /* Other artifacts follow. */
    }
    try {
      readActionExecutionProposal(message);
      return (
        <ActionExecutionCard
          key={message.id}
          message={message}
          repository={actionExecutions}
          canConfirm={true}
        />
      );
    } catch {
      /* Other artifacts follow. */
    }
    try {
      readExecutionLinkProposal(message);
      return (
        <ExecutionLinkCard
          key={message.id}
          message={message}
          repository={executionLinks}
          canConfirm={true}
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
        visuals={visuals}
      />
    );
  };
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
        readReply: async (input, signal) => {
          const page = await withAccessToken((token) =>
            api.copilotHistory(
              token,
              storeId,
              input.conversationId,
              undefined,
              50,
              undefined,
              signal,
            ),
          );
          if (
            page.storeId !== storeId ||
            page.ownerId !== ownerId ||
            page.conversationId !== input.conversationId
          )
            throw Error("COPILOT_REPLY_SCOPE_INVALID");
          return page.messages.find((message) => message.id === input.replyId);
        },
        ask: (input, signal, onProgress, onActivity) =>
          withAccessToken((token) =>
            api.copilotTurn(token, storeId, ownerId, input, signal, {
              onProgress,
              onActivity,
              memorySuggestions: true,
              webResearch: true,
              recommendationTracking: true,
              executionLinks: true,
              actionExecutions: true,
              executionActuals: true,
              retailExpertise: true,
              storePhotos: true,
              choiceUpdate: canManageProducts,
              choiceRetention: canManageProducts,
              choiceCreate: canManageProducts ? 2 : false,
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
              layoutScenarios: true,
              layoutPreparation: true,
              layoutEdits: canManageStoreSettings,
              layoutInventory: canManageStoreSettings,
              storeOperations: canCaptureStoreEvents || canManageStoreSettings,
              needProposals: canManageProducts,
              storeConflicts:
                canCaptureStoreEvents ||
                canManageStoreSettings ||
                canManageProducts
                  ? 7
                  : false,
              receiptRecovery: canManageProducts,
              receiptCorrection: canManageProducts ? 2 : false,
              receiptPublication: canManageProducts,
              identityReview: canManageProducts,
              visualActions: canManageProducts ? 3 : false,
              transcriptionReview: canManageProducts,
              catalogueProposals: canManageProducts ? 2 : false,
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
  const photographReceipt = async (
    conversationId: string,
    signal: AbortSignal,
    capacity: number,
  ) => {
    if (signal.aborted) throw Error("COPILOT_ATTACHMENT_CANCELLED");
    if (!photoCaptureAllowed.current)
      throw Error("COPILOT_RECEIPT_CAPTURE_FORBIDDEN");
    if (capacity < 1) throw Error("COPILOT_ATTACHMENT_LIMIT");
    if (Platform.OS === "web" || !requireOptionalNativeModule("ExpoCamera"))
      throw Error("COPILOT_RECEIPT_CAMERA_UNAVAILABLE");
    let Sheet: typeof import("@/copilot/receipt-camera-sheet").default;
    try {
      Sheet = (await import("@/copilot/receipt-camera-sheet")).default;
    } catch {
      throw Error("COPILOT_RECEIPT_CAMERA_UNAVAILABLE");
    }
    if (signal.aborted) throw Error("COPILOT_ATTACHMENT_CANCELLED");
    if (!photoCaptureAllowed.current)
      throw Error("COPILOT_RECEIPT_CAPTURE_FORBIDDEN");
    return new Promise<ReceiptPhotoSelection | undefined>((resolve) => {
      let done = false;
      const authority = {
        canCapture: () => photoCaptureAllowed.current,
        signal,
      };
      const intake = new CopilotReceiptCameraIntake(
        sqlite,
        { storeId, ownerId },
        randomUUID,
      );
      const cameraSession = new ReceiptCameraSession(authority, (selection) =>
        intake.capture(conversationId, selection, authority, capacity),
      );
      const finish = (result?: ReceiptPhotoSelection) => {
        if (done) return;
        done = true;
        cameraSession.close();
        signal.removeEventListener("abort", cancel);
        cancelReceiptCamera.current = undefined;
        setReceiptCamera(null);
        resolve(result);
      };
      const cancel = () => finish();
      cancelReceiptCamera.current = cancel;
      signal.addEventListener("abort", cancel, { once: true });
      setReceiptCamera({ session: cameraSession, Sheet, finish });
    });
  };
  const attachStorePhotos = async (
    conversationId: string,
    signal: AbortSignal,
    capacity: number,
  ) => {
    if (!photoCaptureAllowed.current)
      throw Error("STORE_PHOTO_CAPTURE_FORBIDDEN");
    if (signal.aborted) throw Error("COPILOT_ATTACHMENT_CANCELLED");
    const intake = new CopilotStorePhotoIntake(
      sqlite,
      { storeId, ownerId },
      randomUUID,
    );
    const remaining = Math.min(capacity, await intake.capacity(conversationId));
    if (remaining < 1) throw Error("STORE_PHOTO_TURN_LIMIT");
    if (!requireOptionalNativeModule("ExponentImagePicker"))
      throw Error("COPILOT_RECEIPT_PICKER_UNAVAILABLE");
    const picker = await import("expo-image-picker");
    const selected = await picker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 1,
      exif: false,
    });
    if (signal.aborted) throw Error("COPILOT_ATTACHMENT_CANCELLED");
    if (selected.canceled) return undefined;
    const assets = selected.assets.map((asset, index) => {
      const extension = resolveWasteReceiptImageExtension({
        temporaryUri: asset.uri,
        mimeType: asset.mimeType,
        originalFilename: asset.fileName,
      });
      return {
        uri: asset.uri,
        filename: asset.fileName ?? `Photo du rayon ${index + 1}.${extension}`,
        mimeType: (
          {
            jpg: "image/jpeg",
            png: "image/png",
            heic: "image/heic",
            heif: "image/heif",
          } as const
        )[extension],
      };
    });
    return intake.capture(
      conversationId,
      { assets },
      { signal, canCapture: () => photoCaptureAllowed.current },
      remaining,
    );
  };
  const attachReceipts = async (
    conversationId: string,
    signal: AbortSignal,
    capacity: number,
    grouped = false,
  ) => {
    if (!photoCaptureAllowed.current)
      throw Error("COPILOT_RECEIPT_CAPTURE_FORBIDDEN");
    if (signal.aborted) throw Error("COPILOT_ATTACHMENT_CANCELLED");
    if (capacity < 1) throw Error("COPILOT_ATTACHMENT_LIMIT");
    if (!requireOptionalNativeModule("ExponentImagePicker"))
      throw Error("COPILOT_RECEIPT_PICKER_UNAVAILABLE");
    const picker = await import("expo-image-picker");
    const selected = await picker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      allowsMultipleSelection: true,
      orderedSelection: grouped,
      selectionLimit: grouped ? MAX_RECEIPT_VIEWS : capacity,
      quality: 1,
      exif: false,
    });
    if (signal.aborted) throw Error("COPILOT_ATTACHMENT_CANCELLED");
    if (selected.canceled) return undefined;
    const assets = selected.assets.map((asset, index) => {
      const extension = resolveWasteReceiptImageExtension({
        temporaryUri: asset.uri,
        mimeType: asset.mimeType,
        originalFilename: asset.fileName,
      });
      return {
        uri: asset.uri,
        filename: asset.fileName ?? `Ticket de casse ${index + 1}.${extension}`,
        mimeType: (
          {
            jpg: "image/jpeg",
            png: "image/png",
            heic: "image/heic",
            heif: "image/heif",
          } as const
        )[extension],
      };
    });
    if (grouped) {
      if (assets.length < 2 || assets.length > MAX_RECEIPT_VIEWS)
        throw Error("COPILOT_RECEIPT_VIEW_COUNT_INVALID");
      if (signal.aborted || !photoCaptureAllowed.current)
        throw Error("COPILOT_ATTACHMENT_CANCELLED");
      const ordered = await new Promise<
        CopilotReceiptViewsSelection["assets"] | null
      >((resolve) => {
        let done = false;
        const finish = (
          value: CopilotReceiptViewsSelection["assets"] | null,
        ) => {
          if (done) return;
          done = true;
          signal.removeEventListener("abort", cancel);
          cancelReceiptViewsReview.current = undefined;
          setReceiptViewsReview(null);
          resolve(value);
        };
        const cancel = () => finish(null);
        cancelReceiptViewsReview.current = cancel;
        signal.addEventListener("abort", cancel, { once: true });
        setReceiptViewsReview({ assets, finish });
      });
      if (!ordered) return undefined;
      return new CopilotReceiptViewsIntake(
        sqlite,
        { storeId, ownerId },
        randomUUID,
      ).capture(
        conversationId,
        { mode: "ONE_RECEIPT_MULTIPLE_PHOTOS", assets: ordered },
        { canCapture: () => photoCaptureAllowed.current, signal },
        capacity,
      );
    }
    return new CopilotReceiptPhotoIntake(
      sqlite,
      { storeId, ownerId },
      randomUUID,
    ).capture(
      conversationId,
      { mode: "ONE_PHOTO_PER_RECEIPT", assets },
      { canCapture: () => photoCaptureAllowed.current, signal },
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
  const [importMessageRevision, setImportMessageRevision] = useState(0);

  const [linkError, setLinkError] = useState<string>();
  useFocusEffect(
    useCallback(() => {
      if (requestedConversation === undefined) {
        setLinkError(undefined);
        return;
      }
      const target = z.uuid().safeParse(requestedConversation);
      if (!target.success) {
        setLinkError("Le lien de conversation est invalide.");
        return;
      }
      let activeLink = true;
      // Opening is read-only and uses the existing scoped controller; URL input
      // cannot select a store/owner or create another conversation.
      void controller
        .open(target.data)
        .then(() => {
          if (!activeLink) return;
          setActive(target.data);
          setMenu(false);
          setLinkError(undefined);
          router.setParams({ conversationId: undefined });
        })
        .catch(() => {
          if (activeLink)
            setLinkError(
              "Cette conversation n’est pas disponible pour ce compte ou ce magasin. Votre conversation actuelle est conservée.",
            );
        });
      return () => {
        activeLink = false;
      };
    }, [controller, requestedConversation]),
  );
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
        if (alive && revision === topicRevision.current) setConversations(rows);
      })
      .catch(() => {
        if (alive && revision === topicRevision.current)
          setError("Les conversations locales ne peuvent pas être lues.");
      });
    return () => {
      alive = false;
    };
  }, [repo]);
  const refreshMenu = useCallback(() => {
    setMenu(true);
    setError(undefined);
    const revision = ++topicRevision.current;
    void repo
      .list()
      .then((rows) => {
        if (mounted.current && revision === topicRevision.current)
          setConversations(rows);
      })
      .catch(() => {
        if (mounted.current && revision === topicRevision.current)
          setError("Les conversations locales ne peuvent pas être lues.");
      });
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
      setMenu(true);
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
        <>
          <InlineAlert title="Conversation indisponible" message={error} />
          <SecondaryButton
            label="Relire les conversations"
            onPress={refreshMenu}
          />
        </>
      ) : null}
      {conversations
        .filter((row) => ["CONFLICT", "ERROR"].includes(row.syncState))
        .map((row) => (
          <MenuRow
            key={`review:${row.entity.id}`}
            title={`Comparer : ${row.entity.title}`}
            description="Titre, archivage et suppressions conservées"
            icon="git-compare-outline"
            onPress={() =>
              router.push(`/copilot-conversation-review/${row.entity.id}`)
            }
          />
        ))}
      {conversations
        .filter((row) => row.entity.status === "ACTIVE")
        .map((row) => (
          <ConversationMenuRow
            key={row.entity.id}
            conversation={row.entity}
            context={controller}
            enabled={!active || menu}
            onOpen={() => {
              setActive(row.entity.id);
              setMenu(false);
            }}
            onDelete={async (signal) => {
              const revision = ++topicRevision.current;
              await controller.removeConversation(row.entity.id, signal);
              const current = () =>
                mounted.current &&
                !signal.aborted &&
                revision === topicRevision.current;
              if (!current()) return;
              try {
                const rows = await repo.list();
                if (!current()) return;
                setConversations(rows);
              } catch {
                if (!current()) return;
                setError(
                  "La suppression est enregistrée, mais la liste ne peut pas être relue. Rouvrez les conversations pour réessayer.",
                );
              }
              if (active === row.entity.id) setActive(undefined);
              void syncNow(storeId).catch(() => undefined);
            }}
          />
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
        {linkError ? (
          <InlineAlert title="Conversation indisponible" message={linkError} />
        ) : null}
        {topics}
      </AppScreen>
    );
  return (
    <SafeAreaView
      edges={["top", "bottom", "left", "right"]}
      style={{ flex: 1, backgroundColor: colors.canvas }}
    >
      {linkError ? (
        <InlineAlert title="Conversation indisponible" message={linkError} />
      ) : null}
      <CopilotLocalChatPanel
        controller={controller}
        conversationId={active}
        scopeKey={`${storeId}/${ownerId}`}
        delivery={delivery}
        onConversations={refreshMenu}
        onNewConversation={() => {
          void create();
        }}
        creatingConversation={creating}
        onRemember={(message) =>
          router.push({
            pathname: "/copilot-memory",
            params: { source: message.id },
          })
        }
        onAttachPdf={attachPdf}
        onAttachStorePhotos={canManageProducts ? attachStorePhotos : undefined}
        onAttachReceipts={canManageProducts ? attachReceipts : undefined}
        onPhotographReceipt={
          canManageProducts && Platform.OS !== "web"
            ? photographReceipt
            : undefined
        }
        onAttachReceiptViews={
          canManageProducts
            ? (conversationId, signal, capacity) =>
                attachReceipts(conversationId, signal, capacity, true)
            : undefined
        }
        onOpenEmailIntake={
          canManageProducts && emailIntake
            ? () => setEmailConversation(active)
            : undefined
        }
        onOpenMercalys={
          canManageProducts ? () => setIntakeConversation(active) : undefined
        }
        externalMessageRevision={`${importMessageRevision}/${lastSyncedAt ?? ""}`}
        externalDraftRevision={draftRefresh}
        intakeSummary={
          <>
            {canManageProducts && emailIntake ? (
              <EmailInboxIndicator
                key={`${storeId}/${ownerId}/${active}`}
                inbox={emailIntake}
                conversationId={active}
                revision={lastSyncedAt}
                configurationRevision={emailConfigurationRevision}
                onOpen={() => setEmailConversation(active)}
              />
            ) : null}
            <CopilotIntakeSummary
              key={active}
              db={sqlite}
              storeId={storeId}
              ownerId={ownerId}
              conversationId={active}
              revision={intakeRevision}
              onOpen={() => setIntakeConversation(active)}
            />
          </>
        }
        renderToolMessage={renderProposal}
      />
      <Modal
        visible={!!emailConversation}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => closeEmail()}
        onDismiss={() => {
          const navigate = emailNavigation.current;
          emailNavigation.current = undefined;
          if (emailMounted.current) navigate?.();
        }}
      >
        {emailConversation && emailIntake ? (
          <EmailInbox
            key={`${storeId}/${ownerId}/${emailConversation}`}
            inbox={emailIntake}
            conversationId={emailConversation}
            initialSender={session?.user.email ?? ""}
            revision={lastSyncedAt}
            onClose={() => closeEmail()}
            onOpenSync={(id) =>
              closeEmail(() => {
                if (id)
                  router.push({
                    pathname: "/sync-conflict/[id]",
                    params: { id },
                  });
                else router.push("/sync-status");
              })
            }
          />
        ) : null}
      </Modal>
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
      {receiptCamera ? (
        <receiptCamera.Sheet
          session={receiptCamera.session}
          onSaved={receiptCamera.finish}
          onCancel={() => receiptCamera.finish()}
        />
      ) : null}
      {receiptViewsReview ? (
        <ReceiptViewsReview
          assets={receiptViewsReview.assets}
          onFinish={receiptViewsReview.finish}
        />
      ) : null}
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
import { readExecutionLinkProposal } from "@fl-copilot/domain";
import { CopilotExecutionLinkRepository } from "@/copilot/execution-link-repository";
import { ExecutionLinkCard } from "@/copilot/execution-link-card";
