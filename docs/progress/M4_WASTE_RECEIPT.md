# M4 native waste receipt workflow

Date: 2026-10-04.

## Scope

The active milestone covers M4-T01 onward from `docs/specs/IMPLEMENTATION_PLAN.md`: native camera capture, persistent offline source images, local receipt and line state, private upload, assisted extraction, arithmetic and product validation, duplicate handling, waste publication and recoverable pending AI states.

## Implemented

### M4-T01 — Camera capture

- `expo-camera` is installed at the Expo SDK 57-compatible version and configured with a French iOS permission explanation.
- The `Casse` tab now opens a dedicated native capture screen instead of a product placeholder.
- The first-use and denied-permission states explain why camera access is needed, request permission when possible and open system settings after a permanent denial.
- The native camera uses the rear lens, waits for readiness, exposes a flash control and displays a tall receipt framing guide with the instruction to avoid cropping and glare.
- Captured images open in a review step with explicit `Utiliser cette photo`, `Reprendre` and `Annuler` actions.
- Confirmation copies the temporary camera JPEG into the app-owned `Documents/waste-receipts` directory under a stable UUID filename, verifies that the durable copy exists and removes the temporary cache file.
- The camera preview unmounts when the screen loses focus, preventing an inactive tab or screen from retaining the camera session.
- Browser routes state that capture is native and never simulate a successful persistent capture.
- The saved state confirms that the original file is local; receipt-domain persistence, upload and AI processing remain assigned to M4-T03 onward.

The complete camera flow was validated on the target iPhone Air with the M4-T01 staging build.

### M4-T02 — Image import

- The `Casse` tab exposes `Importer une photo` as the secondary entry point, including when camera permission is unavailable.
- The native picker accepts one JPEG, PNG, HEIC or HEIF image at a time and keeps its original quality.
- A selected image is copied into the same app-owned `Documents/waste-receipts` directory under a stable UUID filename while preserving its supported extension.
- The source selected from the photo library is never deleted; only the application-owned copy is used by the future receipt workflow.
- A declared unsupported MIME type is rejected before persistence, even when the source filename has a misleading supported extension.
- Cancellation leaves no local success state. Copy failures remain visible and retryable on the import screen.
- The browser route explains that image import and private native storage require the mobile application.

The photo-library import, cancellation and source preservation flow was validated on the target iPhone Air with the M4-T02 staging build.

### M4-T03 — Offline receipt domain model

- SQLite schema version 12 adds the canonical `waste_receipts` and `waste_lines` tables, store/status indexes, stable local IDs, source lineage, validation state and sync metadata.
- Shared runtime-neutral schemas define receipt, line, AI, duplicate, matching, validation and synchronization states without treating pending values as completed work.
- Camera capture and image import now calculate the durable file size and SHA-256 checksum before creating a local receipt draft.
- The local file metadata and its receipt are inserted in one SQLite transaction with `CAPTURED`, `PENDING`, `UNCHECKED` and `LOCAL_ONLY` initial states.
- Receipt lines share the receipt and store identity, preserve raw labels, decimal strings, extraction evidence and independent product nature.
- The `Casse` tab reads its ticket list from SQLite, exposes local/analyse-pending state and reloads on focus or pull-to-refresh.
- Repository acceptance coverage closes and reopens a file-backed SQLite database, then verifies that the receipt, image reference and lines remain available.

## Verification evidence

| Check                | Result                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------- |
| Persistent filename  | One UUID capture produces a stable `.jpg` destination under `waste-receipts`                 |
| Failed persistence   | A copy failure never returns a durable capture result                                        |
| Repository checks    | Structure, lint, strict TypeScript and 230 tests pass                                        |
| Expo compatibility   | Expo Doctor passes all 21 checks with SDK-compatible camera and image-picker packages        |
| Native configuration | Expo public config resolves the French camera and photo-library permissions                  |
| Bundle acceptance    | Expo export completes for both iOS and Android                                               |
| Web boundary         | The browser exposes an explicit native-only state instead of attempting local camera storage |

## Next work

1. Merge M4-T03 and validate that a newly captured or imported ticket remains listed after force-closing and reopening the target iPhone Air app.
2. Implement the M4-T04 offline upload queue without blocking local capture or deleting an unsynchronized source image.
