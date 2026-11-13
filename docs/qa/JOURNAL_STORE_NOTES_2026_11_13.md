# Journal — notes générales du magasin

## Parcours

Journal → Notes du magasin → Noter. La journée sélectionnée est conservée ; le
texte est obligatoire et le dernier jour inclusif facultatif. La saisie peut
concerner une période déclarée à venir, sans la transformer en événement observé.
La date/heure réelle de saisie reste distincte. Fermeture avec un brouillon :
confirmation d'abandon. Enregistrement local, puis synchronisation asynchrone ;
une panne réseau ne retire pas la note. Le texte est copiable.

Retirer demande confirmation et conserve l'original et son historique. Les notes
retirées restent consultables depuis la journée concernée, mais sont exclues de
la lecture analytique. Une correction est une nouvelle note explicite après
retrait, sans écraser le premier texte. Pas de taxonomie imposée, d'appel IA à la
saisie, de produit fictif, de collecte externe ni de modification des KPI.

## Contrat et compatibilité

SQLite 64, Mongo 60 ; entité `store_journal_note`, original immuable et retrait
monotone. Outbox atomique, commandes idempotentes, filtre magasin et bootstrap /
pull avec `journalNotes=true`. L'adoption initiale force la récupération des notes
même si un ancien client avait déjà dépassé leur séquence. Une création ou un
accusé tardif ne peut réactiver une note retirée. Le retrait reprend la capture
exacte pour vérifier qu'il concerne bien le texte montré au gestionnaire.

Le copilote utilise `store_events` existant, avec productId null pour les notes
générales. La page combine cinq identifiants distincts, conserve les collisions
entre les deux espaces d'identité et reste dans l'enveloppe installée de dix faits
plus la couverture. La période, la saisie, l'identifiant et la révision sont cités.
Une note est une déclaration, pas une mesure vérifiée ni une preuve causale.

## Qualification et livraison

Tests SQLite : hors connexion, rejeu, réouverture, retrait, accusés désordonnés,
portée magasin, rollback sur changement de contexte, migration/conservation,
pagination et validation des dates. Tests natifs montés : période invalide,
conservation du brouillon, sauvegarde malgré panne réseau et abandon explicite.
Tests Mongo transactionnels : deux appareils et restauration, adoption d'un ancien
curseur, rejeu, refus d'écrasement/portée étrangère, retrait, anciens clients,
lecture bornée avec UUID identiques entre note et incident, périodes et sources.

Aucun build EAS/TestFlight, déploiement ou changement de données de production.
La validation iPhone devra être faite avec la prochaine livraison compatible.
