# M7 UX — tâches et semaine consultée

## Parcours

L’onglet Actions présente les tâches du plan validé avant les raccourcis de gestion. Semaine ISO explicite, précédente/suivante, calendrier français et retour à la semaine courante. Les liens Plan/historique et Préparation reçoivent exactement la semaine sélectionnée ; Documents reste l’entrée documentaire existante. Le choix reste conservé au changement d’onglet dans la même session et séparé par magasin/utilisateur. Sa restauration après arrêt complet n’est pas ajoutée par ce lot.

Les tâches proposent À faire / Fait / Toutes. Les compteurs restent ceux du moteur déterministe existant, sur le plan entier et non sur la sélection affichée. Ouvrir une tâche ne la marque pas faite. La déclaration existante, les motifs obligatoires, les détails réels et l’enregistrement explicite restent inchangés. Les conflits/envois refusés sont signalés même quand le filtre pourrait masquer leur ligne ; Toutes permet de les consulter. Les autres déclarations conservées restent séparées du suivi des tâches de cette copie.

Les lectures conservent le contenu de la même semaine pendant l’actualisation ; une erreur propose une reprise. Pendant une synchronisation en écriture, une nouvelle lecture du plan attend sa fin. Sans magasin, pas de chargement infini. Aucun faux compteur à zéro n’est affiché avant la lecture des tâches de la bonne révision.

L’éditeur de déclaration garde la copie du plan effectivement ouverte. Une actualisation vers une autre révision ne le démonte plus dans Actions ; les données de suivi des deux révisions ne sont pas mélangées en attendant la nouvelle lecture. Les contrôles métier existants gardent la décision finale d’enregistrement, sans rattacher silencieusement une ancienne déclaration au nouveau plan. La fermeture volontaire avec modifications garde la confirmation existante.

Aujourd’hui remplace son ancien message statique « aucune tension magasin » par le composant existant de signalements réels (lecture locale, statuts et historique). Cette liste d’observations courantes ne prétend pas décrire uniquement la journée des KPI. Les trois priorités au maximum et leurs règles de calcul ne changent pas ; leurs libellés utilisent un langage métier plus simple.

## Vérifications et limites

Contrôles requis : lint/typecheck, suite existante de suivi d’exécution et de périodes commerciales, `pnpm check`, format, exports iOS/Android. Pas de formule, contrat de synchronisation, migration, nouvelle dépendance ou appel IA ajouté. Les mêmes versions, preuves de réalisation et règles de publication restent canoniques.

Recette native encore requise dans la livraison groupée : ancienne semaine → plan correspondant → tâche → saisir une note → actualisation du plan → conserver l’éditeur ; Annuler/Enregistrer ; tâche faite/ignorée/conflit et filtres ; semaine ISO de fin d’année ; clavier, calendrier, gestes, texte agrandi et accessibilité. La confirmation d’une recommandation ne prouve toujours pas une exécution. Aucun déploiement API ni build EAS payant n’est lancé par ce lot.

L5 reste ouvert sur les autres parcours, et les autres engagements V1/M7/M8 restent conservés. La validation des produits de la PR précédente reste distincte de cette tranche.

## Cohérence de la casse entre Aujourd’hui et Analyses

Le KPI « Casse au PA » d’Aujourd’hui ouvrait la mesure au prix de vente dans l’Explorer. Le lien sélectionne désormais explicitement `wasteCost`, distinct de `waste`. Le calcul connu + estimé et sa qualification de disponibilité ont été déplacés à l’identique dans le moteur partagé, puis réutilisés pour la journée, les agrégats, les filtres produit et les contributions. L’interface annonce que le coût peut inclure des estimations. Aucun coût d’achat n’est déduit du montant de vente.

Les anciennes données sans champs de coût restent lisibles et produisent « indisponible », jamais zéro ni une reprise du prix de vente. Le nouveau choix est un état de navigation local ; les requêtes métier `analytics.query` conservent leurs métriques existantes, sans nouvel outil ou instruction IA. Aucun producteur serveur n’émet de nouvelle citation `wasteCost` vers les anciens clients dans ce lot.

Tests : politique connue/estimée et null/zéro, tests Aujourd’hui existants inchangés, lecture SQLite rayon et produit (5,50 € de coût contre 99 € de valeur de vente), comparaison distincte et absence de mutation de l’Outbox. Suite finale locale : **2 201 tests passés, 496 ignorés faute d’environnement externe**, lint/typecheck et build/import API passés. Exports Hermes iOS/Android passés ; CI exactes encore requises avant fusion ; une compilation ne constitue pas une recette native.
