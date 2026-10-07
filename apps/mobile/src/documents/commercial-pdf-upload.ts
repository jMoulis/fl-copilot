import type { LocalSourceDocument } from "@fl-copilot/domain";
export function commercialPdfUploadPresentation(
  document: LocalSourceDocument,
  job: { status: string; last_error: string | null } | null,
) {
  if (document.remoteUploadStatus === "CONFIRMED")
    return {
      title: "Document envoyé",
      message:
        "L’original reste conservé sur cet appareil. Analyse commerciale en attente.",
      canRetry: false,
    };
  if (job?.last_error === "SOURCE_UPLOAD_LOCAL_FILE_MISSING")
    return {
      title: "Fichier local indisponible",
      message:
        "L’original n’a pas été retrouvé sur cet appareil. L’envoi ne peut pas reprendre avec ce fichier.",
      canRetry: false,
    };
  if (
    document.remoteUploadStatus === "INVALID" ||
    job?.last_error === "SOURCE_UPLOAD_INVALID"
  )
    return {
      title: "Envoi à vérifier",
      message:
        "Le fichier envoyé ne correspond pas au document enregistré. Aucune analyse n’a été lancée.",
      canRetry: false,
    };
  if (job?.status === "RUNNING" || document.remoteUploadStatus === "UPLOADING")
    return {
      title: "Envoi en cours",
      message: "Le PDF est transféré vers le stockage privé.",
      canRetry: false,
    };
  return {
    title: job?.status === "RETRY" ? "Envoi à reprendre" : "Envoi en attente",
    message:
      "Le PDF reste disponible sur cet appareil. L’envoi reprendra lorsque la connexion sera disponible.",
    canRetry: job?.status === "PENDING" || job?.status === "RETRY",
  };
}
