# M7 — sources du chat et contexte Analytics exact (PR 276)

## Parcours

Une source monétaire du chat peut proposer « Explorer ces chiffres ». La destination reprend les dates, l’indicateur, l’agrégation et les filtres produits structurés du producteur serveur. Elle ne cherche pas une date, une unité ou un produit dans le texte de l’IA. La valeur citée reste celle du message conservé ; l’Explorer lit les données locales actuelles, qui peuvent être plus récentes ou incomplètes sur cet appareil.

Les producteurs couverts sont les instantanés du rayon, les périodes libres, les comparaisons J−7 du rayon et de produits, les regroupements de la requête analytique et les principaux produits de casse. Les bilans qui réutilisent ces résultats héritent de leurs destinations. Les sources externes, PDF, instructions et autres données non monétaires gardent leurs parcours propres ; elles ne deviennent pas des chiffres du magasin.

Un taux de casse ouvre explicitement les **montants** de sa période, pas un faux graphique de taux : le bouton et l’explication indiquent cette relation. La formule de taux reste celle du moteur partagé et de la réponse d’origine.

## Périodes et périmètres

- Une source peut porter une période libre bornée par le contrat existant (jusqu’à 3 660 jours), sa référence explicite et SUM ou AVERAGE. L’Explorer n’arrondit pas ces dates à un mois et ne remplace pas J−7 par ISO N−1.
- Les quatre vues habituelles restent Jour/Semaine/Mois/Année. Le contexte libre fixe ses dates : les flèches et le sélecteur routinier ne lui inventent pas une unité. Choisir explicitement une vue habituelle reprend sa politique de comparaison ; le retour de drill conserve le contexte source.
- Les sommes et moyennes réutilisent les fonctions existantes de comparaison calendaire. Les montants partiels restent consultables. Les deltas natifs exigent couverture complète et périodes closes ; des sommes de durées différentes ne deviennent pas un écart comparable. Les moyennes de durées différentes restent qualifiées. Ni horaire ni causalité n’est inventé.
- Les séries longues sont regroupées par mois, coupés aux bornes exactes de la source ; les moyennes restent des moyennes journalières. Les courtes séries gardent les montants quotidiens. Un drill n’invente pas une référence de jour quand le contexte source n’en définit pas.
- Le total officiel du rayon et la somme des produits-jours observés restent des bases distinctes. Une source issue du moteur de requête conserve sa base produits, même sans filtre.
- Catégorie, nature, produit, liste de produits et libellé sont conservés. La sélection SQLite réutilise le même filtrage accent-insensible que le moteur analytique, avec paramètres liés et `json_each` ; aucun SQL fourni par le modèle.
- Pour une ligne DAY d’un classement, l’univers des produits observés sur la période de classement est conservé. Une journée partielle ne devient pas complète simplement parce qu’on l’ouvre seule.

## Modèle, identité et compatibilité

`analyticsContext` est une métadonnée de présentation créée par le serveur, validée et limitée, sans magasin/acteur/URL/opérateur/mutation. Le modèle ne la produit pas. La projection du prompt et des résultats d’outils la retire ; les liens encodés des anciens messages assistant sont aussi retirés de l’historique envoyé au modèle, en conservant la prose. Aucune nouvelle consigne ni outil de génération n’est ajouté.

Une destination ajoutée à une ancienne copie du même fait n’est pas un fait contradictoire. Les valeurs, sources et deux destinations explicitement contradictoires restent refusées. Les empreintes de fraîcheur ignorent cette métadonnée de navigation ; une vraie valeur différente reste détectée. Les citations et messages existants ne sont pas réécrits. Les anciens lecteurs ignorent le champ facultatif, sans nouveau type de pièce jointe ni entité de synchronisation.

**Limite de transport encore ouverte :** le message existant reste limité à 16 000 caractères. Si l’enrichissement des citations dépasserait cette limite, le rendu conserve les liens sources au format historique, sans leurs destinations Analytics, plutôt que de faire échouer une réponse auparavant stockable. Ce comportement est testé, mais ne clôt pas la navigation compacte de toutes les réponses très longues. La fermeture de cette porte demande encore un transport compact compatible ; le périmètre V1 n’est pas réduit et le chantier UX n’est pas annoncé terminé.

## Preuves

- Suite complète locale : **2 192 tests réussis**, 496 cas conditionnés par l’environnement local ignorés ; lint et types réussis. Quatorze nouveaux cas, plus les cas existants enrichis, dont les anciennes copies d’un fait, J−7, regroupements et moyennes.
- Chaîne testée : producteur de période serveur (adaptateur Mongo de test, données canoniques) → citation encodée → lecteur natif → sélection stricte → cache de contexte → vraie SQLite migrée. La moyenne de 20 € et la référence de 10 € sont identiques ; après modification locale des données de test, les nouvelles valeurs diffèrent et la citation reste à 20 €. Cela ne remplace pas une recette réseau/Mongo réelle en production.
- Vraie SQLite : périmètre et liste de produits/libellé, univers de couverture DAY, absence d’écriture Outbox. Tests moteur : période exacte, moyennes vs sommes, zéro/négatif/partiel, référence absente ou ouverte, longue série et tri des moyennes.
- Projection modèle : aucune métadonnée de navigation dans les données projetées ; objets serveur et messages utilisateur non modifiés. Empreinte stable pour l’ajout de navigation, différente pour un changement de montant.
- Source native compilée pour le web à 390 points, données explicitement de test : source lisible, valeur originale et bouton Analytics ; moyenne et référence explicites consultables. Pas d’erreur console observée. Le clic réel du bouton vers SQLite sur téléphone reste à recetter ; la chaîne de données est vérifiée séparément ci-dessus. Shell et route temporaires retirés avant commit.
- Formatage, build/import API et exports Hermes iOS/Android passent ; les deux CI exactes push/PR restent requises avant fusion.

## Livraison et portes restantes

Aucune migration, nouvelle table/collection, dépendance native ou API de mutation. Les primitives de dates ont été déplacées à l’identique dans une feuille de contrat commune et réexportées, pour éviter un cycle entre preuves et contrats de navigation.

Ce lot requiert la future API compatible et le futur binaire pour bénéficier des nouveaux liens ; aucun déploiement, appel modèle/image ni build EAS payant n’est initié ici. La recette native des liens, du clavier/gestes, des grands textes, de la reprise hors connexion et des gros volumes reste ouverte, ainsi que le transport compact des très longues citations, les autres écrans/médias et toutes les portes M7/M8. Les sept chantiers et le périmètre complet V1 restent conservés.
