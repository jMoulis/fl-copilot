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

## Verification evidence

| Check                | Result                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------- |
| Persistent filename  | One UUID capture produces a stable `.jpg` destination under `waste-receipts`                  |
| Failed persistence   | A copy failure never returns a durable capture result                                         |
| Repository checks    | Structure, lint, strict TypeScript and 221 tests pass                                         |
| Expo compatibility   | Expo Doctor passes all 21 checks with `expo-camera` 57.0.6                                    |
| Native configuration | Expo public config resolves the French camera permission and disables Android audio recording |
| Bundle acceptance    | Expo export completes for both iOS and Android                                                |
| Web boundary         | The browser exposes an explicit native-only state instead of attempting local camera storage  |

## Next work

1. Merge M4-T01 and validate permission, framing, retake and durable success on the target iPhone Air through a new native staging build.
2. Implement M4-T02 image import through `expo-image-picker` into the same app-owned persistent source directory.
3. Implement the restart-safe `waste_receipts` and `waste_lines` local model in M4-T03 before upload or AI extraction begins.
