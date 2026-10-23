# Actions — décisions et réalisations du copilote

## Parcours et sens métier

L’onglet Actions donnait accès aux tâches d’un plan commercial, mais pas aux choix et déclarations conservés depuis les conversations. « Décisions et réalisations » ouvre maintenant leur suivi local, même sans plan validé. Le bloc reste replié par défaut ; il ne monte pas une nouvelle file de tâches ni un moteur d’exécution.

Dix éléments au plus par page, filtres Tout / Choix / Déclarées, libellés français, état de synchronisation et ouverture de la conversation d’origine lorsqu’elle est encore disponible. Les choix Accepter / Adapter / Reporter / Écarter restent distincts des réalisations explicitement déclarées et des déclarations retirées. Aucune recommandation seule n’est affichée comme une réalisation et aucune ligne n’est marquée faite par ouverture.

La semaine concerne le **dernier changement enregistré** : décision `updatedAt`, déclaration `createdAt`, retrait `withdrawnAt`. Les limites sont les minuits du magasin Europe/Paris calculés par le moteur partagé, y compris le changement d’heure. Ce ne sont pas les dates réelles d’exécution ; les détails réels connus restent affichés séparément. Aucun résultat de vente ni causalité n’est déduit.

Le filtre rejoint les préférences locales privées existantes de semaine/filtre. L’ancien JSON sans ce champ facultatif reste lisible. Page et repli restent en mémoire pendant un retour depuis le chat ; un changement de période repart à la première page correspondante en gardant le suivi ouvert. Pagination et filtre ramènent au début du bloc. Ces préférences ne sont ni des commandes métier ni une nouvelle migration de données.

## Conservation et confidentialité

Le lecteur exécute une seule requête SQLite par page, bornée à onze lignes pour en afficher dix, avec isolation magasin/propriétaire dans les deux familles et chaque jointure privée. Il réutilise contrats, décisions, déclarations et liens de conversation existants ; il n’appelle ni modèle, ni réseau, ni writer métier.

La citation d’un choix est contrôlée par la carte privée synchronisée, son parent, l’identité/digest de la décision et l’état connu de sa source. Comme l’éditeur canonique, une carte vérifiée peut être lue avant que l’historique source plus ancien soit local ; un tombstone explicite ou une source présente contradictoire empêche de réafficher cette citation. Une conversation supprimée, un message supprimé ou une métadonnée privée endommagée ne supprime pas l’enregistrement métier indépendant : les détails indisponibles sont qualifiés, le lien inaccessible est désactivé, et aucun texte supprimé n’est réaffiché. Un payload métier de mauvais propriétaire est refusé.

Les lectures se font à l’ouverture/focus, après pull et sur actualisation explicite. Fermer le bloc suspend ses lectures sans effacer page et filtre. Les progressions intermédiaires de synchronisation ne provoquent pas de relectures en boucle ; le retour sur l’écran pendant une synchronisation bloquée relit quand même SQLite. Erreur et résultat tardif ne remplacent ni le contenu affiché ni celui d’un autre compte.

## Preuves et limites

- **25 tests ciblés** sur lecteur SQLite, vrai composant natif, route Actions et préférence privée. Fichier fermé/rouvert, aucune commande ajoutée par la lecture/navigation, pagination de dates identiques, isolation des comptes/magasins, quatre choix successifs, déclarations indépendantes et retrait pendant une autre semaine.
- Suppression du message source/parent/carte/conversation, carte substituée, historique source absent, tombstone, JSON privé endommagé et propriétaire contradictoire. L’historique métier est conservé sans révéler une citation masquée.
- Vrai composant : aucune lecture avant ouverture, repli/retour avec page conservée, 300 rendus de synchronisation regroupés, reprise manuelle, ancien résultat de compte ignoré, changement de semaine, lien indisponible et rendu de vraies décisions/déclarations SQLite sans plan commercial.
- Une régression du lecteur de plan Actions est reproduite avant correction : 200 changements de compteurs de calculs locaux produisent **201 appels** au port de lecture du plan. Le compteur de commandes déjà disponible remplace ce déclencheur ; une seule lecture initiale reste nécessaire, et un retour pendant une synchronisation bloquée relit bien le plan. Il s’agit de demandes de lecture dans le test monté, pas d’une mesure de latence sur appareil.
- Rendu du vrai composant en copie Expo isolée, ports de liste/navigation explicitement simulés, 320/390 points : zéro débordement horizontal, filtre « Déclarées » lisible, pagination avec en-tête visible (83 points à 390), repli/retour, semaine vide et lien de conversation ciblé. Aucune erreur console relevée. Les captures ont été inspectées dans la session, sans artifact image persistant ; onglet fermé, viewport réinitialisé et serveurs temporaires arrêtés. Cela ne prouve pas un transfert réel, le routage authentifié complet ni les gestes/accessibilité iOS/Android.

La première CI a détecté une course dans les assertions de focus du formulaire produit : le helper de clic attendait un callback qui jetait la promesse de validation. Le bouton transmet maintenant la promesse de soumission canonique ; les tests attendent sa fin, y compris après un échec local différé. Aucun délai artificiel, retry de test, règle de validation ou algorithme de focus supplémentaire.

Les contrôles complets et CI du commit final sont nécessaires avant fusion ; résultats dans la PR et les preuves de livraison. Aucun appel IA payant, clé, écriture de production, déploiement API ou nouveau build EAS. Les tests dépendant de Mongo restent distincts lorsqu’ils ne sont pas disponibles localement.

## Livraison

Lot natif suivant le build 13, avec les PR 337–339 déjà fusionnées. La PR 339 exige une API reconnaissant la capacité catalogue 2 avant le futur binaire ; ce suivi ne crée pas un nouveau contrat API. Sept chantiers inchangés : 1/3/4/5/6/7 en cours ; 2 Contre-promo code prêt. La conversation réelle recommandation → décision → réalisation → bilan, la recette matérielle et les autres critères V1/M8 restent ouverts.
