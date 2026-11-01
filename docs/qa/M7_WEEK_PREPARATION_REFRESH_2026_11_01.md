# Weekly preparation return and persistence — 1 November 2026

## Reproduced boundary

The owner-approved flow remains original commercial PDF → reviewed offers → selected future-week draft/TGs → separately validated plan. Import/extraction is not a prerequisite for reading the original or retaining original-backed choices. Existing Actions and PDF entries carry the explicit intended Monday.

The mounted preparation route initialized its fields only once. After leaving it, a newer draft saved through chat or received by sync was read but never applied to the form or saved baseline. The regression test fails before the fix: the new note is absent and plan validation receives the old revision.

Reuse the existing unsaved-form comparison (including a first draft) and refresh fields/baseline on focus only when untouched. Read the latest dirty flag at asynchronous completion so a new edit is not overwritten. When edited, retain the local fields and original baseline; the unchanged repository rejects a stale save rather than overwriting the newer draft. No merge, automatic save or new background reader is added. The header now shows ISO year and explicit French date range before any draft exists.

## Evidence

- Four mounted React Native tests with actual SQLite repositories: untouched draft updated on return; pending local edit preserved and stale save rejected with no Outbox write; four TGs saved once to the selected week and restored after remount; first unsaved draft retained when a synchronized record appears. Plan/execution tables stay empty for draft-only saving.
- Existing original-choice roundtrip on disposable transactional MongoDB and two SQLite files: actual source upload/preview/private proposal/native confirmation, once-only retained offers, restart/second SQLite, validation, future preparation and synchronized saved plan without extraction. Fixture decisions are explicitly simulated, not owner approval.
- Six-file focused flow passes 35 tests; the final four-case native file also passes after the date/header change. Full local check passes 4,602 tests with 742 environment-dependent skips. Final CI supplies transactional Mongo and verifies the exact head; formatting, builds and mobile exports remain required.

The four-TG mounted draft case and two-offer original-to-plan roundtrip are separate tests, not a claimed real four-offer model conversation. No paid AI test, provider change, production business write or EAS request.

## Delivery and acceptance

The Mac was locked when native visual verification was attempted. An unlock request is pending; no visual/hardware success is inferred. Owner phone remains build 20 until the grouped native release. Group this route fix with pending PR 389/394/395 native changes, and the previously committed colleague-tone sentence with pending API guidance. APIs, schemas, Outbox and canonical decision/validation writers remain unchanged.

Manual grouped recipe: Actions → Préparer la semaine prochaine; verify dates/year, retain an original-backed future offer, prepare available TGs, save, leave for chat and change the draft, then return without manual edits. The new revision must be visible and validation must use it. Repeat with a local unsaved note: preserve it and refuse stale overwrite. Separately validate the actual offers/plan; a saved draft never records execution.

M7 workstreams 3/7 advance (tone refinement in 4); states remain 1/3/4/5/6/7 ongoing, 2 code ready. Full V1 and actual-model/device acceptance remain open.
