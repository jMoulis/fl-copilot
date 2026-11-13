# Preserve daily context across transport settings

Native-release preflight found that the daily archive hash included the whole
transport preference object. Saving the first watchlist therefore hid already
collected weather/calendar context from the database-only Copilot reader.

The real-Mongo regression first fails on the released source: a known forecast
becomes inaccessible after adding a watchlist. The correction keeps the existing
no-transports geographic hash, so current production captures require no rewrite.
A bounded read also supports the matching legacy profile key. Archive merging
uses actual last collection times; shop/location isolation remains unchanged.

Project only currently enabled lines. Missing new-line history stays unknown;
disabled lines disappear and clearing transports preserves other context. Share
the existing location-change check between live and saved readers. Current stop
labels/distances are configuration; archived messages remain line-level published
messages, with their original capture/application timestamps and no inferred shop
impact. No source refresh, new model/tool, schema migration or business write.

Local qualification: the new regression fails before the fix; 24 focused tests
pass afterward, including real isolated Mongo, old-key reads, configuration
changes, explicit missing history, native settings and bounded Copilot evidence.
Strict types pass. Full exact-head GitHub checks remain the merge gate. This fix
must accompany the grouped iPhone acceptance release; a build is not proof of
owner acceptance or live PRIM authentication.
