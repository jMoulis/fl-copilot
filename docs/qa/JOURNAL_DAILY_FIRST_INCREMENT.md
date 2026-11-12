# Journal quotidien — premier incrément natif

## Périmètre

Direction visuelle validée le 12 novembre à partir de la maquette interactive : carte météo dominante, températures, conditions visuelles, journées sélectionnables, calendrier discret, observations et accès à Ma semaine. Le journal complet reste un chantier produit après M8 ; cet incrément ne prétend pas intégrer tous les facteurs conjoncturels.

Le nouvel onglet réutilise les réglages magasin, `weekly_context_cache`, les observations produit et leurs parcours de capture/synchronisation. Pas de migration ou collection supplémentaire. La lecture quotidienne des observations joint uniquement les libellés nécessaires, avec quatre résultats au maximum et un lien vers l’historique. Les événements d’origine documentaire ne deviennent pas des déclarations terrain.

Le détail météo/calendrier utilise le volet natif existant, fermable par glissement. Ma semaine ouvre la préparation canonique de la semaine sélectionnée. L’analyse prépare une nouvelle discussion avec un brouillon : aucun message n’est envoyé et aucun appel IA n’est déclenché par ce bouton.

## Données et compatibilité

- Les chiffres restent ceux des outils d’analyse existants. Aucune météo ou valeur de démonstration n’est insérée dans le magasin.
- Les conditions proviennent du `summary.symbol_code` MET Norway. Leur fenêtre est conservée, limitée au jour parisien et choisie au plus près de midi parmi les points disponibles. Ce n’est pas une synthèse calculée de la journée. L’heure figure dans la carte, la fenêtre complète dans le détail.
- Les extrema sont indicatifs sur les points disponibles ; la pluie n’est affichée que pour une journée entièrement couverte. Zéro reste distinct d’une donnée absente. Sans symbole, une icône neutre remplace le ciel supposé : zéro pluie ne prouve pas le soleil.
- Les anciennes prévisions restent marquées comme prévisions archivées, jamais observations rétrospectives. La météo observée Météo-France du dossier de recherche n’est pas encore intégrée à l’application.
- `x-context-weather-symbols: 1` demande le champ optionnel `symbol` du contrat existant. Sans cette capacité, le service conserve la forme antérieure. Le client accepte les réponses de l’ancienne API et les caches locaux sans symbole.
- Le journal rend le cache local avant une éventuelle actualisation. Il conserve ce cache si le réseau échoue et espace les tentatives automatiques d’au moins quinze minutes par semaine/contexte, uniquement pendant le focus. Le cache fournisseur distant existant continue de gérer ses expirations. Pas de collecteur récurrent ou requête IA à l’ouverture.
- Une réponse tardive d’un autre magasin ou d’une autre semaine ne remplace ni l’affichage courant ni son cache. Un changement des réglages invalide le contexte correspondant comme auparavant.
- Les vacances gardent la date de reprise exclusive et le départ après la classe. Une source indisponible ou ancienne ne permet pas d’affirmer « hors vacances ».

Documentation fournisseur consultée : https://api.met.no/weatherapi/locationforecast/2.0/documentation ; symboles décrits dans le format JSON, avec variantes jour/nuit.

## Vérifications

Tests ciblés : négociation autorisée de la réponse API, compatibilité du client avec l’ancien format, fenêtres météo et minuit parisien, pluie manquante/zéro, calendrier scolaire et reprise, lecture SQLite des observations pendant le passage à l’heure d’hiver, absence d’écriture, maintien du cache hors connexion, absence de boucle sur cent rendus, rejet d’une réponse tardive d’un autre magasin.

La validation native reste à faire sur le binaire regroupant ce lot. Une compilation ou un test de composant ne vaut pas validation sur iPhone.

## Recette iPhone à prévoir

1. Journal : vérifier la carte du magasin, sélectionner un autre jour/semaine et revenir à aujourd’hui. Ouvrir la source dans le volet et le fermer par glissement.
2. Passer hors connexion après une première récupération : le contenu connu reste lisible. Une actualisation échouée ne doit pas faire disparaître les observations.
3. Noter une observation produit passée : la date sélectionnée est proposée, l’heure passée reste à renseigner ; enregistrer puis revenir au journal et à son historique. Vérifier une journée où une rupture chevauche plusieurs dates.
4. Ouvrir Ma semaine : retrouver la semaine choisie et les tâches existantes. Revenir au journal sans perdre le jour consulté.
5. Analyser la journée : retrouver la date dans un brouillon du copilote. Rien n’est envoyé avant l’appui explicite sur Envoyer.

## Suite explicitement ouverte

Les notes générales de magasin (accès, horaires, livraison non rattachée à un produit), les signaux locaux à confirmer et le contexte économique mensuel demandent encore leur capture et leurs contrats métier. Ils ne sont pas simulés dans l’application ni forcés dans des ruptures produit. Les sources statistiques et historiques restent dans le dossier de recherche tant que leur intégration n’est pas qualifiée.
