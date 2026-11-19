# Backlog produit — point du 18 novembre 2026

**19 novembre — recette iPhone choisie par le propriétaire.** Le propriétaire
demande un build local avec les lots PR 546 (Mercalys) et PR 547 (Journal), afin de
faire lui-même la recette sans attendre son retour au Mac. Ce choix remplace le
préalable de recette simulateur pour cette livraison, sans déclarer la validation
visuelle acquise. Les contrôles automatisés restent obligatoires. La livraison est
en préparation ; aucune disponibilité TestFlight nouvelle n’est encore annoncée.
La revue automatique a demandé une autorisation explicite pour fusionner dans
master et publier ; confirmation demandée dans la conversation avant cette étape.

**19 novembre — corrections du Journal en préparation, non livrées.**
Demande propriétaire : météo conservée pour les jours passés, skeleton des tâches
et icône Aujourd’hui permanente avant Actualiser. Branche `fix/journal-weather-navigation` :
conservation par journée dans les archives et SQLite existants, dates de source
préservées, repli explicite vers une prévision archivée si aucune mesure observée
n’est disponible. Les semaines passées se lisent en base ; pas d’appel fournisseur
pour les combler. Voir [le lot Journal](../qa/JOURNAL_WEATHER_CONTINUITY_2026_11_19.md).
La [PR 546](https://github.com/jMoulis/fl-copilot/pull/546) Mercalys reste séparée,
en brouillon, CI push/PR vertes (6 403 tests), recette native reportée par le propriétaire.
Le build 85 est le dernier livré ; sa rapidité et ses réouvertures sont acceptées.
Aucun nouveau build ni déploiement, les autres lots clos et reports restent inchangés.

**19 novembre — nouvelle session de confirmations en préparation, non livrée.**
Le propriétaire confirme que le build 85 est plus rapide et que les réouvertures
ne relisent plus le fichier. Il approuve maintenant le rapprochement ITM8/EAN,
la création groupée des codes inconnus, l’actualisation unique à « Terminer les
confirmations » et le nettoyage manuel réversible du catalogue. Application aux
imports conservés sans réimport ni modification des publications passées.
Implémentation sur `feat/mercalys-confirmation-session` ; recette native reportée
par le propriétaire (« Je le ferai plus tard », Mac verrouillé). Aucun nouveau
build ni déploiement. Voir [le lot et la recette restante](../qa/MERCALYS_CONFIRMATION_SESSION_2026_11_19.md).
Les autres lots validés et reports explicites restent inchangés.

**19 novembre — correctif incrémental livré, build 85 disponible.** PR 545
fusionnée (`e44be8519770acf149919bf7de47a43b61acb8b4`), CI push/PR/master
vertes. Build compilé localement sur le Mac, archive vérifiée, envoi accepté par
Apple et TestFlight privé confirmé `VALID` / `IN_BETA_TESTING`, non expiré,
propriétaire seul. Recette simulateur sur 1 226 lignes : création individuelle
427 ms, lot de 106 produits terminé en 15,1 s avec progression, réouvertures
directes après fermeture et sortie complète de l’écran. Validation iPhone encore
attendue ; première identification après redémarrage complet toujours nécessaire.
API inchangée. Le retour négatif sur build 84 ci-dessous reste son historique.

**Retour propriétaire sur build 84 : non accepté pour les PA.** Une création
relance encore la recherche complète, et la réouverture montre de nouveau
l’identification. Correctif incrémental PR 545 vérifié dans le simulateur sur
copie isolée du catalogue et fichier fourni (1 226 lignes) : création individuelle
427 ms ; lot de 106 produits terminé en 15,1 s avec progression ; réouvertures
directes, y compris après sortie complète de l’écran. Aucun nouveau build livré
à ce stade ; validation iPhone à venir, lots précédemment validés toujours clos.

**Création et réouverture des imports — build 84 disponible :** PR 544
fusionnée, CI push/PR/master vertes. Archive compilée localement et vérifiée.
Feedback immédiat d’enregistrement puis de réidentification ; suppression de la
préparation répétée à la fermeture ; réutilisation de l’analyse en mémoire si
fichier et catalogue sont inchangés. Après autorisation explicite du propriétaire,
l’envoi a été accepté par Apple. Disponible dans le TestFlight privé habituel :
`VALID` / `IN_BETA_TESTING`, non expiré, propriétaire seul.
Recette iPhone encore attendue.

**Identification des produits — build 83 :** après quatre minutes d’attente
signalées sur le build 82, PR 543 optimise les parcours répétés du catalogue et
affiche le nombre de lignes examinées dans l’aperçu. Tests de correspondance et
CI push/PR/master verts ; archive compilée localement, vérifiée, envoi accepté
par Apple. Disponible en TestFlight privé : `VALID` / `IN_BETA_TESTING`,
non expiré, propriétaire seul. Gain mesuré sur
scénario synthétique Mac, sans preuve que cela résout l’attente sur l’iPhone.
Recette propriétaire en attente ; aucune donnée ni règle de rapprochement modifiée.

**Correctif des originaux email — build 82 :** PR 542 fusionnée, CI
push/PR/master vertes. Archive compilée localement et vérifiée, envoi accepté
par Apple. Disponible en TestFlight privé : `VALID` / `IN_BETA_TESTING`,
non expiré, propriétaire seul. Corrige la récupération du chemin
local après changement du dossier iOS, pour la consultation et la reprise des
PA. Les deux traitements déjà en échec nécessitent « Reprendre ce fichier » dans
les documents reçus par email. Originaux et publications conservés, contrôles
d’intégrité maintenus. Le propriétaire ne constate plus les freezes sur le build
81 ; confirmation de la reprise PA sur iPhone attendue.

**Correctif de réactivité — build 81 :** PR 541 fusionnée, CI push/PR/master
vertes. Archive compilée localement, vérifiée et acceptée par Apple. Disponible
en TestFlight privé : `VALID` / `IN_BETA_TESTING`, non expiré, propriétaire seul. L’identification des produits rend la main
à l’interface entre petites tranches, y compris après confirmation d’un mail.
La feuille peut être fermée pendant sa lecture, qui est alors annulée. Originaux
et écritures conservés. La disparition des freezes sur iPhone et la cause de
l’erreur de synchronisation restent à confirmer.

**Correctif build 80 — 18 novembre :** PR 540 fusionnée, CI push/PR/master
vertes, archive compilée localement et vérifiée, envoi accepté par Apple.
Corrige le refus de la capacité PA dans le bootstrap mobile. Disponible en
TestFlight privé : `VALID` / `IN_BETA_TESTING`, non expiré, groupe propriétaire seul. Les blocages tactiles intermittents
restent non expliqués et non déclarés corrigés ; capture propriétaire attendue.

**18 novembre — PA quotidiens livrés, build 79 disponible :** PR 539
fusionnée après CI push/PR/master vertes. Import local XLSX/ZIP et boîte mail
magasin réutilisent les parcours Mercalys ; date d’application, sources,
historique produit, doublons, corrections et prix à vérifier sont conservés.
Build 79 compilé sur le Mac, archive vérifiée et envoi accepté par Apple ;
disponible en TestFlight privé (`VALID` / `IN_BETA_TESTING`). Recette propriétaire en attente.
Les simulations chiffrées restent reportées. Voir
[le lot PA](../qa/PURCHASE_PRICE_SOURCE_2026_11_18.md).

Build 78 confirmé disponible en test interne TestFlight (`VALID` /
`IN_BETA_TESTING`, non expiré). La recette du propriétaire reste à recueillir.

## Livré — pas de nouvelle recette sans régression

- [x] Navigation Journal / Analyses / Copilote / Imports, raccourcis Produits et
      Réglages, séparation préparation et gestion des données, retour produit contextuel.
- [x] Premier lot de défilement du chat, skeleton Analyses, couverture dans le détail
      et graphiques compacts des produits. Les retours d'usage ne valent pas
      certification de tous les gestes ou fidélité graphique intégrale aux maquettes.
- [x] Titres automatiques et renommage manuel des conversations.
- [x] Génération d'images depuis la fiche produit et aperçus transparents, avec
      suppression des libellés récurrents. Plusieurs générations réussies rapportées
      après le correctif.
- [x] Routage léger et optimisation des outils du copilote, vérifiés sur les
      scénarios rapportés. Les coûts et la qualité restent à surveiller à l'usage.
- [x] Mémoire automatique privée : nouvelle préférence retenue puis retrouvée dans
      une nouvelle discussion, validée sur le build 60.
- [x] Journal quotidien : contexte extérieur, signalements/notes, collecte et
      archives, transports configurés/filtrés et lecture par le copilote.
- [x] Moteur descriptif du Journal : calculs et restitution fonctionnelle validés.
      Le test à deux paires de jours ne qualifie pas une association ou sa stabilité.

- [x] Pilotage quotidien du Journal, tâches commerciales et pense-bêtes privés
      avec rappel facultatif : fonctionnement et rappel validés par le propriétaire.
- [x] Marché solaire et finitions Réglages / Mon magasin / Synchronisation :
      build 74 accepté sur iPhone. Parcours, formulaires et retours validés.

- [x] **Journal — indices de prix fruits/légumes INSEE** : collecte et archives
      existantes enrichies, affichage natif et restitution du copilote validés
      par le propriétaire sur build 75 le 17 novembre, après correctif serveur
      PR 534. [Sources, livraison et validation](../qa/JOURNAL_PRODUCE_PRICES_2026_11_16.md).

## Livré et accepté — actualités nationales utiles au Journal

Le propriétaire approuve le 17 novembre le premier périmètre : mouvements sociaux
et restrictions nationales utiles aux déplacements ou à l’approvisionnement,
avec trois informations pertinentes maximum par jour. Réutiliser collecte,
archives et lecteurs existants ; aucune collecte IA, nouvelle orchestration ou
souscription payante. Les grands rendez-vous sportifs/électoraux restent hors de
ce premier lot. Les lots précédemment acceptés restent clos.

[Qualification des sources et critères du lot](../qa/JOURNAL_NATIONAL_NEWS_2026_11_17.md).
Premier incrément implémenté et vérifié localement : collecte bornée, archives,
lecture Copilote et affichage natif. Dates incertaines explicitement conservées ;
déduplication par URL canonique, pas de regroupement sémantique automatique.
PR 536 fusionnée après CI push/PR vertes ; CI master verte. API publiée et saine.
Build 76 compilé localement, vérifié et envoyé à Apple ; le propriétaire confirme
« tout fonctionne ». Ce lot est clos.

## Livré et accepté — Repères du jour

Un seul accès dans le Journal ouvre une page regroupant les huit rubriques.
Le contexte INSEE devient « Prix et conjoncture » sur cette page. La météo
compacte et « Analyser cette journée » après les notes restent dans le Journal.
Conserver la date, le retour, les sources et archives existantes.
PR 537 fusionnée, CI vertes ; build 77 compilé localement et accepté à l’envoi
par Apple, confirmé disponible en test interne TestFlight (`VALID` /
`IN_BETA_TESTING`). Le propriétaire confirme « Super ça fonctionne parfaitement » :
lot clôturé.
[Suivi et vérification](../qa/JOURNAL_CONTEXT_PAGE_2026_11_18.md).

## Lot livré — Analyses et graphiques, recette iPhone en attente

Maquette validée, avec ajout demandé : retrait du sélecteur Casse PA et de
« Comprendre cette répartition », catégories compactes, anneau de répartition,
barre de navigation comme sur la maquette. Les montants et comparaisons existants
restent déterministes. PR 538 fusionnée, CI push/PR/master vertes ; build 78
compilé localement, vérifié et accepté à l’envoi par Apple. Recette propriétaire
encore en attente. [Suivi](../qa/ANALYTICS_POLISH_2026_11_18.md).

## Lot PA livré — recette iPhone en attente

PR 539 fusionnée, CI push/PR/master vertes. API en production ; build local 79
vérifié et accepté à l’envoi par Apple. Imports locaux XLSX/ZIP et email magasin,
aperçu des variations, rapprochement, doublons/corrections, sources/historique,
confirmation des PA à vérifier et synchronisation sont inclus. Les PA sont HT
par unité produit validée. ACTIF ne modifie pas le catalogue ; les montants exacts
0,01/0,001 restent exclus jusqu’à confirmation explicite. Pas de nouvelle
simulation ni de recalcul des marges officielles Mercalys. Le fichier privé
fourni a été qualifié en base de test, pas importé en production.
[Qualification, tests et livraison](../qa/PURCHASE_PRICE_SOURCE_2026_11_18.md).

## Réserves et sujets explicitement reportés

- [ ] **Sauvegarde/restauration Atlas** : réserve M8 maintenue à la demande du
      propriétaire. Activation et restauration isolée ne sont pas qualifiées.
- [ ] **Approfondissement des contre-promotions chiffrées** : report maintenu.
      L’upload quotidien des PA est livré dans le lot ci-dessus.
- [ ] **Implantation détaillée** : chantier M7-6 reporté, à reprendre avec le plan
      merchandising et les mesures utiles. Le contexte déclaré actuel reste disponible.
- [ ] **M9** : Android et qualification dédiée d'accessibilité, non démarrés.

## Évolutions à prioriser à l'usage

- [ ] Finitions UX et graphiques à partir des maquettes et de défauts concrets.
- [ ] Éventuelles extensions du contexte économique F&L ou des facteurs du
      Journal, à cadrer sur un besoin concret. Les indices INSEE, les actualités
      nationales du premier périmètre et leur navigation sont déjà livrés et acceptés.
- [ ] Évaluation de l'utilité des associations quand un historique comparable
      suffisant existe ; pas de modèle causal/prédictif déclaré validé.
- [ ] Étude du nouveau payload de la webapp Mousquetaires, gardée de côté.

Le pilote administratif de trois illustrations externes reste un ancien cas
non exécuté faute de prérequis attestés. La génération dans l'application ne
fabrique ni ses fichiers, ni ses approbations, ni son intégration passée. Toute
reprise conserve les exigences de provenance et d'import canonique.

## V2 explicitement demandée

- [ ] Génération d'images de TG ; une illustration ne prouve pas la faisabilité
      physique ou une installation réalisée.

La surveillance des coûts, de la collecte et des régressions est de la maintenance,
pas une raison de laisser ouverts indéfiniment les anciens lots acceptés.

Décision du propriétaire — 16 novembre 2026 : le détourage des photos existantes
est retiré du périmètre, jugé inutile. Ne plus le proposer comme prochain lot.
