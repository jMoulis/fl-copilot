# M8-T09 — foreground-only automatic retry

The existing 60-second sync retry callback did not recheck AppState. If a pending retry elapsed after the app became backgrounded/inactive and its JavaScript runtime continued to execute, it could start another network cycle.

Two mounted-provider assertions reproduced the extra call before correction, for network-unavailable and request-timeout failures. The callback now starts work only when AppState is active. The existing foreground listener still resumes immediately; the retry interval, explicit sync action, transaction pipeline and in-flight work are unchanged. No background service, new listener, dependency, schema or API is introduced.

Six mounted provider cases use real file-backed SQLite, controlled AppState/network ports and fake time enabled before the retry is scheduled:

- Both network failure types retain local calculations and the exact pending command.
- The timer does not start a cycle in background or inactive state.
- Returning to active immediately starts the existing resume cycle.
- A timer expiring while already active still starts the normal retry.

The related provider/pipeline/service/upload batch passes **53 tests across four files, zero skips**, with ten-project typecheck and targeted lint. This proves callback/lifecycle logic under controlled ports; it is not an iPhone battery benchmark or proof of background delivery. Native iPhone acceptance and grouped binary delivery remain open.

## Native interruption attempt

The isolated iPhone17Pro simulator was selected, still displaying the retained PDF. Device Hub had no network interruption action in its Device menu. Opening the Settings inspector then failed with no available window, and reacquiring the running app timed out. No native network-loss result is claimed. No working iPhone16e data, device networking, account, source or business record was changed for that attempt.

T01 native interruption, T04 remaining corruption/source recovery and T09 wider consumption qualification stay open. T12 server backup remains owner-deferred. No paid build, API deployment or provider request was triggered.
