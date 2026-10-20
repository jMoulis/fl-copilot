# Actions — liste et déclaration progressive (20 octobre 2026)

## Parcours et portée

Le suivi des affiches et TG du plan validé réutilise les propositions, identités et compteurs du moteur commercial. La liste remplace les cartes imbriquées par des lignes : libellé, statut déclaré, état de synchronisation et aperçu de note ou contexte prévu. Les visuels approuvés utilisent le cache existant ; un placeholder reste neutre. Aucun glissement ne marque une tâche faite et aucun bouton de commande fournisseur n’est inventé pour reproduire une image illustrative.

Toucher une ligne ouvre une feuille native. La déclaration reste un choix explicite puis « Enregistrer ». Les quatre états À faire / Fait / Ignoré / Non applicable, les motifs obligatoires, la date de déclaration et les détails réels sont conservés. Note complète, cadre de prix prévu et ancienne date de déclaration sont consultables dans la feuille ; dates, prix/unité et emplacement réels se déplient à la demande. Replier ces champs ne vide pas leur saisie. Un détail réel invalide ouvre sa section et affiche l’erreur à cet endroit ; il ne colore plus la note par erreur.

Un refus de la transaction est désormais affiché **dans la feuille ouverte**, sans masquer la saisie derrière la modale. La feuille active l’évitement du clavier iOS ; les autres feuilles gardent leur comportement par défaut. Sa recette sur appareil reste ouverte. La fermeture par le bouton, le retour natif ou la poignée passe par le même garde : aucune fermeture pendant l’enregistrement et confirmation si la déclaration a changé. L’éditeur garde la copie exacte du plan qu’il a ouverte, même si la lecture de fond change de révision. Les anciens enregistrements d’une autre copie restent séparés ; les conflits ouvrent la comparaison existante plutôt qu’un éditeur autorisant un écrasement.

Les compteurs décrivent toutes les propositions de cette copie du plan, pas le filtre affiché. Avant la lecture de la bonne révision, aucun compteur à zéro n’est inventé. À faire / Faites / Toutes conservent leurs filtres ; les refus/conflits restent signalés même si leur ligne n’est pas dans le filtre. La progression ne prouve ni l’exécution complète de la promotion, ni un prix appliqué en caisse, ni un effet sur les ventes.

L’onglet Actions conserve le choix de semaine, les liens contextualisés Préparation / Plan et historique et l’accès aux documents. Casse, imports et gestion du magasin restent accessibles dans une section progressive. Le contexte de semaine reste conservé dans la session ; sa restauration après arrêt complet n’est pas ajoutée ici. Ce lot ne prétend pas réunir toutes les déclarations privées du chat dans l’onglet Actions.

Aucun contrat, migration, moteur métier, dépôt d’écriture, règle d’autorité, traitement IA ou dépendance n’est ajouté. Les actions locales et leur Outbox restent celles de `CommercialExecutionRepository`.

## Preuves et limites

- Lint et TypeScript stricts ; suite existante des déclarations SQLite, du moteur de tâches et du contrôleur conversationnel : 24 tests passés. Ces tests couvrent notamment atomicité/Outbox, redémarrage, version, refus et conservation des détails. Le contrôle complet local passe : **2 760 tests / 590 ignorés faute d’environnement externe**, dix projets TypeScript, lint et structure. Les exports Hermes iOS/Android passent également, sans route de recette. La CI du commit final reste requise avant fusion ; elle fournit l’environnement Mongo transactionnel.
- Une route temporaire a monté les composants réels `ExecutionChecklistView` et `ExecutionDeclarationSheet`, avec un plan explicitement simulé et des ports éphémères. Elle a été supprimée avant les vérifications finales. Aucun faux chiffre, plan ou action n’est livré.
- À 390 px : liste compacte, filtres cohérents avec le moteur, ouverture sans enregistrement, formulaire progressif, prix sans unité refusé avec réouverture de section et note conservée. Confirmation explicite : un seul enregistrement simulé puis filtre À faire vide. Refus simulé visible dans la feuille avec la note préservée.
- À 320 px : largeur page et dialogue 320 px, sans débordement horizontal. Capture du refus conservée. Ce contrôle n’émule pas le clavier iPhone, le texte agrandi, VoiceOver ou TalkBack.
- La confirmation JS de fermeture a bloqué l’automatisation du navigateur. Les tentatives documentées de récupération/fermeture du seul onglet QA ont échoué ; le contrôle natif de Codex est interdit par l’outil et aucun autre mécanisme n’a été utilisé. La fermeture annulée n’est donc pas déclarée acceptée. Le serveur QA a été arrêté et la route/fixture retirées. L’état de nettoyage de l’onglet/viewport reste à confirmer.

Artifacts locaux : `artifacts/action-task-overview-2026-10-20/` dans le dossier de travail du thread. La preuve navigateur porte sur les composants et des ports simulés, pas sur une sauvegarde réelle du téléphone. Les tests SQLite complètent cette preuve ; ils ne remplacent pas la recette native.

## Livraison et recette native restante

Le build **0.1.0 (4)**, source `9c2f66b`, a terminé le 20 octobre à 13:50:45 UTC. L’API `dpl_6Kb25ogrAZubQJc29Ka5EMEN5wTa` est Ready sur `fl-copilot.vercel.app` ; santé publique JSON avec Mongo connecté et refus applicatif 401 sans connexion vérifiés. Ils contiennent PR 291–301, dont tableaux du chat et fiche produit ; **ce nouveau lot Actions n’y est pas présent**. Pas de build payant ni déploiement API pour cette seule évolution native.

Prochaine recette groupée : semaine passée → tâche → note + détails réels → replier/réouvrir ; Fait/Ignoré et motif ; retour/poignée avec annulation et abandon ; refus de version visible sans perte ; changement de révision en fond ; filtre masquant un conflit ; fermeture/réouverture puis synchronisation de la même déclaration. Ajouter clavier, texte agrandi, VoiceOver/TalkBack et Android. Accepter un conseil reste distinct d’une déclaration de réalisation et d’un bilan.

**Sept chantiers :** 1/3/4/5/6 en cours ; 2 code prêt ; 7 en cours, avec cette progression L5. Aucun chantier entier ni la V1/M8 n’est clôturé par ce lot.
