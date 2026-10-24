# Visual pilot — operator runbook

Read `AUDIT.md` first. Use Node/Pnpm already installed for this repository. No database, Blob or AI provider credentials are needed by the importer. It is a local operator CLI, excluded from the deployed API runtime. No server/mobile release is needed to run it against the existing visual endpoints.

## 1. Prepare external evidence, without approval

Keep the supplied reference separate. Obtain three individual final RGBA PNGs and their actual generation records. Ask the originating agent for original output, actual provider/model, prompt version and actual prompt, generation time, original/final files and every transformation's tool/time/input/output hash. Unknown fields stay blocked; do not guess model names. Do not accept an approval/run journal or session from the external agent.

Create a local bundle containing `import-input.json` and relative file paths. Shape:

```json
{
  "schema": "fl-copilot-visual-pilot/v1",
  "pilotId": "<one persistent UUID>",
  "items": [
    {
      "visualKey": "tomato_round",
      "canonicalName": "Tomate ronde rouge générique",
      "productId": "<human-confirmed exact catalogue UUID>",
      "file": "images/tomato.png",
      "provenance": {
        "type": "AI_GENERATED",
        "provider": "<actual>",
        "model": "<actual>",
        "promptVersion": "<actual>"
      },
      "generation": {
        "generatedAt": "<actual ISO UTC timestamp>",
        "originalFile": "originals/tomato.png",
        "promptFile": "evidence/tomato-prompt.txt",
        "evidenceFile": "evidence/tomato-generation.json",
        "transformations": []
      }
    }
  ]
}
```

Schema requires exactly three unique keys: `tomato_round`, `banana_cavendish`, `avocado_hass`. This snippet shows one item's structure, not an executable full manifest. Other missing fields can be null in preparation. Empty transformations is valid only when actual original and final bytes are identical. Paths must remain in the bundle and point to regular, non-symlink files; the composite reference is forbidden. Inspect never writes remotely:

```sh
pnpm --filter @fl-copilot/api dev:visual-pilot inspect /absolute/bundle/import-input.json
```

The supplied package's `manifest.candidates.json` is not the importer input schema. Keep it as unapproved source evidence. A prepared import input and separate `manifest.json` report explicitly record missing metadata instead of pretending that assets exist.

## 2. Genuine application authority and human review

A real active application manager session for the intended store is required. Mongo/Vercel connector credentials, database session hashes or a server signing secret are not substitutes. No new session-export/login capability is implemented by this pilot: if a secure authorized session is unavailable, **STOP** and resolve that access explicitly.

The operator-only session file must be current-user owned, regular, non-symlink, mode 0600. It contains the genuine application response `accessToken`, `accessTokenExpiresAt`, `user`, `stores`, plus the actual associated `deviceId`; omit refreshToken. Never paste tokens into chat, logs, command arguments or the repository. State is kept in a separate owner-only 0700 directory outside the untrusted image bundle. Use a dedicated directory. The importer acquires an exclusive lock and persists command UUIDs atomically before writes.

```sh
pnpm --filter @fl-copilot/api dev:visual-pilot import /absolute/bundle/import-input.json \
  --session /private/operator/session.json \
  --store b1587682-bb70-4aba-a066-74298ef97640 \
  --state /private/operator/visual-pilot-state --item tomato_round
```

Only the actual human reviewer operates the TTY. Open the real PNG and evidence, verify SKU and composition, then explicitly type the displayed digest. The agent must not automate that human input. Review approves this store's image and generic association; there is no approval flag in the input. The CLI rechecks live manager role/catalogue/manual choices and stops if anything changed. Existing manual links always win.

## 3. First image, supported mobile sync, then remainder

The CLI pushes approved asset metadata, validates the acknowledgement, initializes private transfer, PUTs only scoped bytes/headers if necessary, completes server verification, rereads manifest and downloads original+preview to verify actual hashes. It then pushes identity/link and reads all canonical metadata back. `AWAITING_MOBILE` is **not** mobile acceptance.

On an identified real installed app with the correct store/session, use the supported synchronization action. Open the exact tomato product and inspect the image and generic status. Verify old manual images unchanged. Let the preview finish caching, disable network, restart and reopen the product. Capture a genuine screenshot and record app build/device/offline result. Do not uninstall/reset the app or delete local data.

Only after that actual review may the human record the attestation:

```sh
pnpm --filter @fl-copilot/api dev:visual-pilot mobile-review /absolute/bundle/import-input.json \
  --session /private/operator/session.json \
  --store b1587682-bb70-4aba-a066-74298ef97640 \
  --state /private/operator/visual-pilot-state --screenshot /private/evidence/actual-mobile.png
```

The screenshot hash plus explicit offline attestation records what the human reports; it is not automatic proof of a physical phone. The CLI freshly verifies server entities/manifest before recording it and before remaining imports. Remaining items still require their own image/SKU review. Banana remains blocked while its manual link exists; resolve it only via an explicitly authorized existing application action, never deletion/direct Mongo edits. Avocado requires confirmed SKU first. Run one `--item` at a time; there is no bulk autopublish.

## Retry, conflicts and reconciliation

- Preserve bundle, evidence and private state. Retry exactly the same invocation and journal after uncertain responses; command UUIDs are reused. Existing files may return READY and are still verified. Do not regenerate IDs, recreate the pilot or alter approved inputs to escape an error.
- Expired/invalid session: stop and obtain a genuine renewed session for the same user/device/store. Refresh is not silently implemented here. Review a changed product or file afresh; do not edit the existing approved journal.
- CONFLICT, hash mismatch, new manual choice, revoked authority, missing manifest or unexpected destination: stop. Inspect canonical application state and reconcile explicitly. No force flag, silent sum, tombstone resurrection or last-write-wins.
- Interrupted process may leave `pilot.lock`. Never automatically remove it by age. Establish that no operator/import process is active, preserve the journal, then have the operator remove only that stale lock. Never delete a source or unsent command to repair a lock.
- Failure after asset approval can leave an unlinked approved asset or staged file. Preserve evidence and resume; do not delete remote originals or fabricate completion.
- Rollback is an explicit manager action through existing library/link/revocation services with current expected version and sync acknowledgement. Existing revoke UI/service is authoritative; no direct database/Blob deletion script. Revocation propagates normally and must not overwrite another user's later manual choice. No rollback was performed by this preparation.

## Scope and deployment

No new collections, schema migration, server endpoint, preview format change, app authentication platform, AI provider request, EAS build or Vercel deployment is introduced. Private operational JSON is not a new domain model. Existing APIs remain the only mutation/file authority. Do not scale to 450 products until one real image passes the full gate and the remaining two are actually accepted.
