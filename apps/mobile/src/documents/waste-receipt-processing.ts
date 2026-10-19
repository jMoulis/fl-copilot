import { receiptMultiViewBlockingCodes } from "@fl-copilot/domain";
import type { LocalWasteReceiptUploadJob } from "./waste-receipt-repository";
import type { WasteReceipt } from "@fl-copilot/domain";

export function receiptProcessingPresentation(
  receipt: WasteReceipt,
  job: LocalWasteReceiptUploadJob | null,
  lineCount: number,
  offline: boolean,
) {
  if (receipt.syncState === "CONFLICT")
    return {
      title: "Conflit de synchronisation",
      message:
        "Les versions sont conservées. Examinez le conflit dans Synchronisation avant toute nouvelle modification.",
      canRetry: false,
      status: "conflict" as const,
    };
  if (receipt.syncState === "ERROR")
    return {
      title: "Synchronisation à vérifier",
      message:
        "Le ticket et vos corrections restent conservés. Consultez Synchronisation pour examiner le refus.",
      canRetry: false,
      status: "error" as const,
    };
  if (receipt.processingStatus === "PUBLISHED")
    return {
      title:
        receipt.syncState === "SYNCED"
          ? "Casse synchronisée"
          : "Casse validée localement",
      message:
        receipt.syncState === "SYNCED"
          ? "La publication est conservée sur le serveur."
          : "La publication reste disponible sur cet appareil. La synchronisation reprendra avec le réseau.",
      canRetry: false,
      status:
        receipt.syncState === "SYNCED"
          ? ("synced" as const)
          : ("pending" as const),
    };
  if (
    receipt.duplicateStatus === "POSSIBLE_DUPLICATE" ||
    receipt.duplicateStatus === "CONFIRMED_DUPLICATE"
  )
    return {
      title:
        receipt.duplicateStatus === "CONFIRMED_DUPLICATE"
          ? "Doublon confirmé"
          : "Doublon à examiner",
      message:
        receipt.duplicateStatus === "CONFIRMED_DUPLICATE"
          ? "Ce ticket reste conservé et ne sera pas publié."
          : "Votre décision sur le doublon détermine la suite du traitement.",
      canRetry: false,
      status: "incomplete" as const,
    };
  if (receipt.aiStatus === "COMPLETED")
    return {
      title: lineCount === 0 ? "Aucune ligne détectée" : "À valider",
      message:
        lineCount === 0
          ? "L’analyse n’a trouvé aucune ligne lisible. Conservez ce ticket et importez une photo plus nette."
          : "Vérifiez la date, les produits et les valeurs avant de publier la casse.",
      canRetry: false,
      status: lineCount === 0 ? ("incomplete" as const) : ("local" as const),
    };
  if (receiptMultiViewBlockingCodes.includes(job?.lastError ?? ""))
    return {
      title: "Photos à examiner",
      message:
        job?.lastError === "WASTE_RECEIPT_MULTIVIEW_MODEL_CHANGED"
          ? "La configuration de cette analyse a changé. Vos photos sont conservées ; contactez le support avant de la reprendre."
          : job?.lastError === "WASTE_RECEIPT_MULTIVIEW_ATTEMPTS_EXHAUSTED"
            ? "Les tentatives d’analyse de ce ticket sont épuisées. Vos photos sont conservées ; contactez le support avant une nouvelle analyse."
            : "Vérifiez que les vues montrent un seul ticket dans l’ordre, avec un léger recouvrement. Importez les photos corrigées ; les originaux restent conservés.",
      canRetry: false,
      status: "error" as const,
    };
  const blocked = [
    "SOURCE_UPLOAD_INVALID",
    "SOURCE_UPLOAD_LOCAL_FILE_MISSING",
  ].includes(job?.lastError ?? "");
  if (blocked)
    return {
      title: "Envoi impossible",
      message:
        job?.lastError === "SOURCE_UPLOAD_LOCAL_FILE_MISSING"
          ? "La photo locale est introuvable. Le ticket et ses corrections sont conservés. Importez de nouveau la photo source."
          : "Le fichier envoyé ne correspond pas à sa source. Le ticket est conservé ; importez de nouveau l’original.",
      canRetry: false,
      status: "error" as const,
    };
  const canRetry = Boolean(job && job.status !== "RUNNING");
  if (offline)
    return {
      title: "En attente de connexion",
      message:
        "La photo, la date et les corrections restent sur cet appareil. L’envoi et l’analyse reprendront avec le réseau.",
      canRetry,
      status: "pending" as const,
    };
  if (job?.status === "RUNNING")
    return {
      title:
        receipt.aiStatus === "PROCESSING"
          ? "Analyse en cours"
          : "Envoi en cours",
      message: "Vous pouvez quitter cet écran. Vos données restent conservées.",
      canRetry: false,
      status: "pending" as const,
    };
  if (
    receipt.processingStatus === "FAILED" ||
    (job?.status === "RETRY" &&
      job.lastError &&
      job.lastError !== "NETWORK_UNAVAILABLE" &&
      job.lastError !== "SOURCE_UPLOAD_INTERRUPTED")
  )
    return {
      title: "Traitement indisponible",
      message:
        "L’envoi ou l’analyse n’a pas abouti. La source et vos corrections sont conservées. Une nouvelle tentative est prévue ; vous pouvez aussi réessayer maintenant.",
      canRetry,
      status: "error" as const,
    };
  return {
    title:
      receipt.processingStatus === "UPLOADED"
        ? "Analyse en attente"
        : "Envoi et analyse en attente",
    message:
      "Le traitement reprendra automatiquement. La date et les lignes déjà présentes restent modifiables.",
    canRetry,
    status: "pending" as const,
  };
}
