# Mobile application

Expo SDK 57 / React Native 0.86 / React 19.2, Expo Router and NativeWind v4.

From the repository root:

```sh
pnpm --filter @fl-copilot/mobile ios
pnpm --filter @fl-copilot/mobile android
pnpm dev:mobile
pnpm --filter @fl-copilot/mobile export
```

Copy `.env.example` to `.env.local` and set `EXPO_PUBLIC_API_URL` to the API address reachable by the simulator or physical device. EAS build profiles live beside this package in `eas.json`; invoke them through the root `eas:*` scripts after `nvm use`.

All five tabs currently present French empty states; the native About sheet can be opened and closed from Plus. Forms dependencies (React Hook Form, Zod and their resolver) are installed for the upcoming authentication flow.

`src/components/ui.tsx` contains the M0-T03 primitives. Text scales with the system font settings, content scrolls, buttons have at least 48-point touch targets and state badges include text and icons. Verify VoiceOver/TalkBack and maximum text sizes on real devices before accepting the design-system accessibility gate.

No operational state is stored in Zustand or TanStack Query. M0-T06 opens native SQLite before rendering the application, runs ordered transactional migrations and exposes the typed Drizzle client through `DatabaseProvider`. The initial schema contains metadata, inbox state, outbox commands, conflicts, local jobs and local file metadata. Migration failure blocks the application behind a recoverable diagnostic; no sync success state is fabricated in this shell.

The web build bypasses native SQLite because it is a visual preview. Native iOS/Android builds use `fl-copilot.db`; repositories added by later tickets must consume the provider rather than issuing ad hoc SQL from screens.

M0-T07 generates `deviceId` with Expo Crypto and persists it in local metadata. It survives ordinary restarts and is regenerated after a clean installation. The initialized database context exposes it for authentication and synchronization envelopes. M0-T08 adds the email-code flow and secure session persistence. M0-T09 separates development, staging and production configuration; staging and production require their own EAS-managed API URL.

See the root README and `docs/progress/M0_FOUNDATION.md` for setup and validation evidence.

## Browser preview

Run `pnpm preview:web` at the repository root and open http://localhost:8087. This is a compiled preview of the native shell; it does not validate mobile platform capabilities.

The optional experimental typed-route generator is disabled after it stalled local Metro startup with this toolchain. TypeScript remains strict. Metro uses its Node watcher by default; set `FL_USE_WATCHMAN=1` only with a compatible Watchman installation.
