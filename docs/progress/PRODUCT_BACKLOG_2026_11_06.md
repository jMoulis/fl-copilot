# Backlog produit — point du 20 novembre 2026

**22 novembre — propositions d’enrichissement prêtes, application native non activée.**
Lecture déterministe des libellés du référentiel : nature vrac/conditionné, contenu
explicite et marqueur Petit Prix. Les conditionnements fournisseur restent séparés,
les valeurs existantes sont conservées et l’unité des quantités historiques n’est
pas déduite. Essai isolé sur 421 références : 194 natures, 82 contenus et 16 marqueurs
proposés ; aucune écriture. Maquettes du parcours à valider avant intégration native,
confirmation canonique avec revue des conflits, reconstruction et éventuel reset.
[Preuves et limites](../qa/PROCUREMENT_ENRICHMENT_2026_11_22.md).

**22 novembre — rattachements des offres aux fiches existantes : code prêt, non activé.**
Relecture partagée du PLU dans l’original référentiel (alias ITM8 accepté), sans
changer la normalisation financière. Confirmation explicite d’un lot, historique
immuable et retrait versionné ; le serveur vérifie l’original et les propriétaires
ITM/EAN actuels. SQLite 70 / Mongo 65, canal de synchronisation distinct et désactivé
au runtime. Essai isolé sur les vrais fichiers : 1 226 références, 421 propositions
confirmées en une commande, 63 non retenues ; aucun produit créé, aucun PA écrit.
Les 333 candidats ITM restent des propositions à confirmer, pas des équivalences
automatiquement validées. Enrichissement et maquettes/écrans restent à faire, puis
recette de reconstruction et accord final de reset. Aucun build/déploiement.
[Preuves et limites](../qa/PROCUREMENT_LINKS_2026_11_22.md).

**21 novembre — publication synchronisée des offres : code prêt, non activé.**
Confirmation locale atomique (aperçu + original privé + une commande), vérification
serveur du PDV configuré et du SHA-256, reprise et synchronisation sur un second
appareil. Pas de fiche produit créée ni de PA Mercalys modifié. Migration locale 69,
Mongo 64 ; champ PDV protégé pour les anciennes versions et nouveau canal opt-in.
Le vrai JSON passe depuis une copie SQLite rouverte : 691 offres / 421 tarifs,
une publication, zéro doublon au second passage. Stockage Blob simulé localement,
aucun accès production. Il reste les rattachements, enrichissements, maquettes et
écrans (dont revue des conflits), puis recette de reconstruction et accord de reset.
Aucun build/déploiement. [Recette backend](../qa/PROCUREMENT_PUBLICATION_2026_11_21.md).

**21 novembre — offres datées : parseur et stockage local de l'aperçu.**
Contrats partagés, migration 68 et brouillon privé durable. Le vrai JSON donne 691
offres et 421 tarifs ; les offres sans tarif restent inconnues. Double import,
reprise après fermeture et rollback contrôlés sans toucher aux produits ni aux PA.
Publication serveur/synchro, autorité PDV et original privé restent à implémenter,
puis maquette avant intégration des écrans. Aucun reset ni livraison native.
[Détail du sous-lot](../qa/PROCUREMENT_STAGING_2026_11_21.md).

**21 novembre — catalogue commercial et offres de commande : premier socle.**
Le propriétaire approuve un lot référentiel Mercalys + JSON manuel des offres,
enrichissement des unités/conditionnements et recette depuis une base vide. Le
reset bêta sera soumis à un périmètre concret et à une confirmation finale ; aucun
effacement ni réassociation production. Product reste la fiche commerciale ; les
offres ne créent pas chacune une fiche. Premier incrément : contrats d’identité et
correspondance partagée pure, 88 PLU, 333 candidats ITM, un conflit et 62 absents
sur les vrais exports. Import natif inchangé. Commandes/réceptions et nouvelles
fonctions IA hors lot initial. [Modèle et étapes](../specs/PROCUREMENT_CATALOGUE_FUNCTIONAL_SPEC.md).

**20 novembre — reprise de synchronisation du référentiel en correction.**
Retour build 89 : arrêt apparent après chaque centaine de commandes et erreur
EMAIL_INTAKE_ORIGINAL_CHANGED. Le cycle doit enchaîner les requêtes bornées de
produits/codes sans nouvel appui. Diagnostic email séparé en attente du fichier
concerné ; aucun archivage du catalogue pendant la synchronisation partielle.
[Suivi et régression](../qa/SYNC_CATALOGUE_DRAIN_2026_11_20.md).

**20 novembre — référentiel et scan disponibles sur TestFlight 89.**
PR 554/555 fusionnées, CI push/PR/master vertes ; API compatible déployée et
santé/base vérifiées avant l’archive. Référentiel PA HT/PV TTC/TVA à confirmation
unique, séparation des ITM sans réécriture des anciens historiques, sentinelles
hors calculs, attributs absents UNKNOWN. Scan EAN exact et local depuis Produits.
Archive locale 0.1.0 (89) vérifiée, Apple VALID / IN_BETA_TESTING, non expirée ;
groupe privé habituel, propriétaire seul. Preuves et recette dans [la livraison 89](../qa/BUILD_89_DELIVERY_2026_11_20.md).
**Recette iPhone encore ouverte.** Aucun import propriétaire exécuté, aucun build
cloud. Migration 67 : ne pas désinstaller/réinitialiser ni considérer un retour
au binaire 88 comme qualifié. Les lots clos et reports explicites restent inchangés.

**20 novembre — parcours PA simplifié livré, build 88 disponible.**
PR 552 fusionnée, CI push/PR/master vertes ; archive compilée localement,
vérifiée et disponible dans le groupe TestFlight privé habituel, propriétaire
seul. Résumé PA, ajout des prix reconnus sans finalisation globale de catalogue,
suite directe de l'import partiel et choix du PA distinct de la réassociation.
Les choix de PR 551 sont inclus. Aucun build cloud ni changement d'API.
**Recette iPhone du propriétaire en attente.** La tentative Expo Go isolée reste
bloquée au démarrage par un module natif manquant, pas présentée comme validée.
[Livraison, preuves et courte recette](../qa/BUILD_88_DELIVERY_2026_11_20.md).
Les imports existants, originaux et historiques sont conservés, sans remise à zéro.

**19 novembre — choix explicite du PA pour un même article : recette en cours.**
Le propriétaire confirme que plusieurs références peuvent désigner une seule
fiche et souhaite retenir un PA. Choix par prix/code/date, alternatives conservées,
reprise des imports existants et brouillon persistant. Tests ciblés et fichier
fourni vérifiés sur copie isolée ; contrôle visuel en attente du déverrouillage
du Mac. Aucun nouveau build livré : le build 87 reste la version TestFlight.
Voir [le lot](../qa/PA_PRICE_CHOICE_2026_11_19.md). Les reports et lots clos restent
inchangés. La demande de remise à zéro des imports n'a pas été exécutée.

**19 novembre — correctif publication PA livré, build 87 disponible.**
[PR 549](https://github.com/jMoulis/fl-copilot/pull/549) fusionnée, source
`518502738a739356c79856e3a77f7539a3a6a28f`, CI push/PR/master vertes :
6 412 tests passés, 6 ignorés. Archive compilée localement, vérifiée, envoi
accepté par Apple ; `VALID` / `IN_BETA_TESTING`, non expiré, groupe privé
habituel et propriétaire seul. Aucun build cloud ni changement d’API.

Progression de création unique ; les références associées au même produit/date
sont revues avant publication, les autres PA peuvent être publiés et le document
complété sans doublon. Erreurs auprès du bouton concerné. Recette réelle sur
copie isolée : 1 226 lignes publiées en test automatisé ; simulateur, 709 créations,
publication de 1 102 prix puis correction/finalisation/reprise à 1 104, conservés
à la réouverture. Aucun doublon SQLite, confirmation terminée.
**Recette iPhone du propriétaire encore attendue.** Voir
[la livraison 87](../qa/BUILD_87_DELIVERY_2026_11_19.md).
Les lots clos, fonctionnalités retirées et reports explicites restent inchangés.

**19 novembre — retour PA sur build 86 : publication à corriger.**
Progression répétée et refus malgré « 1 226 prêtes ». Reproduction isolée :
plusieurs références affectées au même produit/date passent le rapprochement,
mais violent le contrôle de publication. Correctif : revue explicite de ces
associations, publication des autres lignes, reprise sans doublon, progression
unique et erreur auprès du bouton. Tests et limites de recette dans
[la fiche PA](../qa/PA_PUBLICATION_COLLISIONS_2026_11_19.md).
Le lot PA n’est pas accepté sur iPhone ; les lots clos et reports restent inchangés.

**19 novembre — lots PA et Journal livrés pour recette iPhone, build 86.**
PR [546](https://github.com/jMoulis/fl-copilot/pull/546) et
[547](https://github.com/jMoulis/fl-copilot/pull/547) fusionnées ; source livrée
`3b41f8933c47cc31259a377b6649639d9ab3bb9c`. CI push/PR puis master vertes ;
6 409 tests réussis, 6 ignorés. Archive 0.1.0 (86) compilée sur le Mac, vérifiée
et envoi accepté par Apple. Le traitement Apple et l’accès TestFlight sont
contrôlés séparément de l’envoi dans les preuves privées de livraison.

Confirmations PA : rapprochement par ITM8/EAN, création groupée explicite des
codes inconnus, mise à jour des lignes concernées après chaque décision et une
actualisation globale à « Terminer les confirmations ». Application aux imports
conservés ; nettoyage manuel réversible du catalogue. Journal : conservation de
la météo renseignée et de ses dates de source, prévision archivée explicitement
qualifiée, skeleton des tâches et icône Aujourd’hui permanente avant Actualiser.
Le serveur météo est déployé et sa santé publique vérifiée, base connectée.
Voir [la livraison](../qa/BUILD_86_DELIVERY_2026_11_19.md).

Le propriétaire réaffirme son autorisation des PR et fusions. Il choisit de tester
ce lot sur son iPhone sans attendre le simulateur ; **recette visuelle encore
attendue**, aucune validation native revendiquée. La rapidité et les réouvertures
du build 85 sont acceptées. Les lots précédemment clos, fonctionnalités retirées
et reports explicites restent inchangés. Aucun build EAS cloud payant.

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
