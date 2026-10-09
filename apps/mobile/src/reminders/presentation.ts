import type { ReminderStatus } from "./repository";
export const reminderStatusLabel = (s: ReminderStatus) =>
  ({
    SCHEDULED: "Programmé sur ce téléphone",
    DISABLED: "Désactivé",
    WAITING_SYNC: "Plan à synchroniser",
    PLAN_CHANGED: "Plan modifié : rappel à revoir",
    PERMISSION_DENIED: "Notifications non autorisées",
    PAST: "Heure du rappel passée",
    LIMIT: "Limite de 32 rappels atteinte",
    ERROR: "Programmation à reprendre",
    NOT_AVAILABLE: "Nouveau build nécessaire",
    PENDING: "Programmation en attente",
  })[s];
