# M7/M8 — reprise des conflits de visuels, 24 octobre 2026

## Vérification du diagnostic

Neuf attentes ont été testées avant correction sur SQLite jetable. Six défauts sont confirmés, pour les trois familles `visual_asset`, `visual_identity` et `product_visual_link` : un groupe complet de plusieurs conflits était bloqué ; l’identité du corps d’une commande pouvait être ignorée avant sa supersession. Sources et résultats initiaux sont conservés séparément, sans donnée de production.

Les trois autres attentes reposaient sur une mauvaise interprétation de `remote_version`. **Cette colonne est la base déjà acquittée**, volontairement conservée pendant qu’un pull met à jour une copie distante plus récente et que des modifications locales restent en attente. Exiger son égalité avec la version du cache aurait bloqué une reprise légitime. La politique et `applyVisualEntity` restent inchangés. Trois tests positifs vérifient un vrai pull plus récent, la base acquittée conservée et la comparaison explicite ; ils ne présentent pas ce fonctionnement comme une corruption.

## Comparaison et écriture canoniques

`VisualConflictRepository.review/resolve` utilise le groupe OPEN complet, sa dernière version typée vérifiée, la copie reçue par pull et les commandes du même élément/acteur. Toutes les copies distantes et les corps de commandes passent leur schéma et leur identité canonique : magasin/UUID, clé de contenu ou produit associé, acteur et enveloppe de version. Une contradiction, un envoi actif, une copie étrangère ou une limite dépassée bloque les choix. L’empreinte inclut le groupe, les commandes et les parents effectivement examinés. Une copie reçue après l’affichage impose une nouvelle comparaison.

La résolution ferme exactement les conflits examinés. L’historique visuel existant conserve le choix local actuel, la base distante réellement retenue, le résultat et les anciens paquets, sans faux ACK. Conserver le local réutilise `rebaseVisualChoice` et le writer de bibliothèque ; adopter le synchronisé ne crée aucun nouvel envoi. La version distante devient la précondition exacte, avec UUID stables et commande rejouable.

Les règles antérieures restent en place : provenance/attribution d’origine, métadonnées binaires immuables, compatibilité des sources, parents et produits disponibles, copie créée simultanément sur un autre appareil, retrait et suppression. Une réactivation requiert son consentement séparé ; conserver une photo ajoutée par le magasin requiert la confirmation des droits. Les travaux en attente d’un autre acteur ne sont pas absorbés. Les contrôles de contexte, d’identité d’acteur/appareil et d’annulation sont répétés après la revue et avant commit. Un refus ou un échec de commit annule toute la transaction.

Aucun original ni fichier non synchronisé n’est supprimé. Seuls les travaux de transfert déjà concernés par le retrait de cet élément suivent leur annulation existante, bornée au magasin/acteur/asset. Aucun modèle, recherche d’image, dépense, permission, migration ou contrat de transport ajouté.

## Écran natif

Le parcours conserve les résumés, les aperçus locaux facultatifs et les trois consentements distincts : comparaison, réactivation et droits. Il réutilise le hook de revue commun au lieu d’une seconde gestion de durée de vie. Compte, magasin, rôle responsable, appareil, SQLite, cible, focus et fermeture bornent les écritures tardives. Changer de côté ou relire efface les consentements précédents ; une erreur interdit de confirmer l’ancienne comparaison. Les groupes deviennent lisibles et une relecture reste accessible après une erreur.

Une photo absente reste un état de lecture explicite ; elle ne détruit pas la métadonnée ni la source. Aucun téléchargement ou génération n’est déclenché par l’ouverture de cette comparaison. Un échec d’envoi après commit ne devient pas un faux échec d’enregistrement local.

## Preuves et livraison

Les trois suites concernées comptent **104 cas** : **48** revues de groupe et écritures, **44** montages natifs spécifiques et **12** cas antérieurs du repository. Elles vérifient les six défauts confirmés, les deux choix/groupe/pull plus récent, les contradictions et limites, les bases acquittées conservées, les annulations/changements d’acteur/appareil après écriture, le rollback, les droits/réactivations, la relecture, les callbacks périmés, les changements de contexte, les aperçus manquants et l’envoi échoué.

Six scénarios Mongo transactionnels sont ajoutés à la CI : trois familles × deux choix, deux vrais résultats CONFLICT, nouvelle révision reçue par pull, choix natif, précondition canonique, historique/rejeu sans doublon, restauration des métadonnées sur une troisième SQLite puis réouverture hors ligne. Les identités et attributions sont conservées. Cette preuve porte sur les métadonnées ; elle ne prouve ni un transfert réel d’image sur téléphone ni une recette physique.

**`pnpm check` passe : 3 992 tests / 674 ignorés selon l’environnement**, lint/structure et dix projets TypeScript. Format/diff et les deux CI du commit final, build API et exports iOS/Android restent requis avant fusion. PR 352 fusionnée après deux CI exactes vertes (**4 562 / 6**). PR 345–352 et ce complément restent hors build 14, à livrer dans un lot natif substantiel. API compatible inchangée ; aucun EAS payant ni déploiement API propre.

M7 : 1 Actions/conflits en cours ; 2 Contre-promotion code prêt ; 3 Documents, 4 Expertise, 5 Recommandations, 6 Implantation et 7 UX/validation en cours. Parité globale, recette sur appareil et portes V1/M8 restent ouvertes.
