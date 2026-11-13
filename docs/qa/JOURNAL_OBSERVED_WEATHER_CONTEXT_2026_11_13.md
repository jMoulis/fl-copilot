# Journal — raccordement de la météo observée

Réutiliser le contexte magasin, le cache fournisseur partagé et le cache SQLite.
Pas de modèle métier, migration, tâche planifiée ou outil IA supplémentaire.
La météo observée est une source optionnelle distincte de la prévision MET.
Les versions sans la capacité HTTP gardent exactement leur réponse existante.

## Référence et périmètre

Pour éviter un paramètre technique et une affectation fictivement approuvée,
utiliser une **référence automatique** : station la plus proche du point magasin
parmi celles du fichier récent du département de sa commune. Ce n'est ni la
station la plus proche de toute la France, ni une station validée par le gérant.
Le choix n'utilise aucune vente, corrélation ni résultat commercial. Afficher
son nom, sa distance à vol d'oiseau et cette limite. Les périodes comparées
réutilisent la même référence récente ; une absence dans un ancien fichier ne
déclenche pas une substitution silencieuse par une autre station.

Cette méthode remplace, pour ce raccordement, le préalable d'un nouveau réglage
de station envisagé dans la qualification de source. Les réglages canoniques de
commune/position restent l'autorité. Une sélection manuelle explicite restera un
arbitrage ultérieur ; aucun choix propriétaire n'est fabriqué. L'outre-mer et les
fichiers dépassant les bornes de lecture restent indisponibles explicitement.

Le catalogue officiel fournit les URL et périodes, sans reconstruire un nom
d'archive passé ou supposer le découpage des fichiers de l'année suivante.
La borne de lignes accepte aussi les archives anciennes (500 000 lignes au
maximum, dans une enveloppe de 4 Mo comprimés / 32 Mo décomprimés) ; le comptage
précède l’allocation de la liste des lignes.
Un fichier public gzip borné est partagé via le cache existant ; les octets ne
sont jamais envoyés au mobile ou au modèle. Les valeurs retenues gardent leur
code qualité, date producteur, position de mesure, URL, empreinte et récupération
de source. Les dates de publication historiques restent inconnues.

## Lecture et présentation

Seules les journées passées et les fenêtres de pluie terminées à la récupération
sont éligibles. Une mesure absente ou non validée ne devient jamais zéro.
La pluie reste le cumul producteur 06 h UTC à 06 h UTC, sans réattribution à la
journée parisienne d'ouverture. Aucun soleil/ciel n'est déduit des seuls extrema
ou d'une pluie nulle. Une prévision archivée reste séparée et nommée ainsi.

Le Journal présente les mesures disponibles des journées passées et permet de
consulter leurs sources dans le volet existant. Le copilote reçoit uniquement les
jours de la semaine demandée dans son outil de contexte existant, sans archive
brute, nouveau tour de modèle ni calcul causal. La fraîcheur et la couverture
restent explicites. Une panne n'efface pas la dernière lecture locale et ne
bloque pas les autres sources ni les chiffres du rayon.

## Vérifications requises

Contrats anciens/nouveaux, autorisation magasin, choix géographique déterministe,
référence identique entre périodes, archives manquantes, valeurs zéro/absentes,
codes qualité, dates/pluie, cache partagé/304/panne, conservation SQLite et
présentation native montées. La fusion, la publication API, le binaire et sa
recette iPhone sont des jalons distincts. Build 54 et sa validation restent
inchangés pendant ce développement.

Vérifications locales : 5 216 tests réussis, 869 cas conditionnels ignorés
localement ; types du workspace, lint, format, import du bundle API et export
iOS réussis. La lecture des sources publiques réelles renvoie sept dates pour
le 28 septembre–4 octobre 2026, avec la station Suresnes sélectionnée pour un
point de test municipal d'Asnières (pas présenté comme la position exacte du
magasin). Aucun appel IA ou écriture de production pour ce contrôle. Les tests
natifs montés vérifient les libellés, la pluie nulle, le lien source et la
consultation séparée de la prévision archivée ; ils ne constituent pas une
recette sur le téléphone du propriétaire.

Le test Mongo transactionnel vérifie le partage du fichier entre lectures,
la panne, le délai avant reprise et le 304 : celui-ci renouvelle la vérification
du cache sans inventer une nouvelle date de téléchargement de la source.
Il reste à exécuter dans les contrôles GitHub avant fusion.

La lecture publique du 4–10 novembre 2024 retrouve également sept dates dans
l’archive 1950–2024 des Hauts-de-Seine, avec la même référence récente Suresnes.
Ce contrôle réutilise un point municipal de test et ne prétend pas affecter une
station au magasin en production.

Après ce passage complet, le scénario de semaine à cheval sur deux archives a
également été ajouté et vérifié dans les huit tests ciblés du lecteur. Les
contrôles GitHub doivent porter sur le commit final complet.
