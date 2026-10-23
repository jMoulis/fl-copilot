# Maintenance d’une fiche inactive — 23 octobre 2026

## Écart et correction

L’éditeur manuel charge les fiches non supprimées, y compris inactives, et conserve leur statut à la sauvegarde. Le catalogue conversationnel refusait ces mêmes fiches. Son aperçu existant permet désormais INSPECT/UPDATE par identifiant exact avec la capacité `x-copilot-catalogue-proposals: 2`. L’ancien client annonçant 1 garde son filtre initial ; versions absentes/inconnues ne donnent pas accès à cet outil.

La correction passe par la même projection partagée, la confirmation privée existante et le writer manuel : aucun changement de statut, restauration ou nouvelle permission. La carte et la preuve disent explicitement que la fiche reste inactive. Suppression logique antérieure, mauvais magasin, version concurrente, conflit, enfant refusé et droits retirés conservent leurs protections. RETIRE sur une fiche déjà inactive reste refusé. Recherche opérationnelle, rapprochements Mercalys/tickets et outil de classification gardent leur filtre actif. Aucun nouvel outil, prompt global, SDK, fournisseur, schéma de stockage ou migration.

## Preuves

- Avant correction : le client transmet 1 au lieu de 2 ; les deux cas de maintenance/revue inactive échouent avec `CATALOGUE_TARGET_UNAVAILABLE`.
- SQLite réelle sur fichier : création d’une fiche de test, statut inactif, proposition privée liée à sa conversation, correction catégorie/nature/unité, conservation des codes et alias, statut toujours inactif, exclusion de la recherche opérationnelle, fermeture/réouverture et confirmation idempotente sans commande supplémentaire.
- Refus de retrait inactif, cible supprimée et revue périmée sans commande additionnelle. Le contrat strict rejette toute tentative d’injecter `status` ou `deletedAt` dans les champs du modèle.
- MongoDB local jetable avec transactions : INSPECT/UPDATE inactifs indisponibles en mode historique, disponibles avec la capacité 2 ; aucune écriture par l’aperçu, aucun accès intermagasin et aucun accès à une fiche supprimée. Les tests existants couvrent enfants bornés, zéros initiaux et persistance atomique de la carte privée.
- Route Fastify : seules les versions exactes 1/2 ouvrent la fonction de lecture ; seule 2 lève le filtre de maintenance. Le client conserve un corps composé uniquement des identifiants de tour ; aucune autorité modèle n’est ajoutée.
- **46 tests ciblés passent** sur les cinq suites catalogue, capacité, contrat et client. Les contrôles complets, CI exactes et livraisons restent à consigner.

Les données de test sont uniquement locales/jetables. La vérification en lecture seule du magasin pilote n’a trouvé aucune fiche inactive non supprimée ; aucune donnée de production n’a été fabriquée pour cette recette. Aucun appel IA réel, clé ou fichier secret lu, nouveau build EAS ou déploiement isolé.

## Livraison et limites

Ce lot attend une livraison API/native cohérente et n’est pas dans le build 13 déjà disponible. Livrer l’API compatible avant le client annonçant la capacité 2 ; un serveur antérieur ne reconnaît pas cette nouvelle annonce. L’ancien binaire conserve son comportement ; la correction inactive nécessite le futur client. Le statut d’une fiche n’est pas modifiable par ce parcours. Cela ferme une exception de maintenance, sans prouver les autres parcours métier, gestes/accessibilité sur appareil, restauration sur second appareil ni la V1/M8 complète. Sept chantiers inchangés : 1/3/4/5/6/7 en cours ; 2 code prêt.
