import type { OutboxDatabase } from "./outbox-repository";
export interface PendingWorkGroup {
  label: string;
  count: number;
  state: string;
  code: string | null;
}
export async function readPendingWork(
  db: OutboxDatabase,
  storeId: string,
  ownerId?: string,
): Promise<PendingWorkGroup[]> {
  const jobs = await db.getAllAsync<{
    type: string;
    status: string;
    count: number;
    last_error: string | null;
  }>(
    `SELECT type,status,COUNT(*) AS count,MAX(last_error) AS last_error FROM local_jobs
 WHERE json_extract(payload_json,'$.storeId')=? AND status IN ('PENDING','RETRY','RUNNING','FAILED','WAITING_INPUT')
 AND (CASE WHEN type IN ('COMMERCIAL_ANALYSIS_RESUME','VISUAL_FILE_TRANSFER','SOURCE_ORIGINAL_TRANSFER','EMAIL_ORIGINAL_TRANSFER','EMAIL_INTAKE_PROCESS') OR (type='SOURCE_UPLOAD_AND_REGISTER' AND EXISTS (SELECT 1 FROM source_documents d WHERE d.id=json_extract(local_jobs.payload_json,'$.sourceDocumentId') AND d.source_type='STORE_PHOTO')) THEN json_extract(payload_json,'$.ownerId')=? ELSE 1 END)
 GROUP BY type,status ORDER BY type,status LIMIT 20`,
    storeId,
    ownerId ?? null,
  );
  const commands = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM sync_outbox WHERE store_id=? AND status IN ('PENDING','SYNCING') AND (entity_type!='email_intake_decision' OR json_extract(payload_json,'$.ownerId')=?)`,
    storeId,
    ownerId ?? null,
  );
  return [
    ...(Number(commands?.count) > 0
      ? [
          {
            label: "Modifications à envoyer",
            count: Number(commands!.count),
            state: "En attente d’envoi",
            code: null,
          },
        ]
      : []),
    ...jobs.map((j) => ({
      label:
        j.type === "EMAIL_INTAKE_PROCESS"
          ? "Traitement des fichiers reçus par email"
          : j.type === "EMAIL_ORIGINAL_TRANSFER"
            ? "Pièces jointes reçues par email"
            : j.type === "SOURCE_ORIGINAL_TRANSFER"
              ? "Récupération des originaux"
              : j.type === "ANALYTICS_RECOMPUTE_PRODUCT_DATES"
                ? "Calcul des indicateurs locaux"
                : j.type === "SOURCE_UPLOAD_AND_REGISTER"
                  ? "Envoi et vérification des fichiers"
                  : j.type === "VISUAL_FILE_TRANSFER"
                    ? "Images des produits"
                    : j.type === "COMMERCIAL_ANALYSIS_RESUME"
                      ? "Demandes de reprise d’analyse commerciale"
                      : "Traitement local",
      count: Number(j.count),
      state:
        j.status === "WAITING_INPUT"
          ? "Information à confirmer"
          : j.status === "RUNNING"
            ? "En cours"
            : j.status === "RETRY"
              ? "Nouvelle tentative en attente"
              : j.status === "FAILED"
                ? "Échec à examiner"
                : "En attente",
      code:
        j.last_error && /^[A-Z][A-Z0-9_]{2,90}$/.test(j.last_error)
          ? j.last_error
          : null,
    })),
  ];
}
