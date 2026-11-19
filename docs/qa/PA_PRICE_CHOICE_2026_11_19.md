# Choix explicite du PA — 19 novembre 2026

Le propriétaire confirme que les deux références « ABRICOT VRAC » représentent
le même article. Réassocier leurs codes à la même fiche ne résout pas le conflit
de prix/date ; il souhaite choisir le PA à retenir, sans créer deux produits.

## Comportement

- Choix par référence, prix HT et date dans l'import existant. Aucun prix par
  défaut ni règle arbitraire par montant, position ou activité déclarée.
- Brouillon privé conservé par magasin, utilisateur et empreinte du fichier,
  modifiable avant publication. Pas de changement des identifiants produit.
- Une observation pour le produit/date choisi. Les alternatives restent dans
  l'original et les lignes source avec le statut existant `IGNORED`, l'auteur,
  la date de décision et la référence retenue. Elles ne comptent plus à résoudre.
- Publication partielle et reprise sur les imports existants ; une observation
  déjà publiée reste figée. Retenir celle-ci peut écarter une alternative sans
  ajouter ni remplacer de prix. Nouvelle date/fichier : nouveau choix explicite.
- Transaction SQLite et Outbox `MERCALYS_PUBLISH`, vérification serveur de
  l'original, reprise et pull existants. Pas de migration ni nouvelle API.

## Vérifications

Tests ciblés : choix initial/continuation, brouillon et isolation utilisateur,
changement d'association, réouverture, réception répétée, absence de création
produit, prix déjà publié figé, exclusion sans nouveau prix, action affichée et
choix conservé après démontage de l'écran.

Fichier fourni, 1 226 lignes, copie isolée enrichie des deux codes lus dans le
catalogue pilote : un seul PA Abricot publié, alternative conservée, aucun
Abricot à résoudre à la réouverture. Le prix de 2,85 € est choisi **uniquement
dans ce test** ; aucune donnée de production modifiée. Le fichier de référence
est daté du 14 novembre, ce n'est pas une extraction de l'état actuel de l'iPhone.

Recette visuelle : **en attente**, Mac verrouillé et déverrouillage automatique
échoué ; demande au propriétaire envoyée. Copie isolée préparée pour le simulateur,
aucune modification de son catalogue réel. Aucun build ni déploiement livré à ce
stade. Les lots précédents clos et les reports explicites restent inchangés.

Preuves privées : `maintenance/pa-apricot-2026-11-19/`, hors dépôt.
