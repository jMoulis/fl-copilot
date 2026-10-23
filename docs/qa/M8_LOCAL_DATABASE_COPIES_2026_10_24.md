# M8 — private local copies and explicit resumption, 24 October 2026

## User flow

Synchronisation → Copies locales de sécurité is folded below the operational state/conflicts. Creating a copy is explicit and local: it does not publish, upload, generate an image, request AI or grant a provider permission. Five dated entries appear per page; the list reads on expansion/manual refresh, not synchronization progress.

A copy retains the complete SQLite aggregate, original device identity, exact Outbox UUIDs/order/status/attempts and local metadata. Source binaries remain at their existing private URIs; they are not duplicated or made portable by this feature. Uninstalling the app removes its container and these copies. This is **not** a cloud/device-loss backup, raw export or corruption repair.

“Vérifier cette copie” creates a separate working generation and checks integrity, known migrations, foreign keys, existing device UUID and command-device consistency. Unknown ownership, foreign account/store, changed bytes, unsupported versions and unreadable data cannot be activated. Known corrupt files remain retained. The original isolated DB/WAL/SHM is never opened as an operational SQLite database.

A separate confirmation explains logout, full restart and the absence of table merging. Canonical logout invalidates session generations and drains session persistence before activation. The root removes operational providers and switches the existing installation-bound route only after verification. It **does not hot-open** a new database under old callbacks or close their old handle. The user must fully close and reopen the app. Old writes that finish late still target the retained previous location.

The original owner must authenticate normally before restored content is exposed; no tokens or personal profile fields are archived. A credential-free verified-owner marker then permits ordinary account switching again. The normal server session, membership checks, command journal, domain conflicts and sync retries remain authoritative. No generic recovery writer, forged principal, re-keying, new command or fabricated acknowledgement is added.

The previous working location remains accessible as a separate copy. A user can resume it in turn to recover later local drafts/actions; the app does not silently combine their local state. The ordinary sync pipeline reconciles durable changes through stable command IDs and versions.

## Implementation and evidence

- Native consistent manual backup uses the installed Expo `backupDatabaseAsync`, serialized through the **existing** writer queue, into a new private destination. It does not copy just a live main DB and omit its WAL. [Expo API](https://docs.expo.dev/versions/latest/sdk/sqlite/#sqlitebackupdatabaseasyncoptions).
- Inactive retained locations are copied as a stable DB/WAL/SHM set without opening the original: hash all originals, copy/check destinations, recheck the entire original set and presence. Workable clones alone are opened/migrated/checkpointed. Originals stay immutable.
- SHA-256 uses bounded 1 MiB chunks and yields between groups. Destination/ownership manifests are persisted/read back before presentation. The existing v1 route manifest is unchanged; no SQL migration or server contract is introduced.
- Readable copies, prior locations and isolated snapshots are scoped by existing SecureStore ownership traces. Unknown/incomplete copies remain retained but are never described as recovered.
- Prepared bytes/owner/route are verified again at activation. A failed/lost acknowledgement retains both generations and retries the same activation.
- Real file-backed SQLite tests cover exact journal/draft/device survival, reopen, later writes retained in the previous base, resuming that previous location, queued snapshot behind an aggregate transaction, scoped refusals, changed bytes, future schema, Keychain failure, readable forensic WAL clones and unchanged corrupted originals. An unreadable older generation link does not hide independent owned backups or grant ownership to unknown history.
- Real mounted AuthProvider tests cover late login-code/verification responses, original-owner gate, foreign stored markers and refresh completion after canonical logout/unmount. Session tests verify credential-free traces, completed-logout retries and the persisted first-owner verification grant.
- Real mounted DatabaseProvider tests prove operational unmount precedes activation, logout completes first, no live DB swap/close/reinitialization, restart instructions, and failure without resurrecting operational UI.
- Real mounted panel tests cover lazy reads, five-row paging, separate confirmation/cancellation, scoped late results and safe actionable errors retaining known content.

Validation locale : **51 tests ciblés passés ; 3 389 tests complets passés / 636 ignorés car dépendants de l’environnement**, dix projets typés, lint/structure/formatage verts. Les deux CI du commit final doivent aussi réussir, notamment les cas MongoDB transactionnels et les exports natifs. SQLite/backup tests use Node's real file-backed engine and online backup with mocked Expo filesystem/SecureStore ports. Component tests use native host ports; they do not prove physical bridge timings, gestures, OS lifecycle or accessibility.

## Native acceptance still required

Use a disposable test installation with real authorized pilot access, **not destructive experiments on the only unsent production copy**. Create a local draft/edit offline, make a copy, add a later draft, prepare/confirm, fully close/reopen and authenticate as its original owner. Verify the saved draft and stable pending command; synchronize, then retry without duplicate publication. Resume the retained previous location and verify the later draft still exists. Check source image/file opening, foreground/background/restart, interrupted storage, keyboard/screen reader and iOS/Android separately. Never uninstall/reset during recovery.

A copy that cannot pass SQLite integrity is preserved and refused; arbitrary damaged-row salvage is not claimed. Physical native restore, platform OS-backup inclusion/exclusion, actual cloud backup/restore, cross-device acceptance and remaining M7/M8/V1 gates remain open. No paid EAS build, provider invocation, new credential or production business mutation is implied by these tests.
