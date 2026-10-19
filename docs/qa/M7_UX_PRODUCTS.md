# M7 UX — catalogue consultable et édition protégée

## Périmètre

Suite L5 de l’UX arbitrée le 19 octobre. La liste Produits devient une liste native virtualisée, recherchable hors connexion par libellé, alias validé ou code validé, avec filtres cumulables catégorie/nature/état. Un code conserve ses zéros initiaux. Les alias refusés/proposés ne deviennent pas des identités approuvées. Les fiches incomplètes restent consultables ; le filtre « à compléter » n’impose pas leur correction pour traiter la casse.

Recherche, filtres et défilement sont privés à l’utilisateur et au magasin, conservés dans `app_metadata` existant. Les écritures de présentation sont temporisées, sans Outbox ni synchronisation de cette préférence. Les erreurs conservent les données affichées. La liste est relue au retour du détail et lors des changements de synchronisation.

`products/[id]` consulte maintenant la fiche ; « Modifier la fiche » ouvre `products/edit/[id]`. `products/new` reste l’entrée de création. Les chemins existants depuis le chat, les priorités et les substitutions continuent d’ouvrir le même produit. Codes/alias, analyse contextualisée, observations, remplaçants, besoins et associations restent accessibles. Les relations complexes ne sont dépliées qu’à la demande. Aucun chiffre ou média produit fictif n’est introduit.

## Protection des saisies

- Une lecture de synchronisation ne réinitialise plus le formulaire en cours. La base d’édition reste celle effectivement ouverte.
- Retours, remplacements de route et gestes retirant l’éditeur passent par `usePreventRemove`, fourni par l’Expo Router installé. Continuer la saisie est le choix non destructif. Les onglets qui conservent l’écran monté conservent sa saisie ; ils ne nécessitent pas d’abandonner le formulaire.
- L’enregistrement en cours interdit une sortie destructive. Une fermeture du processus avant enregistrement ne constitue pas une sauvegarde de brouillon : aucune persistance automatique de formulaire non enregistré n’est promise.
- Une fiche modifiée ou retirée pendant la saisie ne fait pas disparaître les champs. Une nouvelle lecture est explicite, avec confirmation si elle remplace une saisie non enregistrée. Un conflit connu bloque l’enregistrement.
- L’enregistrement manuel relit et compare la fiche canonique dans la même transaction exclusive que les écritures produit/codes/alias/Outbox et le travail de recalcul. Il conserve la politique de versions, les statuts d’alias et les identifiants existants. Un simple acquittement de synchronisation sans changement canonique n’invalide pas le formulaire. Un EAN déjà porté par un autre produit n’est pas déplacé.
- L’adaptateur de transaction déjà employé par les outils du copilote est réutilisé depuis le module commun de mutation ; pas de transaction SQLite imbriquée ni de deuxième protocole de synchronisation.

## Preuves locales

- Tests SQLite : changement canonique refusé sans commande supplémentaire, acquittement accepté, EAN concurrent refusé, cible étrangère/supprimée et conflit refusés, annulation totale sur erreur tardive d’écriture, recalcul des dates existantes mis en attente.
- Tests catalogue : recherche accentuée/alias/code, filtres cumulés, 5 100 résultats sans troncature, restauration d’une recherche et d’un offset après fermeture/réouverture SQLite, séparation magasin/utilisateur et absence d’Outbox.
- Suite locale `pnpm check` : 2 199 tests passés, 496 cas dépendant d’environnements externes ignorés. Ces derniers ne sont pas annoncés validés localement. CI exacte requise avant fusion.
- Compilation API et exports Hermes iOS/Android requis sur cette tranche.
- Vérification du composant réel `CatalogueList` dans son rendu web à 390 px : liste, filtre Fruit (3/6), recherche littérale `00001234` avec maintien des filtres (0/6), remise à zéro des seuls filtres (Butternut, 1/6). Aucune erreur console constatée. Six produits de test explicitement identifiés ; pas de données de production. Le harnais local a été retiré avant les contrôles finaux. Captures dans l’espace de travail : `artifacts/products-ux/`.

## Acceptation restant ouverte

Ces captures ne prouvent ni les gestes UIKit/Android, ni l’enregistrement depuis un binaire installé, ni la synchronisation distante. Valider dans la prochaine livraison groupée : liste → fiche → modifier → retour/abandon ou maintien → enregistrement → retour liste avec contexte, onglets, clavier, VoiceOver/TalkBack et taille de texte, évolution distante/conflit/suppression pendant la saisie. Mesurer le catalogue réel sur téléphone. Une liste modifiée peut naturellement changer l’article visible au même offset.

La bibliothèque visuelle produit, les filtres de famille, l’UX des autres écrans L5, le transport compact des longues sources du chat et les autres critères M7/M8 restent ouverts. Aucun schéma de données, dépendance native, appel IA, déploiement API ou build EAS payant n’est ajouté par ce lot. Code fusionné reste distinct de code livré et validé.
