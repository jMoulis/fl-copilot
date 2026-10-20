# Conflit après une suppression locale du référentiel — 20 octobre 2026

## Périmètre et décision

Chantiers 1 et 7, lots L7/L5 : compléter la comparaison existante des fiches, codes et alias lorsque la version locale a été supprimée et que la version distante complète, de même identité, est encore présente. Aucun outil IA, prompt global, moteur d’écriture, migration ou couche de synchronisation supplémentaire.

- « Maintenir ma suppression locale » : confirmation distincte du choix ; conserver la version distante comme base et appeler le writer DELETE existant dans la même transaction SQLite. Une seule nouvelle commande, nouveau UUID, version distante attendue exacte. Aucun renvoi des modifications de libellé/code de la version rejetée.
- « Annuler ma suppression et rétablir la version synchronisée » : confirmation explicite ; adopter la version distante et conserver les anciennes commandes et versions dans l’historique local. Aucun nouvel envoi. Une remise en activité ou réactivation d’alias refusé conserve son consentement supplémentaire distinct.
- La décision, les versions comparées, les anciennes commandes remplacées et le résultat privé sont conservés ensemble. Aucun changement des chiffres publiés, documents, autres codes/alias ou associations ; aucune suppression en cascade.

Les consentements internes du contrôleur sont nommés, en remplacement des quatre booléens positionnels. Le schéma de demande/journal ajoute seulement un booléen local optionnel `confirmLocalDeletionChoice`. L’IA ne peut pas fournir la décision ou le consentement par son entrée d’outil stricte. Les anciennes demandes et cartes gardent leur comportement.

## Vérifications

17 nouveaux cas SQLite : trois familles × deux décisions, fichier fermé/rouvert et reprise sans second envoi, chemin manuel commun, rollback tardif, perte des droits/annulation, consentements de réactivation séparés et garde contre identité réaffectée/suppression plus récente. Les anciennes commandes restent présentes et explicitement remplacées.

Six scénarios ajoutés à la suite Mongo transactionnelle : conflit réel sur DELETE périmé → proposition privée → confirmation SQLite → une nouvelle commande canonique ou adoption sans envoi. Maintien de suppression : push APPLIED puis ALREADY_APPLIED, DELETE reçu par le pull et appliqué sur une deuxième SQLite sans Outbox. Ces scénarios nécessitent le Mongo CI ; aucun serveur ARM local disponible, aucun changement système ou Rosetta. Les résultats effectifs sont consignés dans les preuves de CI de la PR.

Recette du vrai composant `StoreConflictCard` sur port de persistance simulé, états produits par les vrais contrôleurs SQLite : largeurs 390/320 px, comparaison seule insuffisante, choix séparé, changement de choix effaçant les deux confirmations, résolution à synchroniser versus adoption sans envoi, absence de débordement horizontal à 320 px. Captures et logs : `artifacts/catalogue-local-deletion-conflicts-2026-10-20/` dans l’espace de travail propriétaire. Le conteneur manuel authentifié n’a pas été exercé dans le navigateur. Route/données/serveur/onglet temporaires retirés.

## Livraison et limites

Code en vérification pour livraison native groupée après les CI exactes push et PR. API PR 306–311 livrée en `ace4c3e` ; iOS 0.1.0 / build 5 reste en `1e7684d` et ne contient pas ce complément. Aucun nouveau déploiement, EAS payant, appel IA réel, activation fournisseur ni accès `.env`.

Le parcours exige un conflit ouvert unique, une comparaison complète et bornée, une identité/provenance identiques et l’absence d’envoi en cours. Cible distante absente/null, identité réaffectée, plusieurs conflits simultanés, refus génériques de commande et autres récupérations documentaires restent ouverts. Une modification distante plus récente nécessite une nouvelle comparaison. L’historique de modifications non publiées est local à cet appareil ; aucune sauvegarde distante implicite n’est promise.

Recette native iPhone/Android, accessibilité/gestes, dialogue réel, parcours V1 complet et autres portes M8 restent requis. Sept états inchangés : 1/3/4/5/6/7 en cours, 2 code prêt.
