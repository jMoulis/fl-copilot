const labels: Record<string, string> = {
  product: "Produit",
  product_identifier: "Code produit",
  product_alias: "Libellé produit",
  mercalys_publication: "Publication Mercalys",
  waste_receipt_publication: "Publication de casse",
  copilot_conversation: "Conversation privée",
  copilot_message: "Message privé",
  copilot_knowledge: "Pratique mémorisée",
  need_unit: "Unité de besoin",
  need_membership: "Association produit/besoin",
  product_substitution: "Substitution",
  store_product_event: "Signalement magasin",
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
  return { label: labels[entityType] ?? "Modification locale", message };
}
