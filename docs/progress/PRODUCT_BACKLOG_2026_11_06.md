# Backlog produit — demandes du 6 novembre 2026

Liste consignée à la demande du propriétaire. Ces points restent à faire ou à cadrer : leur inscription ne vaut ni implémentation ni validation. Leur priorité et leur rattachement à la V1 ou à une livraison ultérieure restent à arbitrer, sauf la génération d’images de TG explicitement réservée à la V2. Les clôtures fonctionnelles M0–M7 et les réserves M8 existantes restent celles de leurs suivis respectifs.

## Reprise après clôture du pilote M8 — 11 novembre

Le propriétaire valide le conflit iPhone/simulateur et l’installation/connexion TestFlight 47. Le pilote M8 est accepté avec la réserve explicite de sauvegarde/restauration Atlas reportée ; ces finitions ne rouvrent pas ses parcours validés. Android et la qualification d’accessibilité dédiée restent M9.

Ordre retenu : (1) défilement du chat, skeleton Analyses et couverture dans le détail ; (2) maquettes/navigation Actions et séparation préparation/gestion des données ; (3) graphiques de liste et images produits après précision de l’usage ; (4) journal de bord à définir ensemble. Les images de TG restent V2.

Le premier lot réutilise FlatList, le panneau natif et les lectures locales : seul un geste de lecture modifie le suivi du chat ; les corrections de mise en page conservent l’intention ; les comptes de journées des catégories/produits passent derrière « i » avec accès à la fiche ; le compte global reste dans « Couverture et comparaison ». Le skeleton remplace seulement l’attente sans données, jamais des chiffres locaux déjà affichés ni une erreur. Aucun calcul, contrat, source, instruction IA, modèle ou appel fournisseur n’est modifié. **Livré dans le build TestFlight 48 après les contrôles exacts ; recette iPhone détaillée non présumée.**

Vérification locale initiale : 28 tests de défilement, vues montées chat/analyses, contexte et graphique passent dans six suites, sans ignorés. Les contrôles complets, la fusion, la livraison groupée et la recette native restent distincts.

## Lot navigation approuvé — 12 novembre

Maquettes approuvées puis demande de réaliser le tout en un lot : Journal · Analyses · Copilote · Imports, raccourcis Produits/Réglages fixes, Ma semaine et observations dans Journal, réception des documents dans Imports, configuration et compte dans Réglages. La navigation produit revient à son origine et conserve la sélection analytique ou le catalogue. Les anciens accès restent compatibles.

Les PR 494/495 sont fusionnées et livrées dans le build TestFlight 48 avec le lot défilement/skeleton/couverture. Les retouches des icônes de la barre du haut et de l’espacement d’Imports (PR 496) sont fusionnées et attendent la prochaine livraison native. La recette iPhone détaillée reste distincte de la livraison. Aucun nouveau journal automatique, appel IA, schéma ou workflow d’import n’est ajouté. Le graphique de liste, la génération/détourage d’images et le journal contextualisé restent les prochains sujets à cadrer.

## Chat

- [ ] **Défilement automatique inconsistant** : reproduire les situations signalées et stabiliser le suivi de la réponse. Préserver la lecture des anciens messages lorsque l’utilisateur remonte volontairement.
- [x] **Titre automatique et renommage manuel** : livrés et validés pendant M8. Priorité du titre manuel, persistance hors connexion et synchronisation conservées. Voir [la qualification](../qa/M8_COPILOT_ECONOMY_TITLES_2026_11_06.md).

## UX et analyses

- [ ] **Revue UX à partir des maquettes** : reprendre les maquettes existantes avec les arbitrages métier du projet, sans reproduire leurs omissions.
- [ ] **Liste des produits avec un graphique** : maquette du ZIP retenue le 12 novembre. Courbes compactes sur la liste Analyses, tri allégé et photos sans fond d’interface en validation ; voir [la qualification](../qa/ANALYTICS_PRODUCT_SPARKLINES_2026_11_12.md). Livraison et recette iPhone restent distinctes.
- [ ] **Chargement skeleton de la page Analyses** : représenter le chargement sans masquer inutilement des chiffres locaux déjà disponibles.
- [ ] **Redéfinir le design du menu Actions** : simplifier sa lecture et l’accès aux fonctions utiles.
- [ ] **Séparer les imports et la synchronisation de Ma semaine** : clarifier la navigation entre préparation commerciale et gestion des données, en réutilisant les parcours existants.
- [ ] **Libellés de couverture des analyses** : revoir les mentions répétées de jours complets/partiels/manquants. Proposition propriétaire : détail derrière « i », dans un panneau déroulant. Aucun changement des calculs n’est décidé à ce stade.

## Images produits

- [ ] **Générer une image par IA depuis la fiche produit**, en réutilisant le service de fichiers visuels, les droits et le processus d’approbation existants. Définir l’aperçu, la validation et le remplacement de l’image.
      La correction des aperçus PNG transparents et la suppression du libellé récurrent « Générique » sont déjà livrées et acceptées ; ne pas les recréer. Voir [les aperçus transparents](../qa/M7_TRANSPARENT_PRODUCT_PREVIEWS_2026_11_04.md).

- [ ] **Supprimer un fond réellement présent dans une image** : cadrer l’action de détourage et la conservation de la transparence. Distinguer un fond réellement présent dans le fichier d’un fond blanc ajouté par l’affichage ; préserver l’original.

## Coût et fonctionnement de l’IA

La génération depuis la fiche produit est maintenant implémentée sur la branche de travail, après validation de la maquette, du vrac/conditionné et de la réutilisation du compte OpenAI. Elle réutilise la bibliothèque et sa synchronisation ; la provenance IA et la confirmation restent distinctes de la génération. Les tests locaux ne valent ni activation fournisseur, ni livraison, ni recette iPhone. [Périmètre, coût et recette](../qa/PRODUCT_IMAGE_GENERATION_2026_11_12.md). Le détourage de photos existantes reste à faire séparément.

**Priorité précisée par le propriétaire le 6 novembre : consommation de tokens.** Commencer par mesurer les entrées/sorties/cache par étape, le contexte répété et les appels d’outils. La revue des réveils réseau/batterie passe après ce sujet. Le choix de modèles selon la complexité doit être évalué sur ces mesures, Le propriétaire autorise ensuite un routage léger et les titres automatiques ; l’implémentation et ses limites sont suivies dans la qualification M8.

- [ ] **Optimiser le coût selon la complexité de la tâche** : étudier l’orientation des tâches simples et complexes vers des modèles adaptés. S’appuyer sur les consommations réelles et vérifier qualité et latence ; ne pas ajouter un appel de classification systématique qui annulerait le gain. Premier incrément autorisé : un seul appel léger borné oriente la demande, répond au cas simple et propose le titre. Le routage léger, les titres et les optimisations des résultats d’outils sont livrés ; les scénarios de généralisation ont été testés avec le propriétaire. Conserver les mesures réelles et surveiller la qualité, sans présenter l’optimisation continue comme une absence d’implémentation. Les demandes analytiques conservent le parcours expert. Voir [la qualification](../qa/M8_COPILOT_ECONOMY_TITLES_2026_11_06.md).

## Priorité de cadrage — journal de bord quotidien, à définir ensemble

**Objectif demandé :** donner au copilote le contexte extérieur utile pour interpréter les chiffres du magasin et examiner des causes possibles des variations observées.

Informations demandées :

- Météo.
- Vacances.
- Actualités susceptibles d’affecter le magasin : manifestations, grèves, perturbations de métro ou de transport, etc.
- Statistiques sur le moral des Français.
- Statistiques sur les dépenses en fruits et légumes.
- Inflation.

### Points à décider ensemble avant de développer

1. **Périmètre géographique** : contexte du magasin et de sa zone de chalandise pour la météo et les événements ; pertinence des signaux régionaux et nationaux.
2. **Sources et collecte** : sources à retenir, accès disponibles, automatisation ou saisie manuelle, fréquence d’actualisation et coût acceptable. Aucun fournisseur ni abonnement n’est choisi par cette note.
3. **Temporalité** : distinguer date de publication, période couverte et date de l’événement. Un journal quotidien peut conserver le dernier indicateur mensuel connu, en affichant sa période et son ancienneté ; il ne doit pas inventer une statistique quotidienne.
4. **Restitution** : emplacement dans l’app, synthèse quotidienne utile et accès au détail ; définir ce que l’utilisateur peut compléter ou corriger.
5. **Usage par le copilote** : retrouver le contexte correspondant aux périodes de vente comparées, citer les sources et leur portée, puis formuler des hypothèses proportionnées aux données.
6. **Critères de validation** : tester ensemble des journées réelles et vérifier que ce contexte améliore l’analyse sans ajouter de bruit, d’appels IA inutiles ni de conclusions non démontrées.

**Limite métier à conserver :** météo, vacances, moral ou inflation peuvent aider à expliquer une variation ; leur concomitance avec une hausse ou une baisse ne démontre pas un lien de cause à effet. Distinguer faits observés, hypothèses et effets effectivement mesurés. Une statistique nationale ne décrit pas automatiquement la clientèle du magasin. Une information absente reste inconnue.

Le journal est **à cadrer avec le propriétaire**. Aucun schéma de base, workflow de collecte, source payante ou nouvelle instruction détaillée du copilote n’est décidé ici.

## Audit de cadrage du journal — 12 novembre 2026

État de travail à arbitrer avec le propriétaire, après sa demande d'un journal réellement utile à l'analyse. Audit du code, agrégations MongoDB en lecture seule sur le magasin pilote et consultation des sources primaires. Aucun import distant, nouveau schéma, abonnement, appel IA applicatif ou changement du calcul des chiffres n'est réalisé ici. Le magasin enregistré est Asnières-sur-Seine, 92600, zone scolaire C, avec un point fixe déjà configuré ; aucune nouvelle géolocalisation n'est nécessaire.

### Données internes effectivement présentes

La lecture des observations de vente non supprimées trouve **18 324 lignes, toutes VALIDATED, sur 118 dates distinctes**, réparties sur six mois discontinus :

- Novembre 2024 : 20 dates, du 1er au 20, 3 118 lignes.
- Octobre 2025 : 31 dates, du 1er au 31, 5 010 lignes.
- Novembre 2025 : 20 dates, du 1er au 20, 3 223 lignes.
- Septembre 2026 : 5 dates entre le 21 et le 29, 740 lignes.
- Octobre 2026 : 31 dates, du 1er au 31, 4 648 lignes.
- Novembre 2026 : 11 dates, du 1er au 11, 1 585 lignes.

Ces comptes prouvent seulement la présence d'au moins une observation validée à une date. Ils ne certifient ni l'intégralité des rapports, ni la disponibilité de chaque produit, ni 118 journées statistiquement indépendantes. Le moteur canonique et ses contrôles de couverture restent responsables des comparaisons ; cet audit ne recalcule pas le CA. Une absence de ligne produit ne devient pas automatiquement une vente nulle. Les quantités Mercalys restent soumises aux qualifications déjà retenues, notamment pour les références vendues à la pièce mais gérées en poids.

Le suivi terrain contient trois événements clos : un stock faible et deux ruptures, du 10 au 17 octobre 2026. Le suivi commercial contient sept tâches, dont six déclarées faites ; aucune ne renseigne `actuals.start`. L'unique déclaration privée de réalisation n'a pas non plus de `snapshot.actuals.start`. Une date de confirmation ne prouve pas une date d'exposition. Ces volumes sont insuffisants pour considérer les autres dates comme exemptes de rupture, d'animation ou de problème qualité.

Le cache public partagé contient une réponse MET Norway, une réponse jours fériés et deux réponses calendrier scolaire ; les dernières récupérations observées datent du 17 octobre. Il s'agit du cache existant, pas d'un historique de météo observée ou d'une garantie de fraîcheur pour chaque période. Les lecteurs métier excluent déjà les prévisions des preuves météo rétrospectives. Les observations produit, réglages du magasin, plans, déclarations et bibliothèques de contexte existants sont à réutiliser avant de proposer un nouveau contrat.

### Sources vérifiées et qualification restant à faire

- **Météo observée** : les [données climatologiques quotidiennes Météo-France](https://www.data.gouv.fr/datasets/donnees-climatologiques-de-base-quotidiennes) sont distribuées en fichiers départementaux sous licence ouverte. Lecture effective des fichiers 2025–2026 des départements 92 et 75. Dans le fichier 92, Suresnes (`92073001`) possède 679 dates du 1er janvier 2025 au 10 novembre 2026, avec TN, TX et RR non vides, dont les 31 dates d'octobre 2025 et celles d'octobre 2026. C'est une candidate, pas une station déjà sélectionnée pour le magasin. Distance au point fixe, représentativité, codes qualité et fenêtres de mesure restent à qualifier. Le dernier jour observé au téléchargement est le 10 novembre : on ne remplit pas le 11 par une prévision. [Fichier lu](https://meteofrance.s3.sbg.io.cloud.ovh.net/data/synchro_ftp/BASE/QUOT/Q_92_latest-2025-2026_RR-T-Vent.csv.gz).
- **Confiance des ménages** : la [source CAMME de l'INSEE](https://www.insee.fr/fr/metadonnees/source/serie/s1208) est mensuelle. Lecture effective, sans clé, de 34 observations entre janvier 2024 et octobre 2026 via le [service SDMX documenté](https://www.insee.fr/fr/information/2862759), série `001587668`. Ce sont des indicateurs nationaux, pas le moral mesuré des clients du magasin. La profondeur externe ne compense pas les six mois internes discontinus ; répéter un indice mensuel sur trente journées ne crée pas trente observations indépendantes. Archives de publication et révisions sont à qualifier avant une évaluation « telle qu'on aurait pu la faire à l'époque ».
- **Inflation** : utiliser les séries officielles pertinentes (ensemble, alimentation, familles de fruits/légumes) et distinguer indice, variation mensuelle et glissement annuel. Le [passage en base 2025 et la refonte de nomenclature depuis janvier 2026](https://www.insee.fr/fr/statistiques/8740310) imposent de vérifier les concordances. La famille étroite « légumes à fruits » n'est pas l'ensemble des légumes. Le transport SDMX est testé avec la confiance ; les identifiants et la continuité des séries de prix ne sont pas encore qualifiés. Aucun déflatage automatique du CA magasin par l'IPC n'est décidé.
- **Achats et dépenses fruits/légumes** : les [notes mensuelles FranceAgriMer](https://www.franceagrimer.fr/chiffre-et-analyses-economiques/note-de-conjoncture-mensuelle-fruits-legumes-et-pommes-de-terre) apportent du contexte sur les volumes achetés, les prix et le marché, avec des éditions historiques. Page consultée, accès aux microdonnées du panel non démontré et aucun abonnement autorisé. Conserver séparément mois étudié, date de publication, population et périmètre. L'édition publiée en novembre peut couvrir plusieurs périodes différentes ; ne pas attribuer automatiquement tous ses chiffres au mois du titre. Une référence nationale n'est pas un groupe témoin de ce magasin.
- **Événements locaux** : la [page travaux de la ville d'Asnières](https://asnieres-sur-seine.fr/vivre-a-asnieres/travaux) publie des lieux et périodes de restrictions. Elle constitue une candidate pour des faits locaux ; sa simple consultation ne reconstruit pas toutes les versions historiques de la page et ne prouve aucun effet sur le magasin. Le périmètre de chalandise, l'archivage des informations et la confirmation terrain sont à définir.
- **Transports** : l'[API PRIM des perturbations IDFM](https://prim.iledefrance-mobilites.fr/fr/jeux-de-donnees/idfm-disruptions_bulk) documente des lignes et arrêts affectés, des conditions/licence, un compte et des quotas. Documentation consultée seulement : aucun accès authentifié ou historique des perturbations n'est testé. Les lignes réellement pertinentes au magasin sont à définir. Ce flux ne doit pas bloquer le premier incrément.
- **Politique et actualité** : enregistrer des faits identifiables, leur source, leur annonce/entrée en vigueur et leur mécanisme d'exposition possible (accès, revenu disponible, approvisionnement). Ne pas créer un score arbitraire d'humeur politique ni transformer une présence médiatique en cause locale. Le ciblage des sources et les critères de pertinence restent à arbitrer.

### Arbitrage recommandé après audit

1. Commencer par un dossier analytique historique sur octobre 2025 et octobre 2026, avec météo réellement observée et calendriers. Réutiliser l'alignement canonique ISO/jour de semaine : comparer des journées équivalentes, pas mécaniquement deux mêmes dates civiles. Séparer les jours correctement comparables des jours non couverts.
2. Présenter dès ce premier dossier le contexte économique publié et disponible, avec la période propre à chaque indicateur. Il est utile au diagnostic ; l'historique du magasin ne justifie pas encore d'estimer une sensibilité locale à l'inflation ou à la confiance.
3. Simplifier la capture terrain et les dates réelles de mise en place en réutilisant les événements et déclarations existants. Prévoir le besoin distinct d'un événement à l'échelle du magasin (travaux, horaires, accès), sans le forcer dans une rupture produit.
4. Qualifier les sources locales et les transports selon la zone utile, puis commencer à conserver les événements pour l'avenir. Un événement passé non reconstituable reste inconnu.
5. Définir ensemble l'écran Journal à partir de ces deux usages : noter simplement le terrain et lire les facteurs pertinents d'une période. Pas de moteur causal ou de nouvel agent spécialisé avant d'avoir démontré le besoin.

### Critères de solidité et recette proposés

Chaque fait conserve source, géographie, unité, période d'effet ou de mesure, publication, récupération, éventuelle révision et statut observé/prévu/annoncé. Une prévision archivée garde son statut ; le passé ne reçoit pas une information publiée plus tard lors d'un test d'anticipation. L'absence de contexte ne bloque jamais l'accès aux chiffres ni leur comparaison disponible.

Les lectures doivent comparer les mêmes jours de semaine et considérer saison, fêtes mobiles, prix/promos, disponibilité et qualité. Une station météo ne représente pas exactement le magasin. Les analyses mensuelles tiennent compte du faible nombre de mois, les journées répétées dans un même épisode ne valent pas des expériences indépendantes et les séries de produits ne sont pas additionnées en unités incompatibles.

La première recette sera menée sur quelques questions et périodes réelles, avec puis sans contexte : quel fait supplémentaire améliore l'analyse, quelle hypothèse est contredite, quelles données manquent, quelles décisions deviennent plus utiles ? Pas de pourcentage d'impact attribué à la météo, au moral ou à la politique sans méthode qualifiée. Les méthodes et contre-exemples doivent rester inspectables ; une prévision éventuelle sera évaluée sur une période gardée à part et avec les informations alors disponibles, face à une référence simple.

Les collectes structurées et partagées n'exigent pas un appel LLM à chaque ouverture ou chaque question. Fréquence adaptée aux sources (quotidienne, mensuelle, sur événement), cache, conservation des révisions et extraits ciblés pour le copilote limiteront le coût. Ces principes ne valent pas choix final d'un fournisseur, d'un abonnement ou d'un nouveau modèle de données.

### Premier corpus rétrospectif préparé — 12 novembre

Le propriétaire autorise la récupération rétrospective, la préparation séparée avant intégration, puis les tests des analyses et le journal quotidien. Le corpus local `maintenance/journal-pilot/captures/20261112T181016375309Z` conserve 13 sources téléchargées, leurs en-têtes, dates de récupération, tailles et SHA-256, les normalisations et un rapport de qualification. Aucun modèle de base ni aucune donnée applicative n'est créé ou modifié.

Contenu : 1 358 relevés de station/jour pour Lariboisière et Suresnes, 67 valeurs mensuelles INSEE (confiance et IPC alimentation base 2025), jours fériés 2025/2026, calendrier Zone C sur les fenêtres pertinentes, originaux FranceAgriMer d'octobre 2025/2026 et première capture actuelle de la page travaux d'Asnières. Les stations restent candidates ; leurs distances à vol d'oiseau au point enregistré sont environ 7,4 et 7,6 km. La répétition quotidienne de cette capture locale n'est pas encore activée.

Les 31 couples de dates sont générés par `previousIsoYearDate` du moteur existant, puis contrôlés indépendamment : octobre 2026 s'aligne du 2 octobre au 1er novembre 2025. Les deux stations couvrent ces 62 dates, soit 124 station/jours et 372 mesures TN/TX/RR de qualité validée. Des observations de vente validées existent des deux côtés des 31 couples, sans affirmation de rapports complets. Le couple 31/10/2026–01/11/2025 porte une différence de jour férié. La pluie est une mesure 6 h UTC–6 h UTC le lendemain, pas une pluie mesurée pendant l'ouverture.

Les contrôles conservent zéro/pluie absente, les codes qualité 0/1/2/9, la date locale du calendrier et la borne exclusive de retour des vacances. Les dernières valeurs économiques révisées ne sont pas qualifiées comme disponibles historiquement à chaque date : l'évaluation d'une anticipation reste bloquée tant que les dates de publication/vintages ne sont pas établies. L'IPC alimentation d'octobre 2026 n'est pas présent dans la source capturée ; aucune valeur n'est remplie par supposition.

Le corpus est qualifié pour préparer une revue rétrospective, pas encore pour valider les moteurs d'analyse, mesurer une causalité, ni fournir le contexte dans le copilote. Le rapprochement avec les KPI canoniques, l'extraction contrôlée des tableaux sectoriels, les indices F&L détaillés, les événements historiques et les contrats/écrans quotidiens restent les étapes suivantes. Aucun appel IA applicatif, nouvel abonnement, build ou déploiement n'est déclenché par ce lot.

### Première étude descriptive météo / résultats — 12 novembre

Le rapprochement annoncé ci-dessus est maintenant effectué : 63 instantanés départementaux ont été lus sans écriture, puis `compareYearOverYear` du moteur existant a produit 62 comparaisons CA net TTC/marge importée sur les 31 couples de dates. Les montants restent ceux du moteur canonique ; la filiation des instantanés est conservée, sans export intégral des lignées d'entrée.

Le plan exploratoire fixé avant le calcul compare les écarts de température maximale et de pluie aux évolutions annuelles du CA et de la marge, par corrélation de rang de Spearman. L'échantillon principal contient 30 couples à calendrier apparié ; le couple présentant une différence de jour férié reste visible dans une variante à 31 couples. Une autre variante retire les journées touchées par les trois incidents déclarés, du 10 au 20 octobre inclus, et conserve 19 couples. Cette exclusion ne prouve ni que les incidents expliquent l'évolution du rayon, ni que les autres journées sont exemptes d'incident. Les deux stations sont des vérifications de sensibilité, pas deux échantillons indépendants.

Le lien température / évolution du CA est faible dans cet échantillon : coefficient d'environ +0,14 à Lariboisière et +0,11 à Suresnes, puis environ −0,14 aux deux stations après exclusion des journées avec incident déclaré. Le retrait d'une semaine change également les coefficients, parfois leur signe. Cela montre une association fragile ; cela ne démontre ni un effet causal de la météo, ni son absence. Les prix, promotions, expositions réelles, trafic, ruptures non déclarées, tendance entre années et dépendance temporelle restent non contrôlés. L'analyse départementale peut masquer des comportements différents par famille.

Le dossier conserve les 24 coefficients des trois variantes, leurs journées, les sensibilités au retrait d'une journée ou d'une semaine et les empreintes des sources. Aucun seuil de significativité, intervalle de confiance, effet prédit ou pourcentage attribuable à la météo n'est produit. Les indices mensuels restent du contexte : aucune corrélation quotidienne artificielle avec la confiance ou l'inflation. Les cinq tests statistiques ciblés passent, dont égalités de rang, décimales exactes et valeurs constantes ; la vue interactive passe le contrôle TypeScript. Ces vérifications ne constituent pas une validation causale, prédictive ou une recette native.

La vue de recherche permet de choisir station, indicateur et échantillon, puis d'inspecter les journées. Aucun appel IA applicatif, changement de données métier, nouveau modèle de base, collecte récurrente, build ou déploiement n'a été effectué. La suite est la définition d'une capture quotidienne simple, la qualification des événements et des dates réelles de terrain, puis l'évaluation de leur utilité pour le copilote ; aucune régression complexe n'est justifiée par cette première étude seule.

### Journal quotidien — intégration du premier lot

Après validation de la direction visuelle météo le 12 novembre, le premier incrément natif est codé : carte météo, sélection jour/semaine, sources dans un volet, calendrier, observations produit du jour et préparation d’un brouillon d’analyse. Il réutilise les stockages et parcours existants. La capture des notes générales du magasin et les sources économiques/locales restent ouvertes et ne sont pas remplacées par des incidents produit. La livraison API, le binaire et la recette iPhone doivent être identifiés séparément ; le code seul ne vaut pas disponibilité dans le build installé. Recette : `docs/qa/JOURNAL_DAILY_FIRST_INCREMENT.md`.

## V2 explicitement demandée

- [ ] **Génération d’images de TG** : illustrer une proposition de tête de gondole. Le périmètre sera défini après le cadrage du contexte d’implantation ; une illustration ne prouve pas la faisabilité physique ni une installation réalisée.
