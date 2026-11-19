# PA — publication et progression, 19 novembre 2026

## Retour et cause reproduite

Le propriétaire signale une progression de création répétée trois fois et un
refus de publication malgré 1 226 lignes annoncées prêtes sur le build 86.
Le fichier réel, rejoué sur une copie isolée du catalogue, reproduit une erreur
Zod de filiation : 59 groupes de plusieurs références sont associés au même
produit et à la même date (124 lignes), avec des montants parfois différents.
Le contrat existant interdit plusieurs PA actifs par produit/date dans une source.
Ce n’est ni un appel IA, ni une erreur de lecture de l’original.

## Correctif

- Détecter ces collisions avant le compteur « prêtes » et les recontrôler lors
  de la publication/reprise. Conserver toutes les références et les montants.
- Afficher les références concernées dans Produits et réutiliser la correction
  explicite d’association/création distincte. Aucun prix choisi arbitrairement,
  aucune scission automatique de produit, aucune réécriture d’historique.
- Autoriser la publication des autres lignes, puis la reprise du même document
  après correction ; protéger les observations déjà publiées.
- Une progression de création, bouton occupé sans compteur répété ; erreurs de
  publication auprès de leur action, sans faux diagnostic d’original illisible.
- Aucune migration, aucun nouveau contrat réseau, aucune modification serveur.

## Vérifications

- Régression automatisée sur SQLite : prix identiques et différents, compteur
  corrigé, réévaluation idempotente, correction explicite proposée hors création
  groupée, publication partielle, protection des lignes déjà publiées, reprise
  sans doublon et validation du payload de synchronisation.
- Rendu React : une seule progression pendant une action, double appui protégé,
  erreur auprès du bouton Publier et absence de « Consultation impossible ».
- Fichier réel : 709 créations sur copie du catalogue ; 1 102 lignes publiées et
  124 à revoir. Après 65 corrections explicitement simulées sur cette copie,
  reprise des 124 restantes : 1 226 observations uniques, aucun remplacement.
  Ces décisions de test ne qualifient pas les associations métier réelles.
- CI push et PR sur `54dfebb59f2522fae97448137e0930de63dffc63`, puis master
  `518502738a739356c79856e3a77f7539a3a6a28f` : réussies, 6 412 tests passés,
  6 ignorés, format/compilation/export mobile réussis. PR 549 fusionnée et
  branches supprimées. Runs 44532589349 / 44532667193 / 44564656618.
- Contrôles locaux : structure, lint, TypeScript ; 5 517 tests réussis et 900
  ignorés dans la suite. Un test de frontière observabilité dépasse son délai
  sous charge ; relance ciblée des neuf tests réussie sans modification.
- Simulateur iPhone 17 Pro/iOS 26.3.1, Expo Go : création groupée des 709 articles
  observée, progression unique ; publication de 1 102 prix confirmée en SQLite
  et affichage « Publication à compléter » après réouverture. Une correction
  distincte est enregistrée (1 168 produits), puis finalisée : deux prix ajoutés,
  total 1 104 publiés. Fermeture/réouverture : ces 1 104 lignes sont conservées,
  122 restent à examiner, aucun doublon et aucun marqueur de confirmation en
  attente en SQLite. La reprise visuelle est donc vérifiée.

Le parcours isolé monte le composant réel en plein écran, avec SQLite/Outbox et
le fichier réel ; réseau/synchronisation distante coupés. Ce n’est pas une
qualification du geste de feuille native ni du binaire TestFlight. Le premier
conteneur de test ne fournissait pas Expo Router au bouton d’original après
publication ; il a été remplacé par ExpoRoot, sans modifier le code produit.
Le contrôle final a repris après déverrouillage du Mac. Les captures de publication
et de réouverture ainsi que l’enregistrement du parcours sont conservés avec les
preuves privées. Aucune acceptation iPhone revendiquée.

Preuves privées hors dépôt : `maintenance/pa-publication-2026-11-19/`
(reproduction avant/après, journaux, parcours natif et état SQLite agrégé).
Les fichiers et le catalogue du propriétaire ne sont pas ajoutés au dépôt.
