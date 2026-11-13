# INSEE monthly parser fixture

`insee-monthly-2026-11-13.xml` is the actual public SDMX response retrieved on
13 November 2026 for these two INSEE series:

- https://www.insee.fr/fr/statistiques/serie/011813720
- https://www.insee.fr/fr/statistiques/serie/001587668

Exact request:
https://bdm.insee.fr/series/sdmx/data/SERIES_BDM/001587668+011813720?startPeriod=2024-01&endPeriod=2026-11

Source: Insee, Banque de données macro-économiques. Format documentation:
https://www.insee.fr/fr/information/2862759

This fixed response qualifies parsing, revisions, different latest periods and
missing-data handling. It is a test fixture, not production store data or an
archive of what was published/known at each historical observation date. Runtime
requests are narrower than this research fixture and cache the current edition.
