# Journal · carnet de rayon

Implement the approved prototype from Codex “Moderniser le design de l’appli”
(thread `01a1d307-509a-7b02-9281-14b046c6cf59`), including the final owner request
to retain the application's system font. Source prototype is in the workspace's
`prototypes/journal-rayon`; its small botanical assets are now bundled locally.

## Implemented

- Compact shared header variant with existing catalogue/settings shortcuts;
  botanical Journal masthead, system-font heading and underlined daily/week tabs.
- Seven selectable dates and adjacent-week controls. The selected week still opens
  the canonical Ma semaine route; returning retains the Journal date.
- Compact, tone-aware forecast banner. Actual forecast time, archived/stale
  qualification and missing values remain explicit. Full precipitation, calendar,
  source and refresh details remain in the existing swipeable sheet.
- Three compact observation rows, severity bars, visible unsent/conflict/error
  status, read-only detail sheet and canonical history access. No demo rows.
- “Signaler”: searchable local product selection, six exclusive type buttons,
  three severity cards plus an explicit unknown option, compact dates/times,
  optional end/note and the existing local transaction/Outbox save. Returning
  from a Journal capture restores its originating screen.
- The analysis link still prepares a draft. It never sends a model request.

The prototype's fictional weather, product events and dates are not production
data. No API, schema, migration, provider, paid model call or KPI calculation
changes. Other main headers retain their existing presentation.

## Verification

- Full local suite: 5,164 passed; 867 conditionally skipped (including external
  Mongo integration prerequisites). Exact-head GitHub CI remains required.
- Mobile/workspace typecheck, lint and iOS export passed. The export includes both
  local images and the Hermes bundle. Formatting/structure checked separately.
- Existing navigation/observation/calendar/cache/DST tests retained; the navigation
  recipe now uses the approved tabs/buttons. Selection test covers null vs low,
  exactly one selected severity, changing it and disabling during save.
- Native visual check on the existing iPhone 17 Pro simulator: bundled artwork,
  compact unavailable forecast, Journal navigation, Signaler, type buttons and
  severity cards render. Selecting High changes exactly that selection without
  saving an event. Existing local data were used; no fictional event was added.
- This inspection caught NativeWind discarding Pressable style callbacks. The
  changed controls now use static style arrays plus active opacity classes.
- The local development API is unavailable, so the live forecast refresh and
  business save/sync were not claimed as visually validated. Existing cache and
  repository tests cover their unchanged paths. Owner TestFlight acceptance and
  an exported bundle remain distinct.

## Native acceptance

1. Compare Journal to the approved carnet: compact weather, botanical header,
   date strip, existing observations; open/close forecast and observation details.
2. Select another day/week, open Ma semaine, return and verify the date remains.
3. Open Signaler, select/change a product and type, try all severity cards then
   Non précisée; enter actual dates/time and note. Saving returns to the Journal.
4. Verify a past capture still requires its actual time; an ambiguous clock-change
   hour retains its explicit occurrence choice. Existing event closure/history
   and offline local capture remain available.

A new native binary is required to deliver bundled artwork to the iPhone.
