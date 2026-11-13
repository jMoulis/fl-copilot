# Store nearby transports — 13 November 2026

Owner-approved scope: a store configuration entry discovers nearby stops/lines from a fixed recorded shop GPS point or an address resolved by IGN. Default radius 800 m, adjustable 200–2000 m. Managers review the resolved address and choose enabled lines; no device tracking. Discovery is read-only, explicit and never a business save. Save reuses StoreContextSettings, SQLite transaction/Outbox, versioned conflict policy and canonical sync, preserving old-writer omissions and projecting extensions only to capable clients. No new operational collection or table.

Official sources: IGN Géoplateforme geocoding, IDFM public arrets-lignes geographic reference and PRIM Navitia line_reports. No city-centre substitution for a shop point, guessed line IDs, arbitrary provider URLs or invented API success. Key PRIM_API_KEY is server-only; recorded as Production Secret, never mobile/configuration payload/log. Live credential validation requires a server release because the stored Secret cannot be read back; no workaround or secret copy requested. No build/deploy is requested in this coding batch.

Acceptance: address ambiguity stays selectable; search/radius/location changes invalidate late results and old selections. Bounded pagination and line limits are visible. Only saved enabled lines enter Journal/provider requests, with independent stale/unavailable states, original messages and publication/application distinction. Published disruption ≠ store impact; no messages ≠ normal traffic. Historical views use actual archived captures; current feed is not a historical archive. Model receives compact summaries through store_week, no new agent/tool and no causal estimate.

## Verification and release boundary

Read-only probes verified the actual IGN address response and 82 IDFM stop/line
rows within an 800 m sample radius. No production shop location or watchlist was
invented or written. Deterministic traffic fixtures follow the official Navitia
contract, including nested stop links, overnight/recurring application windows,
partial output, an explicit empty result and source failure. SQLite restart,
canonical conflict and capability negotiation, mounted native editing/read-only
roles, scoped HTTP lookup and bounded Copilot text are covered. Real Mongo tests
run in transactional CI, not against production.

PRIM_API_KEY is already a Production Secret. The credential cannot be read back;
no attempt is made to copy or bypass it. Actual PRIM authentication/rights and
physical iPhone acceptance remain release checks after API deployment. No EAS
build, deployment or paid model/provider test is started by this coding batch.
