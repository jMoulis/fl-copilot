# SDK 57 — préparation de la recette native groupée

Le contrôle de compatibilité Expo avant la soumission EAS signale onze dépendances directes en retard sur les correctifs recommandés du SDK 57. Aucun build payant n’a été lancé sur cette source provisoire.

## Modification

Alignement des onze plages Expo et du verrou pnpm, sans changement de SDK majeur, React Native, modèle IA ou outil système. `@expo/metro-runtime` devient explicite en `~57.0.17` : le routeur installé `57.0.29` exige le pair `^57.0.17`, alors que l’ancien graphe fournissait `57.0.16`. SQLite passe à `57.0.4`. Les re-clés de pairs et dépendances du verrou suivent ce même graphe Expo ; le paquet npm `xcode` n’est pas une modification du Xcode du Mac.

## Vérifications locales

- `CI=1 EXPO_NO_CACHE=1 EXPO_NO_TELEMETRY=1 pnpm exec expo install --check` depuis l’application : « Dependencies are up to date », code 0. `EXPO_NO_CACHE` évite uniquement une écriture refusée dans le cache du domicile ; aucun droit ou mécanisme de protection n’est modifié.
- `pnpm check` : structure, lint, dix projets TypeScript ; 4 471 tests passent, 727 ignorés. Les scénarios transactionnels Mongo sont exécutés séparément dans les CI.
- Export Expo Android et iOS : deux bundles Hermes produits.
- Format, build, deux CI exactes puis CI master : à consigner après leur résultat réel.

Aucun test artificiel ajouté pour reproduire le manifeste. Les tests métier et exports existants sont conservés. Cette préparation ne démontre ni un build cloud réussi, ni l’installation ou les performances physiques.

## Livraison et périmètre

La source native finale doit inclure la PR 375 et cet alignement, après contrôles push/PR/master. L’activation API 375 est livrée séparément depuis son propre commit contrôlé ; cet alignement mobile seul ne justifie pas un déploiement API supplémentaire.

Un seul build iOS groupé est prévu avec les améliorations de chat, documents, Mercalys et récupération visuelle en attente. La migration SQLite 61 est incompatible avec un retour au binaire 15/schema 60 : conserver l’application et ses données, puis corriger avec une version compatible. Aucun effacement ni réinstallation vierge demandé. L’API 374 reste le minimum compatible avec les choix issus d’originaux.

Sept chantiers M7 : 1/3/4/5/6/7 en cours, 2 code prêt. Les portes humaines et V1/M8 restent ouvertes.
