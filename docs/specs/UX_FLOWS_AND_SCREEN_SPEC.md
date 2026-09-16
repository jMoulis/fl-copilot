# UX Flows & Screen Specification — Native Offline-First Expo

**Product:** Fruits & Vegetables Copilot  
**Document:** `UX_FLOWS_AND_SCREEN_SPEC.md`  
**Version:** 1.0  
**Date:** 16 September 2026  
**Specification language:** English  
**Application language:** French (`fr-FR`)  
**Primary client:** React Native + Expo  
**Architecture:** Native offline-first / local-first  
**Audience:** Product designer, React Native developer, AI development agent, QA  
**Status:** Canonical UX and screen behavior specification.

---

# 1. Purpose

This document defines the native mobile user experience for the Fruits & Vegetables Copilot.

It translates the existing functional, technical, database and synchronization specifications into:

- native navigation;
- screen hierarchy;
- page sections;
- interaction flows;
- local-first behavior;
- offline states;
- synchronization states;
- conflict states;
- AI-processing states;
- validation workflows;
- native camera and file-import flows;
- recommendation decisions;
- execution tracking;
- accessibility expectations;
- loading, empty and failure states.

The application is designed primarily for a department manager using a phone while working on the shop floor.

---

# 2. UX product principles

## 2.1 Operational before analytical

The application must first answer:

```text
What needs my attention?
What do I need to do?
What happened?
Why?
```

Do not force the user through analytical dashboards before reaching actionable information.

## 2.2 Maximum three primary priorities

`Aujourd’hui` and `Ma semaine` show no more than three main priorities.

Additional signals remain accessible below or in detail screens.

## 2.3 Offline-first interaction

The user can perform normal field work without waiting for network connectivity.

Local persistence must be immediate.

## 2.4 Explicit trust states

The UX must make distinctions visible when they matter:

```text
Local
À synchroniser
Synchronisé
Conflit
Analyse IA en attente
Données anciennes
Données incomplètes
```

## 2.5 Facts before recommendation

Recommendations must expose:

```text
Faits
Lecture
Action proposée
Confiance
À mesurer
```

## 2.6 AI must never visually impersonate enseigne instructions

Always distinguish:

```text
Instruction enseigne
Observation magasin
Recommandation IA
```

## 2.7 Fast one-handed use

Common field actions should require few taps and large touch targets.

---

# 3. Primary navigation

Use native bottom tab navigation.

Tabs:

```text
Aujourd’hui
Ma semaine
Analyses
Casse
Plus
```

Recommended icons:

```text
Aujourd’hui → home / pulse
Ma semaine → calendar
Analyses → chart
Casse → camera / broken-box
Plus → menu
```

Tab labels must always remain visible.

---

# 4. Native navigation hierarchy

```text
Root
├── Auth
│   ├── Connexion
│   └── Code de vérification
│
├── Tabs
│   ├── Aujourd’hui
│   ├── Ma semaine
│   ├── Analyses
│   ├── Casse
│   └── Plus
│
├── Product stack
│   └── Fiche produit
│
├── Commercial stack
│   ├── Opération
│   ├── Offre
│   └── Source commerciale
│
├── Waste stack
│   ├── Capture ticket
│   ├── Validation ticket
│   └── Historique ticket
│
├── Import stack
│   ├── Nouvel import
│   ├── Validation import
│   └── Réconciliation
│
├── Recommendation stack
│   ├── Recommandation
│   ├── Décision
│   └── Bilan action
│
├── Sync stack
│   ├── Synchronisation
│   └── Conflit
│
└── Settings
```

---

# 5. Global app shell

Every authenticated tab screen contains:

- native safe-area handling;
- screen title;
- optional date/period context;
- compact synchronization indicator;
- scrollable primary content;
- bottom tab bar.

Avoid permanent large top toolbars.

---

# 6. Global synchronization indicator

A small indicator appears in the header when state is not fully synchronized.

States:

```text
Synchronisé
Hors connexion
3 à synchroniser
Synchronisation…
1 conflit
Erreur de synchronisation
```

Tapping opens:

```text
Plus > Synchronisation
```

Do not show a large persistent banner when everything is healthy.

---

# 7. Global offline banner

When network is unavailable:

French UI:

```text
Hors connexion
Vous pouvez continuer à travailler. Les changements seront synchronisés plus tard.
```

Behavior:

- compact;
- dismissible for current session;
- reappears if a remote-only action is attempted;
- does not block screen interaction.

---

# 8. Global stale-data pattern

Stale data is domain-specific.

Example:

```text
Données du 15 septembre
Dernière synchronisation : 16 septembre à 07:32
```

Do not mark historical values as “stale” simply because the phone is offline.

---

# 9. Sync-state badges

Use compact status badges:

```text
Local
À synchroniser
Envoi en cours
Synchronisé
À vérifier
Conflit
Analyse IA en attente
Analyse IA en cours
```

Status must use icon + text, not color only.

---

# 10. Global pull-to-refresh

Primary tabs support pull-to-refresh.

If online:

```text
push pending commands
→ pull remote changes
→ local screen updates
```

If offline:

show:

```text
Toujours hors connexion
Les données locales restent disponibles.
```

Do not clear or replace screen contents.

---

# 11. App startup flow

```text
Launch
  ↓
Open local SQLite
  ↓
Read local authenticated device state
  ↓
Render cached/local screen
  ↓
Attempt token refresh if needed and possible
  ↓
Start sync if connectivity available
```

The user must not wait for remote refresh before seeing previously synchronized business data.

---

# 12. First-use startup

If no local data exists:

```text
Authentication
→ initial bootstrap
→ local DB population
→ Aujourd’hui
```

Display bootstrap progress:

```text
Préparation de votre magasin
Produits
Historique
Plan commercial
Recommandations
```

Do not expose implementation details such as “sync cursor”.

---

# 13. Login screen — `Connexion`

Fields:

```text
Adresse e-mail
```

Primary action:

```text
Recevoir un code
```

Support text:

```text
Un code de connexion vous sera envoyé par e-mail.
```

States:

- normal;
- sending;
- invalid email;
- network unavailable;
- rate limited.

---

# 14. Verification screen — `Code de vérification`

Six-digit code input.

Actions:

```text
Se connecter
Renvoyer le code
Changer d’adresse e-mail
```

A new login requires connectivity.

---

# 15. Offline authenticated startup

If the device was previously authenticated and local session permits offline open:

show local application.

Header sync state:

```text
Hors connexion
```

Do not request login merely because refresh service is unreachable.

---

# 16. Tab 1 — `Aujourd’hui`

Purpose:

> Give the manager the latest operational picture and at most three actions worth attention.

---

# 17. `Aujourd’hui` information hierarchy

Top to bottom:

```text
1. Business date / freshness
2. Core KPI cards
3. Three priorities maximum
4. Main movements
5. Current tensions / store events
6. Context
7. Data quality / unresolved issues if relevant
```

---

# 18. Business date header

Display:

```text
Aujourd’hui
Journée analysée : 15 septembre
```

or:

```text
Dernière journée complète : 15 septembre
```

Never display:

```text
Hier
```

unless that date is actually the latest complete business day.

---

# 19. Core KPI cards

Primary cards:

```text
Ventes
Marge
Casse
```

Each may display:

- current value;
- comparison value or variation;
- local/confirmed marker only when materially relevant.

Example:

```text
Ventes
4 830 €
+6,2 % vs J-7
```

---

# 20. KPI card missing-reference state

Example:

```text
Ventes
4 830 €

Comparaison indisponible
```

Never show `0 %` when reference is missing.

---

# 21. KPI local-only state

After offline local Mercalys import:

```text
Ventes
4 830 €

Calcul local
Synchronisation en attente
```

Use subtle badge:

```text
Local
```

Do not visually imply that the number is unreliable merely because it is local.

---

# 22. Today priorities section

Title:

```text
Priorités
```

Maximum:

```text
3
```

Card anatomy:

```text
Priority rank
Short title
Why now
One/two key facts
Recommended action
Confidence
Status
```

Example:

```text
1
Vérifier la maturité des avocats

Casse : 46 €
+70 % vs référence

Action proposée
Contrôler le stock et la maturité aujourd’hui.

Confiance : Élevée
```

---

# 23. Recommendation source badge

Each recommendation card is explicitly labeled:

```text
Recommandation IA
```

Store/enseigne items use different badges:

```text
Instruction enseigne
Observation magasin
```

---

# 24. Recommendation card actions

Tap card → detail.

Quick actions only if safe:

```text
Accepter
Reporter
```

`Modifier` and `Refuser` can be inside detail or bottom sheet.

Do not overload cards with four equal buttons on small screens.

---

# 25. Recommendation stale state

If recommendation becomes stale:

```text
À recalculer
Cette recommandation repose sur des données qui ont changé.
```

Actions:

```text
Voir les changements
Recalculer
```

If offline:

```text
Recalcul disponible à la reconnexion
```

---

# 26. Main movements section

Title:

```text
Mouvements clés
```

Rows may include:

```text
Banane +186 € de contribution aux ventes
Avocat -94 €
Tomate +31 € de casse
```

Tapping opens product.

Rank absolute economic impact ahead of sensational percentages.

---

# 27. Current tensions section

Title:

```text
Tensions magasin
```

Rows:

```text
Tomate ronde — Rupture
Salade — Stock faible
Poivron — Problème qualité
```

Each row includes start time/date and sync status if local.

Tap → product sheet/event detail.

---

# 28. Quick `Signaler` action

Accessible from Today and Product screens.

Bottom sheet:

```text
Signaler

Tension
Stock faible
Rupture
Problème qualité
Hausse de prix
Problème fournisseur
```

After selection:

- product if not already scoped;
- start date/time default now;
- optional severity;
- optional note.

Primary:

```text
Enregistrer
```

Offline success:

```text
Observation enregistrée
Synchronisation en attente
```

---

# 29. Today context section

Possible cards:

```text
Météo
Jour férié
Vacances scolaires
Événement magasin
Tension marché
```

Never imply causality.

---

# 30. Today data-quality alert

Only surface if actionable/material.

Example:

```text
Données à vérifier

18 % de la casse n’a pas de coût d’achat fiable.
```

Action:

```text
Voir
```

---

# 31. Today empty state

If no business observations yet:

```text
Aucune journée analysable

Importez les ventes Mercalys pour commencer.
```

Primary:

```text
Importer les ventes
```

Secondary:

```text
Voir les imports
```

---

# 32. Tab 2 — `Ma semaine`

Purpose:

> Prepare and execute commercial work across current and future weeks.

---

# 33. Week selector

Top horizontal control:

```text
Semaine actuelle
S+1
S+2
```

or date labels:

```text
14–20 sept.
21–27 sept.
28 sept.–4 oct.
```

Manual calendar selection available from header.

---

# 34. Weekly screen information hierarchy

Recommended sections:

```text
Priorités
À ne pas manquer
Opérations
À commander / précommander
TG & mises en avant
Tensions marché
Substituts
Météo & calendrier
À vérifier
```

Sections with no content may be hidden.

---

# 35. Weekly priorities

Maximum three.

Examples:

```text
Précommande à clôturer aujourd’hui
Préparer la Turino comme substitut
Vérifier le paramétrage Storeline
```

Deadline urgency may place an operational task above a larger analytical opportunity.

---

# 36. `À ne pas manquer`

Chronological deadline list.

Rows:

```text
Aujourd’hui
Précommande Automne

Demain
Installer TG Crudités

Vendredi
Vérifier prix / PLU
```

Urgency styles:

```text
En retard
Aujourd’hui
Dans 24 h
Dans 3 jours
Plus tard
```

---

# 37. Weekly operation card

Card displays:

```text
Operation name
Operation type
Product/theme
Sales dates
Mechanism
Applicability
Planning/execution status
```

Example:

```text
Prospectus
Tomate côtelée

29 sept. → 3 oct.
20 % avantage carte

Planifiée
```

Tap → Operation detail.

---

# 38. Commercial mechanism display

Preserve exact semantics.

Examples:

```text
2,99 €/kg
< 2,60 €/kg
2,99 €/kg à partir de 1 kg
20 % avantage carte
Lot de 3
```

Never simplify these to a generic “promo”.

---

# 39. Applicability badge

```text
À confirmer
Applicable
Non applicable
```

If `À confirmer`, operation detail prioritizes applicability review.

---

# 40. Operation detail screen

Sections:

```text
Résumé
Période
Offres
Précommande
Livraison
Instructions
TG & merchandising
Communication
Tensions marché
Substituts
Exécution
Source
```

---

# 41. Operation status

French states:

```text
Reçu
Validé
Planifié
Réalisé
Annulé
```

Display source state separately from actual execution.

---

# 42. Operation action bar

Depending on status:

```text
Valider
Planifier
Marquer réalisé
Annuler
```

Do not offer invalid transitions.

---

# 43. Execution checklist

Rows:

```text
Prix vérifié
PLU vérifié
Storeline configuré
Drive activé
TG installée
PLV installée
```

States:

```text
À faire
Fait
Ignoré
Non applicable
```

Offline changes persist immediately.

---

# 44. Partial execution

If some tasks are incomplete:

```text
Exécution partielle
3 / 5 actions réalisées
```

Do not collapse to generic “Réalisé”.

---

# 45. Weekly market tension card

Example:

```text
Tension marché
Tomate ronde

Disponibilité limitée
Sévérité : élevée

Source : communication semaine 38
```

CTA:

```text
Voir les substituts
```

---

# 46. Weekly substitute strategy card

Example:

```text
Tomate ronde

Substitut recommandé
Tomate Turino

Relation : forte
Confiance : moyenne

Action
Prévoir une meilleure visibilité si la tension se confirme.
```

---

# 47. Weather section

Show only available forecast horizon.

Example:

```text
Mardi
24° / 14°
Faible pluie
```

Beyond horizon:

```text
Météo pas encore disponible
```

---

# 48. Week offline state

Previously synchronized plan remains fully visible.

Local checklist changes remain editable.

Remote-only extraction state:

```text
Nouveau PDF enregistré
Analyse en attente de connexion
```

---

# 49. Tab 3 — `Analyses`

Purpose:

> Explore performance beyond the immediate Today/Week action view.

---

# 50. Analysis landing screen

Cards:

```text
Produits
Catégories
Familles
Casse
Promotions
Substitution
Opérations
```

Optional period selector at top.

---

# 51. Period selector

Options:

```text
7 jours
28 jours
Semaine
Personnalisé
```

Comparison control:

```text
J-7
Semaine comparable
Moyenne jours comparables
N-1
Avant opération
```

Unavailable choices appear disabled with reason.

---

# 52. Product analysis list

Rows:

```text
Product
Sales
Variation
Waste
Contribution
```

Default ranking should favor meaningful economic contribution, not percentage only.

Tap → Product sheet.

---

# 53. Analysis charts

Use mobile-friendly charts:

- one primary metric per chart;
- horizontal scroll only when necessary;
- large tap targets;
- clear missing-data breaks.

Do not overload one chart with all KPI families.

---

# 54. Chart event overlays

Allow markers for:

```text
Promotion
Rupture
Tension
Qualité
Action locale
```

Tap marker → event/operation detail.

---

# 55. Analysis offline behavior

Use local retained history.

If requested period exceeds local history:

```text
Cette période n’est pas disponible hors connexion sur cet appareil.
```

If online:

CTA:

```text
Charger l’historique
```

---

# 56. Tab 4 — `Casse`

Purpose:

> Capture, validate and understand waste quickly.

---

# 57. Casse screen hierarchy

```text
Primary capture CTA
Pending validation
Pending sync / AI
Recent waste
Potential duplicates
History
```

---

# 58. Primary waste CTA

Large native button:

```text
Prendre un ticket en photo
```

Secondary:

```text
Importer une photo
```

Optional:

```text
Saisir manuellement
```

only if later validated as useful.

---

# 59. Capture permission flow

First use:

```text
Autoriser l’appareil photo
```

Explain:

```text
L’appareil photo est utilisé pour lire les tickets de casse.
```

If denied:

```text
Importer une photo
Ouvrir les réglages
```

---

# 60. Camera screen

Elements:

- full camera preview;
- receipt framing guide;
- flash toggle if supported;
- large shutter button;
- cancel.

Instruction:

```text
Cadrez le ticket entier et évitez les reflets.
```

---

# 61. Capture review

Show captured image.

Actions:

```text
Utiliser cette photo
Reprendre
```

After confirm:

local receipt is immediately stored.

---

# 62. Offline capture success

If offline:

```text
Ticket enregistré

La photo est conservée sur cet appareil.
L’analyse IA démarrera dès que la connexion sera disponible.
```

Actions:

```text
Terminer
Ajouter la date de casse
```

---

# 63. Receipt processing states

Card states:

```text
À envoyer
Envoi en cours
Analyse IA en attente
Analyse IA en cours
À valider
Validé
Erreur
Doublon possible
```

---

# 64. Receipt validation screen

Layout:

```text
Source image
Receipt date
Extracted line list
Warnings
Total/control
Primary validation CTA
```

On small screen, image collapses into tappable preview.

---

# 65. Waste line row

Displays:

```text
Raw label
Matched product
Weight/quantity
Unit price
Total
Nature badge
Confidence/problem indicator
```

Example:

```text
TOMATE GRAPPE VRAC
Tomate grappe
0,580 kg × 4,99 €
2,89 €

Vrac
```

---

# 66. Ambiguous product row

Example:

```text
POIRE CONFERENCE VRA

Plusieurs produits possibles
```

CTA:

```text
Choisir le produit
```

---

# 67. Product match selection

Native search sheet:

- top suggested products;
- exact/alias reason;
- search field;
- product category/nature;
- confirm.

Action:

```text
Confirmer
```

Optional checkbox/secondary:

```text
Réutiliser ce libellé à l’avenir
```

only when alias creation is safe.

---

# 68. Repeated waste lines

Main validation list may group:

```text
FIGUE BIO BARQUETTE
8 lignes
47,12 €
```

Tap:

```text
Voir les 8 lignes
```

Raw occurrences remain accessible.

---

# 69. Arithmetic warning

Example:

```text
Montant à vérifier
0,580 kg × 4,99 € ne correspond pas au total détecté.
```

Fields become editable.

Do not auto-correct silently.

---

# 70. Waste date confirmation

If date absent/uncertain:

```text
Date de casse
```

must be selected before final validation.

Photo capture date is not automatically accepted as waste date.

---

# 71. Mixed bulk/packaged ticket

Each line shows nature:

```text
Vrac
Conditionné
À déterminer
```

Do not label whole receipt as one nature.

---

# 72. Ticket validation CTA

Primary:

```text
Valider la casse
```

Disabled only for blocking issues.

After local validation, local KPI can update immediately.

If still unsynchronized:

```text
Validé localement
Synchronisation en attente
```

---

# 73. Possible duplicate flow

Banner:

```text
Doublon possible

Un ticket similaire existe déjà.
```

Actions:

```text
Comparer
Conserver les deux
Marquer comme doublon
```

Do not auto-delete based only on same product/day.

---

# 74. Casse history

List filters:

```text
Tous
À valider
À synchroniser
Validés
Erreurs
```

Rows display:

- date;
- amount;
- line count;
- status.

---

# 75. Tab 5 — `Plus`

Menu:

```text
Imports
Documents commerciaux
Produits
Synchronisation
Notifications
Paramètres
À propos
Déconnexion
```

Optional advanced items may appear by role.

---

# 76. `Synchronisation` screen

Header status:

```text
Synchronisé
Hors connexion
Synchronisation requise
Conflit
```

Sections:

```text
Dernière synchronisation
Éléments en attente
Fichiers en attente
Analyses IA en attente
Conflits
Erreurs
```

---

# 77. Sync screen — healthy state

```text
Tout est synchronisé

Dernière synchronisation
Aujourd’hui à 12:41
```

CTA:

```text
Synchroniser maintenant
```

---

# 78. Pending state

Example:

```text
4 éléments en attente

2 observations magasin
1 ticket de casse
1 décision
```

CTA:

```text
Synchroniser
```

If offline:

```text
La synchronisation démarrera dès que la connexion reviendra.
```

---

# 79. Sync error state

Example:

```text
1 élément n’a pas pu être synchronisé
```

Actions:

```text
Réessayer
Examiner
```

Do not use generic technical error text as primary message.

---

# 80. Sync conflict list

Rows:

```text
Produit — Tomate Turino
Modification concurrente

Recommandation — Avocat
Décision concurrente
```

Tap → conflict detail.

---

# 81. Conflict detail screen

Layout:

```text
What changed
Your version
Synchronized version
Allowed actions
```

Example:

```text
Cette fiche produit a été modifiée sur un autre appareil.

Votre version
Conditionné

Version synchronisée
Vrac
```

Actions according to domain:

```text
Conserver ma version
Utiliser la version synchronisée
Fusionner
```

Never show unsafe resolution choices.

---

# 82. `Imports` screen

Categories:

```text
Ventes Mercalys
Casse Mercalys
```

Primary actions:

```text
Importer les ventes
Importer la casse
```

Recent imports list below.

---

# 83. Import status row

Displays:

```text
filename
source type
business period
record count
status
```

Statuses:

```text
Lecture locale
À valider
Publié localement
À synchroniser
Vérification distante
Vérifié
Réconciliation nécessaire
Erreur
```

---

# 84. New Mercalys import flow

```text
Choose XLSX
→ copy locally
→ detect format
→ parse locally
→ product matching
→ validation summary
→ publish locally
→ local KPI recompute
→ queue source upload
→ remote verification
```

---

# 85. Local import progress screen

Stages:

```text
Lecture du fichier
Identification des produits
Vérification des données
Calcul des indicateurs
```

Show counts as available.

Do not show low-level parser implementation details.

---

# 86. Import validation summary

Example:

```text
157 lignes détectées

154 prêtes
2 produits à confirmer
1 anomalie
```

Actions:

```text
Examiner les 3 éléments
Publier les lignes valides
Annuler l’import
```

---

# 87. Partial local publication

Example:

```text
154 lignes publiées localement
3 lignes restent à corriger
```

Local analytics clearly reflects partial coverage.

---

# 88. Import duplicate

Example:

```text
Ce fichier a déjà été importé.
```

Show prior import:

```text
15 avril 2024
Publié et vérifié
```

Actions:

```text
Voir l’import
Annuler
```

---

# 89. Overlapping import reconciliation

Screen:

```text
Réconciliation nécessaire

152 lignes inchangées
3 modifiées
2 nouvelles
1 absente
```

Actions:

```text
Examiner les différences
Appliquer la nouvelle version
Conserver l’existant
Annuler
```

Only enable bulk apply when safe.

---

# 90. Difference review row

Example:

```text
POIRE CONFERENCE VRAC
15/04/2024

Quantité existante
4,88

Nouvelle quantité
5,12
```

Resolution is explicit.

---

# 91. Remote verification conflict

After local import was already usable:

```text
Vérification distante différente

Les données locales et la vérification distante ne correspondent pas exactement.
```

Actions:

```text
Examiner
Conserver temporairement les données locales
```

Do not silently replace already-used local observations.

---

# 92. `Documents commerciaux`

List:

```text
Week/source label
filename
import date
validation status
operation count
```

Primary:

```text
Importer le PDF hebdo
```

---

# 93. Offline PDF import

After choosing PDF offline:

```text
Document enregistré

Analyse commerciale en attente de connexion
```

The source remains visible in list.

---

# 94. Commercial extraction review

When ready:

```text
Communication commerciale

8 offres prêtes
3 éléments à vérifier
2 signaux marché
```

Actions:

```text
Examiner
Valider les éléments fiables
```

---

# 95. Side-by-source native review

On phone:

- source page preview at top;
- extracted structured object below;
- swipe/tap to next issue.

Do not require permanent side-by-side layout.

---

# 96. Source page preview

Actions:

```text
Agrandir
Page précédente
Page suivante
```

Highlight source excerpt when available.

---

# 97. Corrected commercial document

Banner:

```text
Communication corrigée
```

Example:

```text
Poire Qtee

Ancien prix
3,49 €/kg

Nouveau prix
3,29 €/kg
```

Action:

```text
Valider la nouvelle version
```

---

# 98. Product sheet

Title:

```text
Product label
```

Top identity badges:

```text
Fruit / Légume / Autre
Vrac / Conditionné
```

---

# 99. Product sheet sections

Order:

```text
Performance
Casse
Contexte
Promotions
Unités de besoin
Substituts
Comportement observé
Identifiants & conditionnement
Actions
```

---

# 100. Product performance section

Core metrics:

```text
Ventes
Quantité
Marge
Casse
```

Period control:

```text
7 j
28 j
Semaine
```

Comparison displayed beneath.

---

# 101. Product context section

Rows:

```text
Rupture active
Tension marché
Promotion en cours
Problème qualité
```

Clearly label source.

---

# 102. Product Need Units

Section:

```text
Unités de besoin
```

Example chips:

```text
Tomate polyvalente
Salade
Cuisine
```

Tap → Need Unit detail if included later.

---

# 103. Product substitute card

For each:

```text
Tomate Turino

Relation : Forte
Confiance : Moyenne
Prix : Proche
Marge : Supérieure
4 observations
```

CTA:

```text
Pourquoi ?
```

---

# 104. Substitute explanation screen

Sections:

```text
Besoin client
Compatibilité d’usage
Prix
Conditionnement
Observations terrain
Confiance
Contexte commercial
```

Do not present margin as behavioral relationship strength.

---

# 105. Observed substitution behavior

Example:

```text
4 tensions analysées

Turino
Signal fort

Tomate côtelée
Signal moyen

Tomate cerise
Signal faible
```

Use qualitative labels backed by deterministic score/evidence.

---

# 106. Product `Signaler`

Sticky or header action:

```text
Signaler
```

Opens event sheet with product preselected.

---

# 107. Recommendation detail screen

Header:

```text
Recommandation IA
```

Sections:

```text
Title
Why now
Facts
Interpretation
Action proposed
Objective
Risks
Confidence
Missing data
Measurement plan
Source
Decision actions
```

---

# 108. Recommendation facts

Use concrete cards/rows:

```text
Casse
46 €

Référence
27 €

Écart
+70 %
```

No unsupported generated numbers.

---

# 109. Recommendation confidence

Display:

```text
Confiance : Élevée
Confiance : Moyenne
Confiance : Faible
Données insuffisantes
```

Optional `Pourquoi ?` expands rationale.

---

# 110. Recommendation decision actions

Primary bottom action area:

```text
Accepter
```

Secondary menu:

```text
Modifier
Reporter
Refuser
```

All decisions are persisted locally first.

---

# 111. Accept flow

Tap:

```text
Accepter
```

Confirmation sheet:

```text
Accepter cette action ?
```

Optional planned date.

Submit:

```text
Planifier l’action
```

Result:

```text
Action planifiée
```

Do not mark executed.

---

# 112. Modify flow

Screen/sheet:

```text
Modifier l’action
```

Editable:

- action wording;
- price when applicable;
- date;
- location/TG;
- note.

The modified decision preserves original recommendation separately.

---

# 113. Postpone flow

Sheet:

```text
Reporter
```

Quick dates:

```text
Demain
Dans 3 jours
La semaine prochaine
Choisir une date
```

---

# 114. Reject flow

Sheet:

```text
Refuser cette recommandation
```

Optional reason:

```text
Pas de stock
Qualité insuffisante
Pas de place
Prix non acceptable
Autre action déjà prévue
Non pertinent
Autre
```

---

# 115. Offline decision behavior

Success toast:

```text
Décision enregistrée
Synchronisation en attente
```

The recommendation card immediately reflects local decision.

---

# 116. Execution screen

Separate from decision.

Fields:

```text
Action
Date réelle
Prix réel if relevant
Emplacement / TG
Notes
Status
```

Primary:

```text
Marquer comme réalisé
```

---

# 117. Execution offline behavior

Allowed.

Result:

```text
Réalisation enregistrée localement
```

Post-action review may wait for synchronized business data.

---

# 118. Action review screen

Sections:

```text
Action réalisée
Période de mesure
Avant
Pendant
Après
Résultats observés
Contexte / événements concurrents
Lecture
Conclusion
```

---

# 119. Review result states

French mapping:

```text
Évolution positive observée
Évolution négative observée
Résultat mixte
Pas d’évolution claire
Données insuffisantes
```

Avoid causal wording.

---

# 120. Incomplete execution review

Banner:

```text
Résultat difficile à interpréter

La TG prévue n’a pas été installée.
```

---

# 121. `Pourquoi ?` interaction pattern

Across recommendation/substitution/analytics:

Tap:

```text
Pourquoi ?
```

opens explanation sheet or screen with:

- current value;
- reference;
- comparison period;
- source;
- quality;
- missing data.

---

# 122. `À mesurer` section

Example:

```text
À mesurer

Ventes Turino
Quantité Turino
Casse Turino
Durée de rupture tomate ronde

Bilan prévu
Après la fin de la rupture
```

---

# 123. Search pattern

Global/product-search surfaces use native search input.

Product result row:

```text
Label
Category/nature
Identifier if helpful
```

Search works offline against local product master.

---

# 124. Product unresolved state

Unknown local product:

```text
Produit à compléter
```

CTA:

```text
Compléter la fiche
```

Do not block unrelated valid observations when partial publication policy permits.

---

# 125. Product edit screen

Fields:

```text
Libellé
Catégorie
Nature
Unité de vente
Conditionnement
Identifiants
Aliases
```

Sync status visible only if pending/conflict.

---

# 126. Need Unit edit

Screen:

```text
Unités de besoin
```

Memberships allow:

- add;
- remove;
- mark primary;
- set confidence/strength if exposed to user role.

AI suggestions appear as:

```text
Suggestion IA
```

not validated automatically.

---

# 127. Substitution relation edit

Fields:

```text
Produit source
Substitut
Unité de besoin
Compatibilité besoin
Compatibilité usage
Compatibilité prix
Compatibilité conditionnement
Status
```

Canonical learned score/confidence are read-only.

---

# 128. Local notification behavior

Known commercial deadlines may create local device notifications.

Tapping notification opens operation detail.

If operation changed after last sync:

screen refreshes/local sync attempts before presenting sensitive action state.

---

# 129. Push notification behavior

Examples:

```text
Ticket prêt à valider
Analyse commerciale prête
Bilan d’action disponible
Conflit de synchronisation
```

Push payload navigates to entity ID.

App then reads local SQLite and pulls if required.

---

# 130. AI pending pattern

Reusable component:

```text
Analyse IA en attente
```

Variants:

```text
En attente de connexion
Dans la file d’analyse
Analyse en cours
Échec de l’analyse
```

Actions:

```text
Réessayer
Continuer sans analyse
```

where meaningful.

---

# 131. AI failure must not trap user

Receipt:

allow manual correction/entry when AI fails.

Commercial PDF:

allow retry; manual full extraction is not required in MVP unless defined later.

Copilot:

deterministic facts remain visible.

---

# 132. Local/remote freshness patterns

Do not show technical wording like:

```text
remoteVersion 6
```

Use:

```text
Calcul local
Confirmé
Synchronisation en attente
```

Only show advanced diagnostics under sync/support screens.

---

# 133. Loading states

Because screens are local-first:

normal screen loading should mostly mean:

```text
opening local DB
running local query
```

Use skeletons only briefly.

Do not replace cached content with skeleton during background sync.

---

# 134. Refresh state

During background sync:

keep current data visible.

Small indicator:

```text
Actualisation…
```

When complete, animate changed values subtly.

---

# 135. Error state pattern

Every error state must answer:

```text
What happened?
What remains safe?
What can I do?
```

Example:

```text
La synchronisation a échoué.

Vos données sont enregistrées sur cet appareil.

Réessayer
```

---

# 136. Empty-state pattern

Use contextual primary action.

Examples:

No recommendations:

```text
Aucune priorité particulière
```

No commercial document:

```text
Aucune communication commerciale importée
Importer le PDF hebdo
```

No waste ticket:

```text
Aucun ticket de casse
Prendre un ticket en photo
```

---

# 137. Destructive action confirmation

Use for:

- cancel local unpublished import;
- mark duplicate source;
- logout/wipe local business data.

Do not over-confirm ordinary field actions.

---

# 138. Logout warning

If pending local data exists:

```text
Des données ne sont pas encore synchronisées.

Se déconnecter maintenant supprimera les données locales de cet appareil.
```

Actions:

```text
Synchroniser d’abord
Annuler
Se déconnecter quand même
```

The last option may be restricted if loss would violate product policy.

---

# 139. Notification settings

Screen:

```text
Notifications
```

Toggles:

```text
Échéances commerciales
Tickets prêts à valider
Bilans d’action
Problèmes de synchronisation
```

---

# 140. Data quality screen

Accessible from analyses/alerts.

Sections:

```text
Ventes
Casse
Matching produits
Coûts
Plan commercial
Références de comparaison
```

Use plain French.

Example:

```text
Couverture coût de casse
82 %
18 % sans coût fiable
```

---

# 141. Permission states

Camera permission:

```text
Appareil photo désactivé
```

Notification permission:

```text
Notifications désactivées
```

File access uses system picker and does not require persistent broad storage permission.

---

# 142. Accessibility — dynamic type

Layouts should tolerate increased text size.

Cards stack rather than truncate critical business values.

---

# 143. Accessibility — status

Every status badge has accessibility label.

Example:

```text
"Ticket à synchroniser"
```

not just icon.

---

# 144. Haptics

Optional native haptic feedback can be used for:

- successful capture;
- successful local save;
- conflict/error.

Do not overuse.

---

# 145. Gesture policy

Use familiar native gestures:

- pull-to-refresh;
- swipe back where platform supports;
- bottom sheets.

Do not hide critical business actions behind undiscoverable swipe gestures.

---

# 146. One-handed action priority

Primary action sits near bottom when possible:

```text
Valider
Enregistrer
Accepter
Marquer réalisé
```

---

# 147. Mobile typography hierarchy

Recommended conceptual levels:

```text
Screen title
Section title
Metric value
Card title
Body
Caption/status
```

Metric values must be readable at a glance.

---

# 148. French number formatting

Use locale:

```text
fr-FR
```

Examples:

```text
4 830 €
2,99 €/kg
0,580 kg
+6,2 %
```

Formatting is application-controlled, not generated by AI.

---

# 149. Business date formatting

Use:

```text
15 septembre
14–20 septembre
```

Avoid unnecessary year for near-term operational views.

Use year in historical/source screens when ambiguity exists.

---

# 150. Color semantics

Conceptual:

```text
neutral
positive
warning
critical
informational
local/pending
```

Do not assume red/green alone due accessibility.

---

# 151. Product nature labels

French UI:

```text
BULK → Vrac
PACKAGED → Conditionné
UNKNOWN → À déterminer
```

---

# 152. Product category labels

```text
FRUIT → Fruit
VEGETABLE → Légume
OTHER → Autre
UNKNOWN → À déterminer
```

---

# 153. Recommendation confidence labels

```text
HIGH → Élevée
MEDIUM → Moyenne
LOW → Faible
INSUFFICIENT_DATA → Données insuffisantes
```

---

# 154. Sync state labels

```text
LOCAL → Local
PENDING_SYNC → À synchroniser
SYNCING → Synchronisation…
SYNCED → Synchronisé
CONFLICT → Conflit
FAILED → Erreur
```

---

# 155. Source distinction labels

```text
ENSEIGNE → Instruction enseigne
STORE → Observation magasin
AI → Recommandation IA
```

---

# 156. Commercial operation labels

Examples:

```text
PROSPECTUS → Prospectus
COUP_DE_POING → Coup de poing
DRAMATIZATION → Dramatisation
SUPPORT_TO_PRODUCTION → Soutien production
LOCAL_ACTION → Action locale
```

---

# 157. Commercial state labels

```text
RECEIVED → Reçu
VALIDATED → Validé
PLANNED → Planifié
EXECUTED → Réalisé
CANCELLED → Annulé
```

---

# 158. Execution checklist state labels

```text
TODO → À faire
DONE → Fait
SKIPPED → Ignoré
NOT_APPLICABLE → Non applicable
```

---

# 159. Store-event labels

```text
TENSION → Tension
LOW_STOCK → Stock faible
OUT_OF_STOCK → Rupture
QUALITY_ISSUE → Problème qualité
PRICE_INCREASE → Hausse de prix
SUPPLIER_SHORTAGE → Problème fournisseur
```

---

# 160. Sync conflict rule in UX

Conflict must not block unrelated app usage.

A small global count is sufficient unless the conflicted entity is being edited/opened.

---

# 161. Conflicted entity screen

If user opens conflicted product/operation:

banner:

```text
Conflit à résoudre
Cette donnée existe sous deux versions.
```

CTA:

```text
Examiner
```

---

# 162. Offline source-review limitation

If remote source page is not stored locally:

```text
Source non disponible hors connexion
```

Normalized business information remains visible.

---

# 163. Local source preview

Locally imported PDF/photo/XLSX can be opened from local file while not yet remotely confirmed.

Badge:

```text
Source locale
```

---

# 164. Source traceability navigation

From a recommendation fact:

```text
Source
```

may navigate:

```text
KPI detail
→ observation
→ source document/page
```

Keep depth reasonable; advanced audit can be nested.

---

# 165. KPI detail sheet

Displays:

```text
Indicateur
Valeur
Référence
Période
Formule / définition
Couverture
Origine
```

Useful for `Pourquoi ?`.

---

# 166. Local calculation marker

If local KPI differs in status:

```text
Calcul local
```

Tooltip/sheet:

```text
Calculé sur les données disponibles sur cet appareil.
La confirmation distante est en attente.
```

---

# 167. Remote confirmation marker

Use only where meaningful:

```text
Confirmé
```

Do not add the badge to every row in normal healthy state.

---

# 168. Recommendation priority count

If fewer than 3 valid recommendations:

show only those available.

Never fill to 3 with low-value recommendations.

---

# 169. No-priority state

```text
Aucune priorité particulière
Les indicateurs restent disponibles ci-dessous.
```

---

# 170. Deadline overdue state

Example:

```text
En retard
Précommande Automne
Échéance : hier
```

Action remains visible; do not remove expired item silently.

---

# 171. Operation applicability review

If uncertain:

```text
Applicabilité à confirmer
```

Questions/details show source condition.

Actions:

```text
Applicable
Non applicable
```

---

# 172. Promotion overlap warning

Card:

```text
Chevauchement commercial à surveiller

La Turino et la tomate côtelée répondent à un besoin client proche.
```

CTA:

```text
Voir l’analyse
```

Do not present as measured cannibalization.

---

# 173. Counter-promotion scenario screen

Sections:

```text
Produit
Situation actuelle
Prix actuel
Scénario
Seuil mathématique
Contexte
Risques
Décision
```

Explicit warning:

```text
Ce seuil n’est pas une prévision de demande.
```

---

# 174. Missing purchase cost state

If price scenario cannot be calculated:

```text
Coût d’achat manquant

Impossible de calculer un scénario de marge fiable.
```

CTA:

```text
Vérifier les données
```

---

# 175. Analytics source quality

Quality indicator should be contextual, not a universal traffic-light score.

Example:

```text
Comparaison : bonne
Couverture coût casse : 82 %
```

---

# 176. Search/product picker offline

All local product matching UI must work without connectivity from synchronized Product Master.

AI-assisted suggestion can appear later after sync, but manual selection remains available.

---

# 177. Manual product correction after AI

If AI match is wrong:

```text
Modifier le produit
```

Original raw label remains visible.

---

# 178. Local alias proposal

After repeated confirmed mapping:

```text
Mémoriser ce libellé ?
“POIRE CONFERENCE VRA” sera proposé comme alias.
```

Action:

```text
Oui
Pas maintenant
```

This proposal is syncable.

---

# 179. Import unresolved products

Dedicated filter:

```text
Produits à confirmer
```

Rows show source label and suggestions.

Batch validate only when mappings are unambiguous.

---

# 180. Weekly commercial unresolved items

Dedicated list:

```text
À vérifier
```

Examples:

```text
Prix ambigu
Produit non reconnu
Date à confirmer
Applicabilité inconnue
```

---

# 181. Data correction feedback

After correcting product/date/amount:

```text
Correction enregistrée
Les indicateurs sont recalculés.
```

If large recomputation:

```text
Recalcul en cours
```

---

# 182. Recalculation UI

Do not block navigation.

Show affected card state:

```text
Mise à jour…
```

Previous value may remain visible until replacement.

---

# 183. App foreground behavior

When app returns to foreground:

- local screen remains;
- sync starts if appropriate;
- no forced navigation reset;
- pending local actions remain.

---

# 184. Background processing return

If ticket finished while app was away:

next open shows:

```text
1 ticket prêt à valider
```

and optionally received native notification.

---

# 185. Permission to use mobile data

No custom mobile-data gate is required for MVP unless large uploads become problematic.

If source file is large, show size before upload when relevant.

---

# 186. Large pending file state

Example:

```text
PDF en attente d’envoi
8,4 Mo
```

Actions:

```text
Envoyer maintenant
Supprimer de la file
```

Deleting pending file requires confirmation because source may be lost remotely.

---

# 187. Local file cleanup

After remote confirmation and retention period:

cleanup is silent unless storage pressure requires user attention.

Do not make user manage technical file cache routinely.

---

# 188. Storage pressure state

If device storage is critically low:

```text
Espace de stockage faible

Certaines nouvelles photos ne pourront pas être enregistrées.
```

CTA:

```text
Gérer les fichiers locaux
```

---

# 189. Local file management screen

Only if needed:

- remotely verified source files;
- local-only files;
- size.

Never allow deletion of unsynchronized source without warning.

---

# 190. Native notification schedule — commercial deadlines

When weekly plan synchronizes:

schedule local reminders according to user settings.

If deadline changes:

cancel prior notification and reschedule.

---

# 191. Notification wording

Concise:

```text
Précommande à effectuer aujourd’hui
Opération Automne
```

Do not include sensitive financial data in lock-screen notification by default.

---

# 192. Security-related UX

If session is revoked remotely:

on next successful network check:

```text
Votre session a expiré.
Reconnectez-vous.
```

Preserve unsynchronized local data securely until user reauthenticates to same account if policy allows.

Do not wipe immediately before recovery attempt.

---

# 193. User switch protection

Do not allow another account to open previous user’s SQLite business data.

A different login triggers local data reset/rebootstrap after appropriate unsynced-data handling.

---

# 194. Screen-state matrix — Today

Must support:

```text
normal synchronized
offline with cached data
local-only new import
sync in progress
empty/no data
partial import
recommendation stale
sync conflict elsewhere
```

---

# 195. Screen-state matrix — Week

Must support:

```text
normal synchronized
offline existing plan
PDF queued locally
AI extraction pending
operation validation pending
corrected PDF conflict
deadline overdue
```

---

# 196. Screen-state matrix — Waste

Must support:

```text
camera ready
permission denied
captured offline
pending upload
AI queued
AI failed
validation required
duplicate suspected
validated local
remote confirmed
```

---

# 197. Screen-state matrix — Product

Must support:

```text
normal
offline
product to review
active store event
substitution data available
substitution evidence unavailable
recommendation stale
entity sync conflict
```

---

# 198. Screen-state matrix — Imports

Must support:

```text
local parsing
validation issues
partial local publication
pending source upload
remote verification
verification mismatch
reconciliation required
duplicate
failed
```

---

# 199. Screen-state matrix — Recommendation

Must support:

```text
proposed
accepted local
modified local
postponed
rejected
stale
sync pending
sync conflict
executed
review available
```

---

# 200. UX acceptance criteria

## UX-AC-01 — Offline Today

Given synchronized local data and no network.

Expected:

```text
Aujourd’hui opens normally from SQLite.
```

---

## UX-AC-02 — Offline field event

Given no network.

User records rupture.

Expected:

```text
event appears immediately with À synchroniser status.
```

---

## UX-AC-03 — Offline receipt

Given no network.

User photographs receipt.

Expected:

```text
photo persists across app restart and shows Analyse IA en attente.
```

---

## UX-AC-04 — Offline Mercalys import

Given no network.

User imports valid XLSX.

Expected:

```text
local validation and KPI calculation complete without connectivity.
```

---

## UX-AC-05 — Sync recovery

After network returns.

Expected:

```text
pending local work syncs without user re-entry.
```

---

## UX-AC-06 — Maximum priorities

Given 12 candidates.

Expected:

```text
Aujourd’hui and Ma semaine display at most 3 primary priorities.
```

---

## UX-AC-07 — No fake Yesterday

If latest complete date is two days ago.

Expected:

```text
show exact business date, not “Hier”.
```

---

## UX-AC-08 — Recommendation source distinction

AI recommendation and enseigne task on same screen.

Expected:

```text
distinct labels.
```

---

## UX-AC-09 — Accept is not executed

User accepts recommendation.

Expected:

```text
status becomes planned/accepted, not réalisé.
```

---

## UX-AC-10 — Mixed waste ticket

Bulk and packaged items on same receipt.

Expected:

```text
nature shown per line.
```

---

## UX-AC-11 — Missing waste date

Receipt has no date.

Expected:

```text
validation requires user date confirmation.
```

---

## UX-AC-12 — Duplicate suspicion

Similar ticket found.

Expected:

```text
user compares; system does not auto-delete.
```

---

## UX-AC-13 — Recommendation stale

Underlying data changes.

Expected:

```text
recommendation visibly marked À recalculer.
```

---

## UX-AC-14 — Sync conflict

Same Product modified on two devices.

Expected:

```text
normal app remains usable; product shows conflict and resolution screen.
```

---

## UX-AC-15 — Pull-to-refresh offline

Expected:

```text
cached screen stays visible with offline message.
```

---

## UX-AC-16 — AI unavailable

Expected:

```text
facts and deterministic alerts remain accessible.
```

---

## UX-AC-17 — Source traceability

User taps Source on commercial offer.

Expected:

```text
page/source preview opens if locally or remotely available.
```

---

## UX-AC-18 — History not local

Offline user requests older history.

Expected:

```text
clear local-history limitation, no blank misleading graph.
```

---

## UX-AC-19 — Local KPI badge

Locally imported unsynchronized sales.

Expected:

```text
KPI is usable and optionally marked Calcul local.
```

---

## UX-AC-20 — Logout with pending data

Expected:

```text
explicit warning before local data loss.
```

---

## UX-AC-21 — Corrected commercial PDF

Expected:

```text
old vs new values displayed before validation.
```

---

## UX-AC-22 — Price semantics

Strict ceiling, threshold and card benefit.

Expected:

```text
distinct French displays; no generic price flattening.
```

---

## UX-AC-23 — Low-quality percentage

Tiny-base +500% variation.

Expected:

```text
not visually prioritized solely due to percentage.
```

---

## UX-AC-24 — Data-quality issue

Critical cost coverage issue.

Expected:

```text
can appear as operational priority.
```

---

## UX-AC-25 — Native local deadline

Device offline when reminder time occurs.

Expected:

```text
already scheduled local commercial reminder can still fire.
```

---

# 201. Out of scope for this UX specification

Not required in MVP:

- tablet-specific optimized layout;
- watch companion;
- desktop client;
- consumer-facing experience;
- complex gesture-driven editing;
- collaborative live co-editing;
- AR merchandising;
- customer-level journey analysis;
- voice assistant;
- barcode-scanner workflow unless added later;
- headquarters network dashboard.

---

# 202. Recommended screen implementation order

```text
1. Native shell + auth
2. Global sync indicator
3. Aujourd’hui
4. Product sheet
5. Signaler store event
6. Imports / Mercalys
7. Casse capture + validation
8. Synchronisation dashboard
9. Ma semaine
10. Commercial operation detail
11. Recommendation detail + decisions
12. Analyses
13. Conflict resolution
14. Action execution + review
15. Settings / notifications
```

---

# 203. UX definition of done

The native UX is ready for implementation when a manager can perform these flows from the specification without requiring additional architectural interpretation.

### Daily

```text
Open app offline or online
→ see latest local business state
→ inspect max 3 priorities
→ open product
→ signal issue
→ accept/modify/postpone/reject recommendation
```

### Waste

```text
Take photo
→ persist locally
→ wait for AI if required
→ validate product/date/amount
→ publish waste locally
→ synchronize later
```

### Mercalys

```text
Choose XLSX
→ parse locally
→ review issues
→ publish local observations
→ see recalculated KPI
→ synchronize/verify remotely later
```

### Commercial

```text
Import PDF
→ retain locally
→ remote extraction when connected
→ validate operations
→ prepare week
→ update execution tasks offline
```

### Synchronization

```text
continue field work offline
→ inspect pending items
→ reconnect
→ synchronize
→ resolve only genuine conflicts
```

---

# 204. Final UX invariant

The experience must always make the following distinctions understandable:

```text
Available locally
vs
Waiting for synchronization
```

```text
Synchronized
vs
Confirmed after remote processing
```

```text
Instruction enseigne
vs
Observation magasin
vs
Recommandation IA
```

```text
Recommendation accepted
vs
Action executed
```

```text
Observed change
vs
Causal claim
```

```text
Missing
vs
Zero
```

```text
AI pending
vs
Business work blocked
```

AI pending should almost never mean business work is blocked.

---

# 205. Rule for implementation agent

The implementation agent MUST design each primary screen against SQLite/local repositories first.

The normal interaction pattern is:

```text
render local
→ mutate local
→ queue sync
→ synchronize in background
→ react to local database changes
```

It must not redesign the product around synchronous remote requests during implementation.

---

# 206. Next document

After this UX specification, create:

```text
IMPLEMENTATION_PLAN.md
```

The plan should decompose development into milestones, tickets, dependencies, acceptance criteria and recommended agent execution order.

It must use the native Expo offline-first architecture and the screens defined in this document.
