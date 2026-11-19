# Mercalys — confirmations différées et catalogue, 19 novembre 2026

**Arbitrage de livraison du 19 novembre :** le propriétaire demande le build
local/TestFlight pour tester lui-même sur iPhone avant son retour au Mac. Pour
cette livraison, cette recette remplace le préalable simulateur décrit plus bas.
Aucune validation visuelle n’est revendiquée. Contrôles automatisés et vérification
de l’archive maintenus ; aucun build EAS cloud payant.

Statut : PR 546 fusionnée, livrée avec le Journal PR 547 dans le build local 86,
archive vérifiée et envoi accepté par Apple. Recette propriétaire attendue.
Le build 85 reste la référence acceptée pour la rapidité et la réouverture.
Aucun appel IA ajouté. Voir [la livraison](BUILD_86_DELIVERY_2026_11_19.md).

## Comportement approuvé

- ITM8/EAN connu et univoque : article existant. Codes contradictoires, propriétaire
  archivé ou code non validé : examen manuel. Tous les codes inconnus : création
  groupée explicite, sans blocage par ressemblance de libellé. Sans code : examen
  manuel, sauf association par alias précédemment confirmée.
- Chaque décision écrit immédiatement le produit/codes et l’Outbox dans la même
  transaction. Les lignes concernées se mettent à jour ; pas de réidentification
  complète après chaque clic. Les doubles clics sont verrouillés.
- « Terminer les confirmations » actualise une seule fois, même si la liste n’est
  pas entièrement traitée. Un marqueur SQLite par magasin/propriétaire/checksum
  survit à la fermeture et au redémarrage ; il bloque la publication du lot tant
  que la session n’est pas terminée. Les décisions déjà enregistrées sont conservées
  en cas d’interruption ; aucune file de recalcul en arrière-plan n’est ajoutée.
- À la prochaine ouverture, les originaux conservés bénéficient du nouveau matcher.
  Les codes déjà confirmés et observations publiées restent conservés. Le cache
  intègre la nouvelle politique et les propriétaires archivés. Un redémarrage peut
  nécessiter une première lecture, sans dépendance au réseau pour les données locales.
- Produits → Nettoyer le catalogue : filtres 30/90/180/365 jours, dernière vente
  connue, couverture observée et présence dans le dernier fichier avec PA publiés.
  Une absence de vente n’établit pas l’inactivité. La sélection et l’archivage sont
  explicites, réversibles via INACTIVE/ACTIVE ; prix, codes et historique conservés.
  Une sélection devenue obsolète ou conflictuelle est refusée transactionnellement.

L’ancien contrôleur d’import conversationnel conserve sa politique historique
`LEGACY`, car son autorisation inclut déjà une création automatique. Lui appliquer
les codes inconnus élargirait silencieusement cette autorisation. Les parcours actifs
Imports, local et email utilisent la politique CODES ; pas de nouveau parcours IA.

## Vérifications automatisées et mesure

- Suite locale : 551 fichiers, 5 510 tests réussis ; 93 fichiers / 899 tests non
  exécutés par la configuration locale. Ce n’est pas la qualification CI complète.
- Tests SQLite réels : persistance du marqueur, publication bloquée, décisions
  successives, retry sans doublon, révocation d’autorité avec rollback, codes archivés,
  archivage/réactivation avec Outbox, prix/ventes inchangés, nouvelles ventes invalidant
  une sélection. Tests UI : enregistrement visible, double clic, pas de comparaison
  globale par décision et finalisation explicite. Tests de reprise partielle et
  compatibilité des autorisations conversationnelles conservés.
- Typecheck, lint, structure et format locaux réussis après les ajustements UI.
  Les tests couvrent aussi la validation explicite d’un code à vérifier et la
  préparation laissée en attente sans erreur lorsque la session est inachevée.
- Mesure privée sur la copie de catalogue du simulateur (458 articles) et le fichier
  fourni (1 226 lignes) : environ 958 ms avec l’ancien matcher, 3 ms par codes sur
  le Mac. Avant : 542 correspondances automatiques, 106 sans correspondance,
  217 à revoir et 361 ambiguës. Après : 517 correspondances, 709 lignes à codes
  inconnus. Ce sont des lignes, pas nécessairement autant de produits, et ce n’est
  ni le catalogue actuel de l’iPhone ni une mesure de latence native.

Les fichiers source, copie de catalogue, benchmark et harnais restent privés dans
`../maintenance/mercalys-session-2026-11-19/`, hors Git. Aucun enregistrement de test
n’a été inséré en production.

## Recette native restante

Le Mac est verrouillé ; le propriétaire reporte son déverrouillage. Aucun résultat
visuel n’est revendiqué pour ce lot. La précédente recette build 85 ne le valide pas.

1. Démarrer le harnais Expo Go isolé avec le fichier réel, sans connexion à l’API.
   Ne jamais pointer une base de test vers la base utilisateur ; conserver cette
   base isolée pour le test de redémarrage. Ajouter le device_id local au harnais.
2. Vérifier les nouveaux regroupements sur le fichier retenu, puis création
   individuelle et association enchaînées : feedback immédiat, compteur local,
   aucune identification complète entre les choix, navigation encore réactive.
3. Créer le lot proposé ; progression numérique et aucune création en double après
   double appui. Quitter puis revenir avant finalisation ; statut à terminer visible
   dans le lot et publication bloquée. Redémarrer sur la même base isolée et vérifier
   les décisions ainsi que le marqueur persistant.
4. Terminer une session partielle : une actualisation puis publication des seules
   lignes prêtes. Vérifier un fichier déjà partiellement publié : historique et
   observations précédentes inchangés, aucun doublon de publication.
5. Dans Produits, ouvrir le nettoyage ; qualifier les données absentes, sélectionner,
   confirmer l’archivage, voir l’article dans Archivés et le réactiver. Vérifier la
   fermeture de la feuille, le retour à la liste et le blocage des codes archivés.
6. Enregistrer les captures et durées réelles hors Git, retirer les adaptations
   temporaires Metro/entry puis vérifier un diff propre à la fonctionnalité.

La livraison groupée a passé la CI push/PR/master, la compilation locale et la
vérification d’archive. Le propriétaire remplace le préalable simulateur par sa
recette iPhone. Aucun EAS cloud payant ; l’API publiée accompagne le lot Journal.
