# M7/M8 — comparaison des réglages magasin, 24 octobre 2026

## Défauts reproduits

Sur SQLite jetable, trois résolutions non sûres réussissaient : adopter une ancienne capture malgré une autre version distante plus récente dans le groupe ; adopter cette ancienne capture après un pull plus récent ; conserver une version locale face à un payload distant nul en recréant implicitement une version 1. Le service pouvait ensuite fermer tous les conflits OPEN de ces réglages. La preuve initiale échouait dans les trois cas avant correction ; aucune donnée de production n'a été modifiée.

## Même comparaison dans les deux parcours

Le service existant `StoreContextRepository` relit l'état local, les versions distantes complètes, les conflits ouverts et les commandes concernées. Les contrôles de versions en lecture seule sont partagés avec le référentiel ; chaque domaine garde son schéma, son identité, ses droits et son writer. Aucune règle universelle de fusion ou de dernier enregistrement gagnant n'est ajoutée.

La comparaison concerne un seul magasin/UUID de configuration. Elle présente les réglages locaux actuels et la dernière version distante complète vérifiée. Une contradiction au même numéro, une identité étrangère, un payload absent, un historique trop grand, un envoi en cours ou un état local incohérent interdit le choix. Une absence non vérifiée n'autorise ni création ni retour à la version 1. Le chat exige toujours que l'aperçu serveur corresponde exactement à cette base distante ; une ancienne carte ne peut pas appliquer une version plus récente à l'insu de l'utilisateur.

La confirmation fournit l'empreinte de toute la comparaison. Elle est relue dans la transaction canonique, avec contrôle du contexte et de l'annulation avant/après les lectures et avant commit. Une nouvelle capture, un pull, une commande modifiée ou une saisie locale plus récente invalide l'ancien choix. Après confirmation explicite, tous les conflits examinés reçoivent la décision sans effacer leurs payloads. Les commandes précédentes sont conservées/supersédées, sans faux ACK ; garder le local crée une seule nouvelle commande avec la bonne précondition distante. Adopter le distant n'en crée aucune.

Le schéma et les données historiques restent compatibles. Lorsqu'une base distante plus récente vient seulement d'un pull, elle est aussi conservée comme snapshot canonique dans `store_context_history` (`RESOLUTION_REMOTE_BASELINE`), afin qu'un ACK ultérieur ne fasse pas perdre la version qui avait été comparée. Les anciens snapshots de conflits, les IDs, les coordonnées confirmées, les observations et les originaux ne sont pas réécrits.

## Écran natif

Les cartes manuelles et conversationnelles utilisent cette même revue. La page manuelle exige d'avoir comparé les versions et permet de relire la comparaison après un changement. Une erreur de lecture conserve le contenu lisible et bloque une décision fondée sur cet aperçu. Le compte/magasin/cible/appareil, la connexion SQLite et le focus bornent la durée de vie de l'action ; quitter ce contexte annule une confirmation en attente. Le double appui est bloqué avant le premier await. Les retours d'une ancienne lecture/action ne remplacent pas le contexte courant. La réussite locale reste distincte de l'envoi réseau ; un problème de sync ne présente pas la transaction locale comme perdue.

Les permissions existantes sont conservées : accès manuel du magasin actif, capacité dédiée du copilote. Aucune permission supplémentaire, nouvelle instruction du modèle, outil, endpoint, migration ou boucle de polling n'est introduit. La position complète reste dans le stockage et la revue native autorisés ; sa projection vers le modèle n'est pas élargie.

## Preuves

- **139 tests ciblés** passent : revue canonique, fichiers SQLite/restart et replay, groupes, deux choix manuel/chat, aperçu/pull obsolète, absence, contradiction/identité/version, envoi en cours, changement tardif, rollback/annulation et frontières du référentiel déjà couvertes.
- Parmi eux, **10 tests montent la vraie page React** avec le vrai service SQLite et des ports natifs simulés : consentement/double appui, erreur ciblée et reprise, compte/magasin/base/appareil/focus/démontage pendant une attente, échec de relecture avec contenu conservé, ancien callback de bouton exécuté après remplacement SQLite.
- Deux scénarios ajoutés à l'intégration Mongo transactionnelle existante exercent un vrai CONFLICT serveur sur les réglages, puis revue privée, choix, sync et seconde SQLite. Leur exécution dépend de la CI Mongo, sans appel réel de fournisseur IA.
- La suite locale passe **3 453 tests / 644 ignorés selon l’environnement**, lint/structure et dix projets typés verts. Les deux CI du commit final doivent réussir avant fusion ; l'export natif et ces ports simulés ne prouvent pas les gestes ni le stockage OS sur un téléphone.

## Livraison et limites

PR 345 est fusionnée après ses deux CI vertes ; ce complément reste dans le prochain lot natif, **hors build 14**. API compatible inchangée, pas de déploiement API ni de build EAS propre à cette correction. Recette native groupée : ouvrir une vraie comparaison de réglages, relire si une version change, confirmer un choix, revenir/redémarrer puis synchroniser sans double envoi. Ne pas créer artificiellement un conflit en production pour remplir la recette.

Les autres domaines conservent leurs politiques propres. Les sept chantiers restent : 1 Actions/conflits en cours ; 2 Contre-promotion code prêt ; 3 Documents, 4 Expertise, 5 Recommandations, 6 Implantation, 7 UX/validation en cours. La parité complète, la recette iOS/Android et toutes les autres portes V1/M8 restent ouvertes.
