# Référentiel articles Mercalys — 20 novembre 2026

## Décision et périmètre

Le propriétaire fournit `referentiel.xlsx` : ITM, EAN, libellé, nomenclature,
PA HT, ACTIF, PV TTC et Code TVA, avec date d'application. Ce fichier alimente
les identités du catalogue et les prix datés avant les imports ventes/casse.
La nomenclature reste dans la preuve mais n'impose pas notre catégorie. Aucun
conditionnement ni unité n'est déduit d'un libellé ou d'un prix.

Le résumé annonce références conservées, fiches à créer et références à séparer.
Une confirmation explicite « Mettre à jour le référentiel » remplace les associations
ligne par ligne pour cette source officielle. Lire le fichier, le recevoir par
email ou automatiser les lots ne modifie pas le catalogue. Les anciens exports
PA à six colonnes conservent leur parcours.

## Identités et historique

- Une référence ITM distincte conserve sa propre fiche et ses prix. Les ITM sur
  huit caractères et leur représentation sur treize caractères avec exactement
  cinq zéros de préfixe sont équivalents. Les autres codes restent littéraux.
- Une fiche à une seule référence compatible est conservée avec ses catégories,
  unités, conditionnement et autres attributs. Son libellé source est actualisé.
- Plusieurs ITM regroupés, ou des propriétaires ITM/EAN contradictoires, créent
  les références distinctes puis réaffectent les seuls codes concernés. Les anciennes
  fiches et leurs ventes/casses/plans/prix restent intacts. Leur historique agrégé
  n'est pas redistribué artificiellement ; une reconstruction demanderait une revue
  des sources historiques.
- Les nouvelles fiches gardent les attributs absents UNKNOWN. En séparation, seule
  une catégorie antérieure commune est reprise ; nature/unité/conditionnement ne
  sont pas supposés. Les PA à unité inconnue restent hors calculs.
- Les références absentes du prochain fichier ne sont pas effacées. ACTIF reste
  source, sans réactivation/désactivation automatique d'une fiche. Une fiche inactive
  ou en conflit reste à vérifier séparément : les autres références peuvent être
  ajoutées puis le même fichier complété sans republier ses lignes déjà ajoutées.
- Un fichier ancien ne peut remplacer les associations/libellés d'un référentiel
  plus récent. Les corrections de même date gardent leur comparaison explicite,
  y compris lorsqu'elles portent seulement sur le PV ou la TVA.

## Prix et intégrité

PA HT, PV TTC et TVA en points de pourcentage sont conservés à la date source.
Les PA 0,01/0,001/999 ou PV 999 signalent une indisponibilité temporaire : pas de
prix affiché comme exploitable, pas de confirmation transformant ces sentinelles
en coût connu. La marge des ventes importées reste inchangée. Les montants source
exacts restent conservés.

Migration SQLite 67 : PV/TVA/statut ajoutés au registre PA existant. Catalogue,
codes, original, observations et Outbox des références prêtes sont une transaction
unique via les writers canoniques ; un échec annule cette transaction. Aperçu revalidé, double appui verrouillé,
checksum protégeant la réimportation.

Les cellules brutes restent dans rawPayload et l'original, sans seconde copie dans
normalizedPayload pour ce format. Le fichier réel passe sur SQLite isolé : 1 226
références/prix, zéro ligne restante, 172 hors base ; payload passé de 2 997 285 à
2 555 322 octets. Pas de mesure de durée sur iPhone ni de modification des données
propriétaires en production.

## Synchronisation et compatibilité

Réutilisation de MERCALYS_PUBLISH, preuve originale, Outbox et pull. Le serveur
vérifie PA/PV/TVA/statut contre le binaire. Modifier ensemble un payload et ses
observations ne remplace pas cette preuve. Les anciens exports interprétés en PA
uniquement gardent leur décodage même avec des colonnes supplémentaires.

La capacité articleReferences distingue les lecteurs compatibles : anciennes apps
exclues des nouvelles publications, adoption une fois via bootstrap. Le nouveau
client conserve ses données locales si le serveur n'est pas compatible. Déployer
l'API compatible avant le prochain build local groupé. Un retour du binaire 88 sur
une base migrée 67 n'est pas qualifié ; ne pas désinstaller ou réinitialiser.

## Vérifications et livraison

Couverture : parser PV/TVA texte et pourcentage formaté, colonnes manquantes/formules,
SQLite et rollback, source réelle, séparation des codes, réimport sans création,
exception inactive non bloquante et reprise atomique de la même source,
omission sans effacement, correction PV seul, date/catalogue, confirmation native
explicite non automatisée, preuve Mongo, rejeu et second appareil, anciens clients
et décodage historique, adoption sans boucle.

PR 555 fusionnée après CI push/PR, puis CI master réussie : 646 suites et
6 452 tests réussis, une suite et six tests ignorés. Les collisions EAN entre
deux ITM source distincts bloquent les deux références, quel que soit leur ordre ;
les autres références prêtes restent publiables. API compatible déployée avant
l'archive locale 0.1.0 (89), contenant aussi le scan de PR 554.
[Livraison et statut Apple](BUILD_89_DELIVERY_2026_11_20.md).
La recette physique reste ouverte :

1. Depuis Imports, lire créations/séparations puis confirmer le référentiel.
   Vérifier les deux bananes bio et leurs prix/source ; unité absente à préciser,
   référence hors base sans prix 999 exploitable.
2. Fermer/réouvrir, synchroniser, vérifier sur l'autre appareil ; réimporter sans
   doublon puis ajouter un nouveau snapshot daté.
3. Importer ventes/casse : codes reconnus automatiquement, sans fusionner les
   références ni rattacher à nouveau celles déjà enregistrées.
4. Vérifier scan connu/inconnu et retour catalogue de PR 554.

Preuve privée : `maintenance/article-reference-2026-11-20/realfile.json`, hors dépôt.
