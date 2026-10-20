# Plan magasin — inventaire fixe et surfaces (20 octobre 2026)

## Parcours et invariants

Le mode explicite « Modifier le plan » permet désormais d’ajouter un îlot vide, un élément fixe dans un îlot/face/rang choisis, une TG ou un mobile. Une TG physique supplémentaire est annoncée comme telle ; elle ne provient jamais du nombre d’idées commerciales d’un PDF. Les seize éléments et trois TG du pilote ne sont pas modifiés automatiquement. L’éditeur numérique existant continue de gérer noms, mesures et positions.

Chaque nouvel élément fixe possède un bac et sa propre étagère, avec de nouvelles identités. La composition d’une TG reste inconnue jusqu’à l’ajout explicite d’un bac, d’une étagère ou d’une autre surface de vente. Les surfaces peuvent être nommées ; seules les surfaces de TG peuvent être retirées isolément. Les deux surfaces obligatoires d’un élément fixe et la surface d’un mobile ne peuvent pas être supprimées séparément.

Une copie d’îlot reprend ses éléments de face et leurs surfaces, avec de nouvelles identités et des libellés repérant le nouvel îlot. Une copie de fixe exige un rang libre. Les mobiles associés ne sont jamais dupliqués. Position et orientation ne sont pas reprises. Par défaut, toutes les mesures de la copie sont inconnues ; l’utilisateur peut reprendre les dimensions comme **déclarées**, jamais comme relevées sur cette copie. Charges admissibles inconnues, aucune capacité en kg ni stock déduit d’une surface. La provenance du plan initial reste consultable ; les nouveaux objets n’usurpent pas les identifiants externes de cette référence.

Le retrait d’un îlot supprime ses éléments et leurs surfaces dans le brouillon courant. Les mobiles associés restent présents, avec les mêmes identités, surfaces et coordonnées ; seule leur association au meuble retiré est vidée. Les versions historiques et leurs allocations ne sont pas réécrites. L’annulation du brouillon restaure les identités d’origine, sans les régénérer. La sauvegarde, l’adoption après comparaison/géométrie, les conflits et la restauration restent les actions canoniques existantes.

Appliquer un ajout ou une copie ne sauvegarde pas encore le plan. L’enregistrement du brouillon crée ensuite la transaction SQLite, l’historique et l’Outbox habituels. La référence adoptée n’est pas remplacée par une modification de brouillon. Les contrôles de rang, d’identité, de structure et les limites du contrat existant sont réutilisés ; un dépassement est refusé, jamais tronqué.

Les formulaires d’inventaire sont dans les feuilles existantes ; aucune modale native n’est présentée au-dessus d’une autre. Après l’ajout, l’objet est sélectionné sur le plan, sans ouverture automatique d’une seconde feuille. Les champs non appliqués demandent une confirmation de fermeture dans l’écran, sans dialogue JavaScript du navigateur. Perte de droits ou conflit : les nouvelles écritures sont refusées, mais la fiche reste fermable. Pan/zoom restent consultatifs ; ce lot ne transforme pas un geste d’exploration en déplacement du mobilier.

## Vérifications

- **94 tests ciblés passés** : moteur d’inventaire, contrat/modèle, géométrie et placements existants, dépôt SQLite et présentation/annulation. Nouveaux cas : rang occupé/absent/invalide, identités distinctes, mesures inconnues ou déclarées, non-duplication des mobiles/TG, conservation des surfaces, retrait/désassociation et limite d’inventaire.
- **10 tests transactionnels Mongo passés** sur une instance locale jetable dédiée, dont le nouveau parcours SQLite A → Outbox/Mongo → SQLite B, nouvelles identités de copie, retrait et restauration à froid dans une troisième base vierge. Historique complet conservé, réessai sans doublon, aucune observation de vente/casse, produit ou plan commercial créé. Le serveur et son répertoire temporaire ont été arrêtés/supprimés après vérification de son PID, port, replica set et dbPath ; aucun serveur Mongo utilisateur touché.
- Le test SQLite avec fichier ferme et rouvre réellement la base : copie d’îlot, retrait de l’original, conservation du mobile et des surfaces copiées, puis restauration historique dans une nouvelle révision avec quatre commandes en attente. Un test d’annulation conserve exactement les identités après copie/retrait.
- Contrôle local complet : **2 775 tests passés / 591 ignorés** sans services externes, dix projets TypeScript, lint et structure. Le build et l’import du bundle API passent également. Les exports Hermes iOS/Android passent, sans route QA. Contrôles finaux et CI du commit final restent nécessaires avant fusion.

Aucun contrat de transport, table, migration, dépôt d’écriture ou fournisseur n’est ajouté. Les formes d’inventaire restent dans le contrat physique existant. Aucun `.env`, réglage système, service externe ou donnée réelle n’est modifié pour les tests.

## Revue visuelle et limites de preuve

Une route jetable a monté le véritable `StoreLayoutPanel` avec un plan explicitement simulé et des ports de sauvegarde éphémères. Le plan existant est rendu avec les mesures de référence qualifiées. Le Mac a été signalé verrouillé ; les commandes clic/Entrée ne modifiaient pas même un compteur QA indépendant du plan, sans erreur console. Cela ne prouve ni un défaut spécifique du produit, ni la réussite des interactions. La recette complète de ce parcours n’est donc pas annoncée acceptée.

Un second montage a rendu le véritable `LayoutInventoryForm` dans la feuille native partagée. À 390 px : libellés, choix îlot/face/rang et reprise de mesures non cochée lisibles. À 320 px : page, dialogue et contenu de largeur 320, sans débordement horizontal. Cette preuve est une **revue du rendu**, pas une validation des clics, du clavier iPhone, du texte agrandi ou de VoiceOver/TalkBack. Les deux onglets de cette recette ont été fermés, le viewport réinitialisé, les serveurs arrêtés et routes/fixtures retirées. Le problème antérieur du dialogue JS de l’onglet Actions reste distinct.

Captures, montages, logs et identité du serveur de test sont dans `artifacts/layout-fixed-inventory-2026-10-20/` du dossier de travail du thread. Aucun plan simulé ni route QA ne doit être livré.

## Portes V1 conservées

- Reprendre la recette interactive : ajout fixe/TG, surface de TG, copie vers rang libre, refus du rang occupé, annulation, fermeture de saisie et retour exact au plan. Tester un conflit/une perte de droits pendant la saisie, l’enregistrement, le redémarrage et la synchronisation sur appareil.
- Les lecteurs existants du copilote accèdent au plan enregistré via la synchronisation. **Les nouvelles créations/copies/retraits d’inventaire ne sont pas encore exposés à son outil de préparation d’édition.** Cette parité reste nécessaire avant de clôturer le CRUD V1 ; aucune dérogation propriétaire n’est supposée.
- Manipulation géométrique directe distincte du pan, illustration liée à une révision/scénario, activation/budget fournisseur, mesures réelles et acceptation du pilote restent ouverts. Aucun dessin de substitution ne devient une mesure confirmée.
- La dernière livraison reste l’API et le build iOS **0.1.0 (4), source `9c2f66b`**. PR 302 est fusionnée en `91769f5` ; elle et ce lot ne sont pas dans le build 4. Aucun nouveau déploiement ni build EAS payant pour ce seul incrément.

**M7 :** 1/3/4/5 en cours ; 2 code prêt ; **6 implantation et 7 UX en cours**, avec progrès démontré sur l’inventaire. Aucun chantier entier ni M8/V1 n’est clôturé.
