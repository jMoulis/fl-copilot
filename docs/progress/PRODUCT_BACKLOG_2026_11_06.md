# Backlog produit — demandes du 6 novembre 2026

Liste consignée à la demande du propriétaire. Ces points restent à faire ou à cadrer : leur inscription ne vaut ni implémentation ni validation. Leur priorité et leur rattachement à la V1 ou à une livraison ultérieure restent à arbitrer, sauf la génération d’images de TG explicitement réservée à la V2. Les clôtures fonctionnelles M0–M7 et les réserves M8 existantes restent celles de leurs suivis respectifs.

## Reprise après clôture du pilote M8 — 11 novembre

Le propriétaire valide le conflit iPhone/simulateur et l’installation/connexion TestFlight 47. Le pilote M8 est accepté avec la réserve explicite de sauvegarde/restauration Atlas reportée ; ces finitions ne rouvrent pas ses parcours validés. Android et la qualification d’accessibilité dédiée restent M9.

Ordre retenu : (1) défilement du chat, skeleton Analyses et couverture dans le détail ; (2) maquettes/navigation Actions et séparation préparation/gestion des données ; (3) graphiques de liste et images produits après précision de l’usage ; (4) journal de bord à définir ensemble. Les images de TG restent V2.

Le premier lot réutilise FlatList, le panneau natif et les lectures locales : seul un geste de lecture modifie le suivi du chat ; les corrections de mise en page conservent l’intention ; les comptes de journées des catégories/produits passent derrière « i » avec accès à la fiche ; le compte global reste dans « Couverture et comparaison ». Le skeleton remplace seulement l’attente sans données, jamais des chiffres locaux déjà affichés ni une erreur. Aucun calcul, contrat, source, instruction IA, modèle ou appel fournisseur n’est modifié. **Code en validation, pas encore livré dans TestFlight 47 ni accepté sur iPhone.**

Vérification locale initiale : 28 tests de défilement, vues montées chat/analyses, contexte et graphique passent dans six suites, sans ignorés. Les contrôles complets, la fusion, la livraison groupée et la recette native restent distincts.

## Chat

- [ ] **Défilement automatique inconsistant** : reproduire les situations signalées et stabiliser le suivi de la réponse. Préserver la lecture des anciens messages lorsque l’utilisateur remonte volontairement.
- [x] **Titre automatique et renommage manuel** : livrés et validés pendant M8. Priorité du titre manuel, persistance hors connexion et synchronisation conservées. Voir [la qualification](../qa/M8_COPILOT_ECONOMY_TITLES_2026_11_06.md).

## UX et analyses

- [ ] **Revue UX à partir des maquettes** : reprendre les maquettes existantes avec les arbitrages métier du projet, sans reproduire leurs omissions.
- [ ] **Liste des produits avec un graphique** : définir ensemble l’écran concerné, l’indicateur, la période et la forme du graphique avant réalisation.
- [ ] **Chargement skeleton de la page Analyses** : représenter le chargement sans masquer inutilement des chiffres locaux déjà disponibles.
- [ ] **Redéfinir le design du menu Actions** : simplifier sa lecture et l’accès aux fonctions utiles.
- [ ] **Séparer les imports et la synchronisation de Ma semaine** : clarifier la navigation entre préparation commerciale et gestion des données, en réutilisant les parcours existants.
- [ ] **Libellés de couverture des analyses** : revoir les mentions répétées de jours complets/partiels/manquants. Proposition propriétaire : détail derrière « i », dans un panneau déroulant. Aucun changement des calculs n’est décidé à ce stade.

## Images produits

- [ ] **Générer une image par IA depuis la fiche produit**, en réutilisant le service de fichiers visuels, les droits et le processus d’approbation existants. Définir l’aperçu, la validation et le remplacement de l’image.
      La correction des aperçus PNG transparents et la suppression du libellé récurrent « Générique » sont déjà livrées et acceptées ; ne pas les recréer. Voir [les aperçus transparents](../qa/M7_TRANSPARENT_PRODUCT_PREVIEWS_2026_11_04.md).

- [ ] **Supprimer un fond réellement présent dans une image** : cadrer l’action de détourage et la conservation de la transparence. Distinguer un fond réellement présent dans le fichier d’un fond blanc ajouté par l’affichage ; préserver l’original.

## Coût et fonctionnement de l’IA

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

## V2 explicitement demandée

- [ ] **Génération d’images de TG** : illustrer une proposition de tête de gondole. Le périmètre sera défini après le cadrage du contexte d’implantation ; une illustration ne prouve pas la faisabilité physique ni une installation réalisée.
