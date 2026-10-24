# Explorer — accessible aggregate periods, 24 October 2026

## Reproduced defect and change

The real chart receives canonical clipped monthly buckets for years or explicit ranges longer than 62 days. Its accessible button name previously announced only the first calendar date, even when the value represented several days. It also omitted whether a source-linked value was a sum or an average of known days.

The existing chart now announces both actual bucket bounds and the aggregate meaning. The shared engine, monetary values, missing/zero and incomplete-data states, touch targets and drill callback stay unchanged. There is no new helper, model instruction, API, permission, persistence or dependency.

## Evidence

Three mounted-component scenarios fail on the original implementation and pass with the change. The native host surface is controlled; the actual chart, calendar buckets and navigation state reducer run unchanged. A 15 January–4 April range contains two known January amounts (10 and 20), a deliberately excluded earlier amount (1,000), missing months and a recorded April zero. Tests distinguish exact 30 sum from 15 known-day average, announce the clipped end dates, preserve missing versus zero, and drill to 1–4 April with the same aggregation and history. A year column announces all of January and retains its existing destination.

Focused chart/context/source-period/calendar/link regression: **25 tests / 5 files pass**. Full local check: **4,474 passed / 727 environment-dependent skips**, ten strict TypeScript projects, lint and structure pass. Format passes. Exact final source CI remains necessary before merge; this is not a physical VoiceOver or TalkBack acceptance.

## Delivery boundary

This correction is after the already available iOS build **16** (`e43dc85`). No isolated EAS build, API deployment, business write or paid model call is justified. Include it in a future substantial native batch. The complete V1 hardware, accessibility and data-preservation recipes remain open. Seven M7 workstreams: 1/3/4/5/6/7 in progress; 2 code ready.
