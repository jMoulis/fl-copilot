# M7 — inventaire physique depuis le copilote (20 octobre 2026)

## Parcours livré par le code

Ce lot prolonge l’inventaire manuel PR 303, fusionné en `f1277ea` après réussite des CI push `39442465565` et PR `39442476808` sur `4f168dc` (3 360 tests passés / 6 ignorés). Il réutilise son moteur, la lecture du plan courant, l’outil `store_layout_edit_preview`, la carte de comparaison et la confirmation SQLite/historique/Outbox existants. Aucun autre agent, nouveau dépôt d’écriture, migration, module natif ou fournisseur.

L’outil prépare désormais, sur une demande physique explicite : ajout d’un îlot vide, d’un élément fixe à un rang libre, d’une TG et de ses surfaces déclarées ; copie d’un îlot ou meuble ; retrait d’un îlot, meuble ou surface de TG. Les opérations de dimensions/position, noms et mobiles restent compatibles. Les deux surfaces obligatoires d’un fixe et celle d’un mobile ne sont pas retirables isolément. Un retrait conserve les mobiles associés, détachés. Une copie ne duplique pas les mobiles associés et ne reprend ni coordonnées, orientation, capacité, ni statut de mesure relevée. La reprise des dimensions est un choix explicite ; une composition de TG n’est jamais devinée. Les trois TG physiques ne deviennent pas quatre à partir des idées d’un PDF.

L’API attribue les identités nouvelles lors de la préparation, les conserve dans la carte privée et le moteur les réutilise exactement lors de la confirmation. Ni le modèle ni la confirmation locale ne les régénèrent. La séquence est bornée, unique et consommée entièrement ; identités manquantes, supplémentaires, dupliquées ou déjà présentes refusées. La limite permet les copies compatibles avec les bornes du plan existant ; aucun inventaire n’est tronqué. Les cartes historiques `ADD_MOBILE` avec leurs deux identités restent lisibles sans changement.

Le client annonce `x-copilot-layout-inventory: 1` seulement avec `x-copilot-layout-edits: 1`. L’API n’expose les nouvelles variantes que dans ce cas ; les anciens clients conservent le schéma et les opérations précédentes. Les messages restent des artefacts privés dans le transport de chat existant. Un ancien binaire peut conserver une nouvelle carte dans son historique synchronisé, mais ne sait pas la confirmer ; il ne l’interprète jamais comme une opération ancienne. L’en-tête n’accorde aucun droit d’écriture : la confirmation recontrôle rôle, magasin, parent privé, état de discussion et révision canonique.

Préparer ou ouvrir la comparaison n’enregistre rien. La confirmation crée uniquement un **brouillon** ; adoption de la référence, allocation commerciale, image et réalisation terrain restent distinctes. Une référence modifiée exige une nouvelle proposition ; l’ancienne version n’est pas écrasée. Le texte de l’outil est adapté à sa capacité, sans ajout d’une couche d’instructions globale.

## Vérifications et portée

- Moteur/contrats : chacune des créations et copies, séquence d’identités stable, rang libre/occupé, champs d’autorité interdits, retrait/désassociation et protection des surfaces obligatoires. Une copie de TG à 176 surfaces garde sa carte privée sous la limite de 16 000 caractères sans tronquer la structure.
- SQLite avec fichier : ajout fixe, copie et retrait d’îlot, ouverture sans écriture, refus de rôle et annulation, conservation de la référence, une seule commande/historique/résultat, fermeture réelle et reprise sans doublon.
- SDK installé, transport simulé : ajouts/copie/retrait via le véritable catalogue d’outils et schéma objet, ancien schéma sans nouvelles actions, autres garanties antérieures de confidentialité, révision et budget conservées. Aucun appel fournisseur.
- Mongo transactionnel jetable : conservation atomique/rejeu de cartes mobile/copie/retrait et refus de source étrangère. Nouveau parcours complet Mongo/chat → restauration SQLite A → confirmation → Outbox/Mongo → restauration SQLite B, historique et identités exacts. Le journal garde une commande accusée, sans commande active ; il n’est pas supprimé lors de l’accusé. Aucune donnée de vente/casse/produit/plan commercial créée.

Contrôle local complet : **2 790 tests passés / 594 ignorés** sans services externes, dix projets TypeScript, lint et structure. Après ajout de deux contrôles de capacité, **47 tests ciblés dans quatre fichiers** passent, ainsi que **9 cas SDK** et **15 cas Mongo transactionnels distincts** (10 de synchronisation canonique, 5 de carte/confirmation). Le build et l’import du véritable bundle API passent. Les exports Hermes iOS/Android passent également. Les deux CI du commit final restent nécessaires avant fusion. La recette iPhone/Android, le comportement du modèle réel et l’adoption du plan en rayon ne sont pas prouvés par les fixtures ou le SDK simulé.

## Livraison et portes ouvertes

Dernière livraison connue : API et iOS 0.1.0 (4), source `9c2f66b`. PR 302 et PR 303 ne sont pas dans ce binaire ; le présent lot n’est pas déployé. API compatible avant prochain binaire groupé ; aucun EAS payant isolé. Aucun `.env`, réglage système, compte fournisseur ou jeu de données réel modifié.

**M7 : 1, 3, 4, 5, 6, 7 en cours ; 2 code prêt.** Ce lot fait avancer 1 (parité des opérations manuelles) et 6 (implantation). La validation native du chantier 7 reste ouverte. Manipulation géométrique directe, illustration liée à une révision/scénario, activation et budget fournisseur, mesures du pilote, autres critères V1/M8 restent requis. Aucun CRUD complet, chantier entier ni V1 n’est déclaré terminé.
