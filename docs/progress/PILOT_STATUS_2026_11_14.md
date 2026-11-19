# État courant — pilote iPhone, actualisé le 18 novembre 2026

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

## Version utilisée

- Nouveau build **0.1.0 (79)** : PR 539, source
  `6f67d2a701d77923b07ec71aa4f64fd5970b7c1a`, compilé localement et vérifié,
  envoi accepté par Apple. TestFlight privé `VALID` / `IN_BETA_TESTING` ; recette propriétaire
  en attente. Lot PA quotidiens, incluant les évolutions du build 78.
- API courante : même source PR 539, déploiement
  `dpl_4WGdCzjpJc47sCrb1QE3q2eUUwYn`, région `cdg1`, alias
  `https://fl-copilot.vercel.app`. Santé/base connectée et refus privé 401 vérifiés.
  Déploiement antérieur conservé : `dpl_2RknNqVV9fa3ajnMemx14sfrjaBS`.

Les versions suivantes décrivent les livraisons antérieures :

- Nouveau build **0.1.0 (78)** : PR 538 fusionnée, CI push/PR/master vertes,
  archive compilée localement et vérifiée, envoi accepté par Apple. Source
  `a6fc7c3aec3f626db4546ca8a74f795bd334f23e`. Lot Analyses/graphiques et navigation ;
  recette propriétaire encore en attente. Build 77 reste la référence acceptée.

- iOS **0.1.0 (77)**, compilé localement sur le Mac, distribué dans le groupe
  TestFlight privé habituel. Source native
  `aa94fcfbdd6d26a729807936612d2aa7fa8b0ad8`. La navigation « Repères du jour »
  est acceptée : « Super ça fonctionne parfaitement ». Les actualités nationales sont
  acceptées (« tout fonctionne »). Le lot INSEE et sa restitution
  corrigée côté serveur sont acceptés par le propriétaire le 17 novembre.
  Le build 76 reste la précédente version acceptée ; les finitions Réglages,
  Mon magasin et Synchronisation du build 74 restent clôturées.
- API en service : `adb7efb80278a3ebf0e6b36b56444f6ab574ff26` (PR 536),
  déploiement `dpl_2RknNqVV9fa3ajnMemx14sfrjaBS`, région `cdg1`,
  `https://fl-copilot.vercel.app`. État public et base connectée vérifiés ;
  accès privé non authentifié refusé. Le correctif INSEE PR 534 reste acquis.
  Le build 76 ajoute la rubrique native d’actualités, testée par le propriétaire.
  Les erreurs internes des deux lectures Apple antérieures restent consignées
  comme telles, sans remettre en cause ce retour d’usage.
- Pas de nouvelle recette générale M0–M8 demandée sans régression identifiée.

## Socle validé

| Périmètre               | Statut courant                                                        | Réserve conservée                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| M0–M6                   | Clôturés pour le pilote iPhone                                        | La qualification multiplateforme reste distincte.                                                                                 |
| M7, chantiers 1/3/4/5/7 | Clôturés pour leur périmètre fonctionnel pilote                       | Les nouvelles évolutions ne rouvrent pas les recettes acceptées.                                                                  |
| M7, chantier 2          | Conseil qualitatif accepté ; approfondissement numérique reporté      | PA quotidiens livrés (recette build 79 en attente) ; simulations futures reportées. Les calculateurs existants restent conservés. |
| M7, chantier 6          | Contexte magasin déclaré disponible ; implantation détaillée reportée | Plan merchandising du groupement, mesures et faisabilité physique.                                                                |
| M8                      | Pilote iPhone clôturé                                                 | Sauvegarde serveur Atlas et restauration isolée explicitement reportées.                                                          |
| M9                      | Non démarré, reporté                                                  | Android et qualification dédiée d'accessibilité.                                                                                  |

Les copies/restaurations locales et les conflits iPhone/simulateur ne valent pas
validation d'une restauration cloud Atlas. Cette réserve reste visible.

## Évolutions livrées après le pilote

- Navigation **Journal · Analyses · Copilote · Imports**, accès Produits/Réglages
  dans l'en-tête, retour d'une fiche produit vers son origine. Les finitions de
  style se poursuivent à l'usage ; la fidélité intégrale aux maquettes n'est pas
  déclarée acquise.
- Défilement du chat, skeleton Analyses, couverture derrière les informations et
  courbes compactes des produits : code livré, retours d'usage positifs. Ne pas
  inventer une recette détaillée pour chaque geste non rapporté.
- Génération d'images produits depuis la fiche, vrac/conditionné et transparence :
  parcours livré ; le propriétaire rapporte plusieurs générations réussies après
  le correctif. Le détourage des photos existantes est écarté par le propriétaire
  le 16 novembre 2026 et ne figure plus au backlog actif.
  L'ancien pilote administratif de trois fichiers externes n'est pas présenté
  comme exécuté ; toute reprise exige ses vrais fichiers, droits et provenance.
- Copilote : routage léger, titres/renommage, résultats d'outils compacts et accès
  direct au contexte courant. Le dernier bilan réel utilise trois étapes expertes,
  62 235 tokens d'entrée dont 43 514 en cache (déjà inclus), et 1 459 en sortie.
  Le précédent bilan était dans une discussion continuée : le gain observé n'est
  pas une mesure isolant l'effet du code ni une garantie de coût par demande.
- **Mémoire automatique validée sur le build 60** : nouvelle préférence retenue
  sans confirmation individuelle puis retrouvée dans une nouvelle discussion.
  Modification, oubli et désactivation restent accessibles.
- **Journal fonctionnel validé** : météo, calendriers, contexte économique,
  annonces locales et transports sélectionnés/filtrés, notes et signalements,
  archivage et lecture par le copilote. Les archives se constituent ; leur
  absence ne signifie ni absence d'événement ni indisponibilité des ventes.
- **Moteur descriptif v1 validé dans son fonctionnement** : l'utilisateur fournit
  une réponse fondée sur 2 paires exploitables sur 42 jours et une semaine. Le
  refus de conclure et les exclusions sont acceptés. L'utilité sur un échantillon
  suffisant reste à mesurer ; aucune causalité, prévision ou stabilité empirique
  n'est déclarée validée par ce test.

## Pilotage quotidien et indices INSEE clôturés

Les tâches commerciales, pense-bêtes privés et leur rappel facultatif sont
validés par le propriétaire. Ils ne constituent plus un lot en attente.

Les indices mensuels fruits/fruits à coque et légumes/tubercules/bananes à cuire/
légumineuses sont collectés et archivés par les services existants. Leurs
périmètres officiels restent plus larges que le rayon frais. Le propriétaire
confirme « Oui c'est fixé » après le correctif de restitution PR 534 : ce lot
est clôturé. Voir [la fiche du lot](../qa/JOURNAL_PRODUCE_PRICES_2026_11_16.md).

## Lot Analyses livré — recette iPhone en attente

Le propriétaire valide la maquette des graphiques et ses ajustements de catégories,
répartition circulaire et navigation. Voir [le lot Analyses](../qa/ANALYTICS_POLISH_2026_11_18.md).
L’upload quotidien des PA est désormais livré en PR 539/build 79, sans lever
le report des simulations chiffrées.

## Derniers lots acceptés

Le propriétaire a approuvé le premier périmètre des actualités nationales le
17 novembre : mouvements sociaux et restrictions utiles aux déplacements ou à
l’approvisionnement. Le premier incrément est implémenté et vérifié localement,
avec collecte/archives existantes, compatibilité build 75 et affichage natif.
PR 536 fusionnée avec CI push/PR/master vertes ; API publiée et saine. Le build
76 est compilé localement, vérifié, envoyé à Apple et accepté par le propriétaire.
La réorganisation approuvée regroupe les rubriques sur une page
« Repères du jour » ; météo compacte et analyse restent dans le Journal.
PR 537 fusionnée, CI push/PR/master vertes. Build local 77 vérifié et envoyé
à Apple, confirmé `VALID` / `IN_BETA_TESTING` dans TestFlight. Le propriétaire
confirme « Super ça fonctionne parfaitement » : lot UX clôturé, sans nouvelle
recette à demander hors régression.
Voir [le lot UX](../qa/JOURNAL_CONTEXT_PAGE_2026_11_18.md). Voir la
[fiche du lot](../qa/JOURNAL_NATIONAL_NEWS_2026_11_17.md) pour les preuves et limites
(dates incertaines, couverture partielle, déduplication par URL).
Le [backlog actif](PRODUCT_BACKLOG_2026_11_06.md) conserve les reports explicites.

## Sources du point

- [Clôture M0–M6](M0_M6_PILOT_CLOSURE_2026_11_02.md).
- [Périmètre des sept chantiers M7](M7_WORKSTREAM_STATUS.md).
- [Clôture pilote M8 et réserve Atlas](M8_HARDENING_STATUS.md).
- [Mémoire automatique](../qa/COPILOT_AUTOMATIC_MEMORY_2026_11_14.md).
- [Accès direct au contexte et mesure réelle](../qa/COPILOT_CONTEXT_DISCOVERY_2026_11_14.md).
- [Moteur descriptif et acceptation fonctionnelle](../qa/JOURNAL_DESCRIPTIVE_ASSOCIATIONS_2026_11_14.md).

Ce point est documentaire : il ne modifie ni les données, ni la collecte, ni les
instructions IA, et ne déclenche aucun build ou déploiement.
