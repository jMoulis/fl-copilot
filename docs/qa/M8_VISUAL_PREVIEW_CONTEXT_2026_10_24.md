# M8 — visual comparison preview context, 24 October 2026

## Reproduced behavior

The shared manual/chat visual-version presentation retained its URI/loading state when its selected image or SQLite context changed. Three actual React/SQLite reproductions fail on the preceding implementation: an already displayed old image survives a new source, a pending read leaves the new source busy, and a retained old-source callback still opens the preceding store’s local file.

These are component-level reproductions with migrated disposable SQLite and controlled native file URI lookup. They are not a claim of a new pilot crash, physical cross-device data disclosure or actual native image decoding. Raw before/after evidence is retained in the private release artifacts.

## Correction

The same presentation now invalidates its committed database/source context before paint and on blur/unmount. A focus owns one active read context; late cache/file results cannot alter the next selection. The context is rechecked before progressing from cache to preview/source file lookup. Focus return permits a new read, and repeated retained taps coalesce while that read is pending. No source/file/metadata is deleted or rewritten; no download, provider call, permission or model tool is introduced.

The existing cache verification and file-storage ports are reused. Both the manual comparison and chat card use this single component; chat’s existing full-review key remains an additional boundary. Source display is explicit, local and independent from the business conflict decision/rights confirmation.

## Validation and limits

Eight new mounted-component cases cover changed source on the same/another SQLite, a late old-store read, an old callback, focus loss/return, duplicate taps, interruption between cache/file and database-only replacement. The two chat mounts and 44 manual comparison mounts run alongside them: **54 targeted tests pass**. Full `pnpm check`: **4,221 passed / 698 skipped**, 411 passed / 73 skipped files; structure/lint and ten strict TypeScript projects pass. Initial test-only host-component typing/Pressable-mock errors are excluded from the three reproduced behavior defects. Snapshots of both fixture databases verify that products, visual metadata/cache, original conflict packets, history and Outbox stay unchanged. No network transfer is performed.

Actual focus/navigation gestures, file decoding/storage access and comparison acceptance still require the grouped iOS/Android hardware recipe. No EAS build is started for this correction. This source is outside build 14; the compatible API and preceding capability-7 delivery have separate gates. Other complete V1/UX/M8 requirements remain open.

M7 states unchanged: **1/3/4/5/6/7 IN_PROGRESS; 2 CODE_READY**. This advances the visual context portion of 7/M8 and does not close the workstream.
