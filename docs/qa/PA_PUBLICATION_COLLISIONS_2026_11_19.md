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
- Contrôles locaux : structure, lint, TypeScript ; 5 517 tests réussis et 900
  ignorés dans la suite. Un test de frontière observabilité dépasse son délai
  sous charge ; relance ciblée des neuf tests réussie sans modification.
- Simulateur iPhone 17 Pro/iOS 26.3.1, Expo Go : création groupée des 709 articles
  observée, progression unique ; publication de 1 102 prix confirmée en SQLite
  et affichage « Publication à compléter » après réouverture. Une correction
  distincte est enregistrée (1 168 produits), finalisation encore en attente.

Le parcours isolé monte le composant réel en plein écran, avec SQLite/Outbox et
le fichier réel ; réseau/synchronisation distante coupés. Ce n’est pas une
qualification du geste de feuille native ni du binaire TestFlight. Le premier
conteneur de test ne fournissait pas Expo Router au bouton d’original après
publication ; il a été remplacé par ExpoRoot, sans modifier le code produit.
Le Mac s’est verrouillé pendant le dernier contrôle : la fin visuelle de la
reprise reste à vérifier. Aucune acceptation iPhone revendiquée.

Preuves privées hors dépôt : `maintenance/pa-publication-2026-11-19/`
(reproduction avant/après, journaux, parcours natif et état SQLite agrégé).
Les fichiers et le catalogue du propriétaire ne sont pas ajoutés au dépôt.
