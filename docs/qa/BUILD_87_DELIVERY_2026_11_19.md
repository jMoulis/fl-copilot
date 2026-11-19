# Livraison iPhone 0.1.0 (87) — 19 novembre 2026

Correctif [PR 549](https://github.com/jMoulis/fl-copilot/pull/549), fusionné dans
`518502738a739356c79856e3a77f7539a3a6a28f`. CI push/PR puis master réussies,
6 412 tests passés et 6 ignorés ; branches du correctif supprimées.
Runs 44532589349 / 44532667193 / 44564656618.

## Périmètre

Une seule progression pendant la création des produits PA. Les références
associées au même produit pour une même date sont examinées avant publication,
avec leurs prix affichés ; aucun montant n’est choisi arbitrairement. Les autres
prix peuvent être publiés puis le même document complété sans doublon. Les
créations existantes et les observations déjà publiées restent conservées.
Une erreur de publication apparaît près de l’action avec le titre approprié.

[Recette et limites](PA_PUBLICATION_COLLISIONS_2026_11_19.md) : fichier réel de
1 226 lignes jusqu’à publication complète sur base isolée ; simulateur, création
groupée de 709 produits, publication de 1 102 prix, correction d’une association,
finalisation, ajout de deux prix et réouverture avec 1 104 prix conservés.
Contrôle SQLite : aucun doublon, aucune confirmation laissée en attente.

## Identité et distribution

- Source : `518502738a739356c79856e3a77f7539a3a6a28f`.
- Compilation **locale sur le Mac**, profil production ; aucun build EAS cloud.
- Archive vérifiée : version `0.1.0`, build `87`.
- SHA-256 : `81daedfc4de8bd141cd1bfed01dea80da6ab837bbc1621895164b64a2ff4ad9b`.
- Envoi accepté par Apple ; traitement `VALID`, état `IN_BETA_TESTING`, non expiré.
- Accès au build vérifié dans le groupe privé interne, propriétaire seul ;
  identifiant Apple `ecbfb7ed-8979-4125-ab21-e6fa5b5a6a84`.
- Cible inchangée : App Store Connect `6833595029`, bundle
  `com.flcopilot.mobile`, équipe `54QQCYMGXT`, groupe interne privé habituel
  `8fb4605b-8734-4b25-aa77-dedff5126eb3`, propriétaire seul.
- API inchangée : le déploiement météo de PR 547 reste en service.

La validation physique du build 87 par le propriétaire reste attendue. Cette
livraison ne rouvre pas les lots acceptés ni les reports. Les associations
corrigées dans la copie de test ne sont pas appliquées au catalogue réel.

Preuves privées : `maintenance/pa-publication-2026-11-19/release/`
(`local-run.json`, `archive-verification.json`, `apple-upload.json`,
`apple-status.json`, état du groupe pilote) et `visual/` (captures, vidéo,
vérification SQLite). Aucun original ni catalogue propriétaire dans le dépôt.
