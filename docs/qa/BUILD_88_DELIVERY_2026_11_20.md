# Livraison iPhone 0.1.0 (88) — 20 novembre 2026

Le build 88 est disponible dans le groupe TestFlight privé habituel. La recette
sur l'iPhone du propriétaire reste à recueillir ; disponibilité et acceptation
ne sont pas confondues.

## Périmètre

Regroupe le choix explicite du PA de PR 551 et le parcours simplifié de PR 552 :
résumé PA d'abord, ajout des prix reconnus sans session globale de catalogue,
références restantes accessibles dans le même écran et choix du prix distinct
d'une correction d'association. Le catalogue est revalidé avant l'ajout. Les
comparaisons PA automatiques de l'écran et l'attente de calculs de ventes sans
rapport sont retirées de ce parcours. Les imports de mouvements gardent leurs
confirmations et leurs jobs analytiques.

Parser, historique daté, qualification HT/unité/prix à vérifier, publication,
correction explicite, originaux, Outbox et synchronisation canoniques sont
réutilisés. Pas de migration ou de nouvelle API ; aucun import ni prix du
propriétaire n'a été modifié pendant la vérification.

## Source et contrôles

- PR 552 : tête `e4b573803c3106c541c56fc1bf96cc5158d71da4`, fusion
  `b2152fbee6d93140363b4c2ce30ef2a02bdd60ad` ; arbres testés/fusionnés identiques,
  branche du correctif supprimée.
- CI push / PR / master : 44636798315 / 44636873657 / 44638560321 réussies.
  643 suites réussies, 6 423 tests réussis, une suite et six tests ignorés.
- Local : 151 tests ciblés réussis / un non exécuté, dix projets TypeScript,
  lint et format réussis. Les nombres ne s'additionnent pas aux tests CI.
- Contrôle React : callbacks/effets et dépendances vérifiés, verrou de double
  appui, revalidation et autorités conservées, pas de nouveau lecteur réseau
  pour l'affichage de l'import. Les tests de composants ne sont pas des mesures
  de latence sur iPhone.

## Archive et distribution

- Compilation **locale sur le Mac**, profil production, signature existante
  figée, source exacte ci-dessus. Pas de build EAS cloud ni modification système.
- Version `0.1.0`, build `88`, distribution STORE vérifiée.
- SHA-256 : `1eb55bb914f661b11aaf7fddd6366d9fcd41b4d3e486a46d4123417c399fb4cd`.
- Le bundle contient les trois actions « Ajouter les PA reconnus », « Compléter
  les références restantes » et « Corriger l'association produit ». Aucun
  marqueur ni entrée de la copie de test dans le bundle.
- Envoi accepté par Apple ; build `400141d9-26ab-4a0f-ad30-78993dfdc4c0`,
  `VALID` / `IN_BETA_TESTING`, non expiré.
- App `6833595029`, bundle `com.flcopilot.mobile`, équipe `54QQCYMGXT`,
  groupe `8fb4605b-8734-4b25-aa77-dedff5126eb3`, interne, un testeur,
  propriétaire vérifié. Aucun lien public ni invitation ajouté.
- Pas de déploiement serveur. Le build 87 reste la distribution précédente ;
  ne pas en déduire la qualification d'un retour vers ses anciens lecteurs pour
  des imports ayant reçu les nouveaux choix de PA.

## Limite native et recette propriétaire

L'accès Device Hub est revenu pendant la vérification. Le nouveau harnais isolé
se compile, mais Expo Go échoue au démarrage avec un module natif ExpoAsset
manquant avant l'affichage du parcours PA. Aucune réussite visuelle du nouveau
parcours n'est revendiquée. Les configurations temporaires sont restaurées ;
les anciennes copies de test et les données utilisateur ne sont pas effacées.
Cette limite de recette Expo Go n'est pas une preuve d'erreur du build 88.

Installer la mise à jour sans désinstaller l'app, puis reprendre un import PA
partiel existant :

1. Vérifier le résumé et ajouter les PA reconnus lorsqu'il reste des lignes
   prêtes, sans terminer une session globale de confirmations.
2. Ouvrir directement les références restantes, choisir au besoin le PA d'un
   produit à plusieurs références ; l'association produit reste une action
   secondaire, jamais un préalable pour les autres PA.
3. Fermer/réouvrir et consulter l'historique conservé, sans doublon. Un fichier
   entièrement publié reste un doublon normal ; ne pas réinitialiser les imports
   pour le rendre artificiellement réimportable.

[Spécification et régression](PA_SIMPLE_IMPORT_FLOW_2026_11_20.md).
Preuves privées : `maintenance/pa-simple-flow-2026-11-20/`, hors dépôt
(reçu de livraison, CI, archive/signature, marqueurs du bundle, envoi Apple et
statut/groupe TestFlight). Ce document ne déclenche aucun autre build ou déploiement.
