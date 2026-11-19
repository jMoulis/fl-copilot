# Build 86 — PA et Journal, 19 novembre 2026

## Source et contrôles

- PR 546 et 547 fusionnées ; source API et iPhone :
  `3b41f8933c47cc31259a377b6649639d9ab3bb9c`.
- CI combinée push `44477241183`, PR `44477249412`, master `44478395996` :
  réussies. 6 409 tests réussis, 6 ignorés ; lint, types, format, build API et
  export mobile inclus. Suite locale : 5 515 réussis, 900 ignorés.
- Compilation sur le Mac uniquement, profil production et signatures existantes.
  Version 0.1.0 (86), archive vérifiée, SHA-256 :
  `b274b3ed7390a00baf2826e1367fd1fb7cabce7c3122143fd45876f688a9ee24`.
- Envoi direct à Apple accepté. Aucun build ni job de soumission EAS cloud.
  Le traitement Apple et l’accès au groupe privé sont vérifiés séparément ;
  un envoi accepté ne vaut pas disponibilité ni recette iPhone.

## Serveur

Déploiement production préparé sans bascule de domaine, santé JSON vérifiée avec
base connectée, puis promotion du même artefact :
`dpl_CpiUcGQ8epN92hxMKfBnVb9fomm4`. L’alias `fl-copilot.vercel.app` pointe sur ce
déploiement READY et la santé publique est correcte. Prédécesseur conservé :
`dpl_4WGdCzjpJc47sCrb1QE3q2eUUwYn` (source `6f67d2a701d77923b07ec71aa4f64fd5970b7c1a`).

## Recette propriétaire restante

Le propriétaire autorise PR/fusion et demande de tester directement sur iPhone,
remplaçant le préalable simulateur pour ce lot. Aucune validation visuelle native
n’est revendiquée. Vérifier :

1. Fichier PA conservé : nouvelle proposition groupée des codes inconnus.
2. Créations et associations successives sans identification complète à chaque clic ;
   décisions conservées après fermeture/réouverture avant finalisation.
3. « Terminer les confirmations » : une actualisation globale, puis publication
   des lignes prêtes sans doublon.
4. Journal : météo déjà sauvegardée conservée pour hier/avant-hier, qualification
   observation/prévision archivée exacte ; aucune météo inventée si archive absente.
5. Navigation rapide entre jours : skeleton, hauteur stable, icône Aujourd’hui
   permanente avant Actualiser et retour correct au jour courant.
6. Nettoyage catalogue facultatif : critères lisibles, archivage manuel réversible.

Preuves privées, hors Git : `../maintenance/pa-journal-2026-11-19/`, notamment
`stage-api.json`, `release/local-run.json`, `archive-verification.json`,
`apple-upload.json`, `apple-status.json` et copie de `apple-pilot-status.json`.
Les documents source et données magasin restent privés. Aucun nouveau build ou
déploiement n’est nécessaire pour cette mise à jour documentaire.
