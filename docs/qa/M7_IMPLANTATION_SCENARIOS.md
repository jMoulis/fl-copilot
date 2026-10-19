# M7 — implantation : premier contrôle géométrique (PR 264)

Chantier actif : **6**. Périmètre livré dans le code : un calcul provisoire de rectangles, utilisable par le chat. Ce n’est ni le schéma visuel ni l’illustration T28 ; aucune mesure réelle n’est confirmée ou extraite automatiquement d’une photo. Aucun build payant ni déploiement par cette PR.

## Contrôles automatisés

- Rectangles en millimètres entiers ; rotations 0/90°, emprises après rotation et nombres attendus de TG/îlots. Bornes : 8 meubles, 6 obstacles et 4 réservations d’accès. Entrées invalides, doublons, positions négatives, dimensions nulles/arrondies et formes/angles non pris en charge ne deviennent pas des validations.
- Bord touché exactement, largeur au minimum déclaré et charge/hauteur à la limite sont admis. Dépassement de zone, collisions de meubles ou d’obstacles, entrée/allée obstruée, passage trop étroit et charge/hauteur excessives sont signalés avec leurs cibles. Des réservations peuvent se rejoindre ; des parties d’obstacles fixes peuvent se superposer.
- Dimension, limite, charge et inventaire inconnus restent inconnus. Zéro charge/limite et zéro meuble attendu sont des valeurs, pas des absences. Une contrainte violée reste bloquante même avec des données manquantes.
- Empreinte déterministe du scénario et du magasin : même entrée, même résultat ; changement d’entrée ou de magasin, nouvelle référence. Cette empreinte n’est pas un historique éditable de révisions.
- SDK simulé : outil absent sans adaptateur, entrée stricte sans identité/autorité, résultat étranger ou altéré refusé, résultat bloqué conservé, progression et sources canoniques. Les liens existants conservent les qualifications et dimensions ; les chiffres ne viennent pas d’un calcul du modèle. Aucun appel de modèle réel.

Les contrôles n’établissent pas de norme réglementaire, de continuité entrée/sortie, de capacité de stockage ou de stabilité physique. Les minima sont déclarés pour le scénario ; aucune largeur légale n’est inventée. Le cas sans anomalie reste **provisoire**.

## Recette dialogue après livraison API groupée

Pas de build iPhone requis pour ce seul outil : il réutilise les formulaires et liens de source existants. Ne tester en réel qu’après identification de la livraison compatible.

1. Demander l’étude d’une TG et d’un îlot avec dimensions et contraintes explicitement fournies. Réponse courte, sous forme de scénario hypothétique ; les questions se limitent aux informations manquantes utiles. Les unités présentées sont compréhensibles et les sources consultables.
2. Ne pas fournir les dimensions ou l’inventaire des obstacles : le copilote demande les mesures utiles via le formulaire existant, sans les déduire des pixels ni prétendre à une implantation validée.
3. Demander explicitement un scénario impossible (meuble hors zone ou devant une entrée). Il indique le blocage avant de proposer un ajustement. Après changement des dimensions, le résultat est recalculé ; l’ancienne référence ne change pas silencieusement.
4. Une charge maximale inconnue ne devient pas nulle. Une charge réelle déclarée nulle reste zéro. Pas de stock, de prix, d’élasticité ou de gain commercial inventé.
5. Aucun plan, réglage magasin ou réalisation n’est enregistré par cette discussion. Pas d’image promise comme déjà produite, de conformité garantie ou d’action réellement exécutée.

**À faire avant clôture du chantier 6 :** provenance/confirmation des contraintes, scénario durable versionné et restauration, schéma canonique, illustration liée et écarts contrôlés, puis cas pilote mesuré accepté. Ces tests simulés ne prouvent pas la qualité des questions du modèle ; le dialogue réel et l’acceptation restent ouverts.

Sept chantiers : 1 en cours ; 2 code prêt ; 3 en cours ; 4 en cours ; 5 en cours ; **6 en cours** ; 7 en cours.
