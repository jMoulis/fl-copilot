const labels: Record<string, string> = {
  product: "Produit",
  product_identifier: "Code produit",
  product_alias: "Libellé produit",
  mercalys_publication: "Publication Mercalys",
  waste_receipt_publication: "Publication de casse",
  copilot_conversation: "Conversation privée",
  copilot_message: "Message privé",
  copilot_decision: "Décision du copilote",
  copilot_layout_illustration: "Préparation d’illustration",
  email_intake_decision: "Confirmation des documents reçus par email",
  copilot_execution_link: "Association de mise en place",
  copilot_action_execution: "Réalisation déclarée",
  copilot_knowledge: "Pratique mémorisée",
  need_unit: "Unité de besoin",
  need_membership: "Association produit/besoin",
  product_substitution: "Substitution",
  store_product_event: "Signalement magasin",
  store_layout: "Plan physique du magasin",
  visual_asset: "Image produit",
  visual_identity: "Identité visuelle",
  product_visual_link: "Image associée au produit",
  store_context_settings: "Réglages du magasin",
  commercial_offer_choice: "Choix d’offre",
  commercial_week_preparation: "Préparation commerciale",
  commercial_week_plan: "Plan commercial",
  commercial_execution_task: "Suivi d’exécution",
  commercial_version_decision: "Référence PDF",
  commercial_offer_validation: "Validation commerciale",
};
export function syncFailurePresentation(
  entityType: string,
  code: string | null,
) {
  let message =
    "Le serveur a refusé cette modification. Votre saisie locale est conservée. Il faut examiner la donnée avant de créer une correction ; renvoyer la même commande conserverait le refus.";
  if (
    [
      "FORBIDDEN",
      "STORE_ACCESS_DENIED",
      "STORE_ROLE_FORBIDDEN",
      "ROLE_FORBIDDEN",
      "VISUAL_ACCESS_INVALID",
    ].includes(code ?? "")
  )
    message =
      "Vos droits actuels ne permettent pas cet envoi. Vérifiez l’accès au magasin ; la saisie locale est conservée.";
  else if (
    [
      "PRODUCT_IDENTIFIER_DUPLICATE",
      "PRODUCT_IDENTIFIER_ALREADY_EXISTS",
      "PRODUCT_IDENTIFIER_ALREADY_USED",
      "PRODUCT_IDENTIFIER_ALREADY_ASSIGNED",
    ].includes(code ?? "")
  )
    message =
      "Ce code semble déjà associé à un produit. Examinez le référentiel avant de corriger l’association.";
  if (entityType === "email_intake_decision")
    message =
      "La confirmation n’a pas été acceptée. Les originaux sont conservés. Actualisez l’email dans sa conversation, examinez le motif puis confirmez à nouveau si nécessaire.";
  if (code === "VISUAL_TARGET_UNAVAILABLE")
    message =
      "Un produit, une identité visuelle ou une image liée a été retiré ou doit être corrigé. La photo et le choix sont conservés ; reprenez d’abord la cible concernée.";
  if (
    code === "VISUAL_RIGHTS_CONFIRMATION_INVALID" ||
    code === "VISUAL_REVIEW_REQUIRED"
  )
    message =
      "Les droits ou la validation de cette image doivent être confirmés à nouveau par le responsable. La photo originale est conservée.";
  if (code === "VISUAL_ID_INVALID" || code === "VISUAL_COMMAND_INVALID")
    message =
      "Le format de ce choix n’est pas compatible avec le service. Mettez l’application à jour puis relisez la modification ; la source reste conservée.";
  if (
    entityType === "copilot_action_execution" &&
    code?.startsWith("COPILOT_ACTION_EXECUTION_")
  )
    message = code.endsWith("LIMIT")
      ? "La limite de déclarations est atteinte. Votre saisie reste sur cet appareil ; aucun historique n’est supprimé."
      : "La réalisation reste conservée. Vérifiez son conseil d’origine, ses dates et la déclaration avant de reprendre cet envoi.";
  if (
    entityType === "copilot_execution_link" &&
    code?.startsWith("COPILOT_EXECUTION_LINK_")
  )
    message =
      code === "COPILOT_EXECUTION_LINK_LIMIT"
        ? "La capacité de suivi synchronisé est atteinte. Le lien et son historique restent conservés sur cet appareil ; aucune tâche ni décision n’a été modifiée."
        : "Cette association doit être vérifiée dans sa conversation d’origine. Le lien local, le choix et la déclaration restent conservés ; renvoyer la même commande ne changera pas le refus.";
  return { label: labels[entityType] ?? "Modification locale", message };
}
