# Fruits & Légumes Copilot — App Icon Pack

Approved direction: **minimal leaf monogram**, forest-green background, two stylized green leaves, orange dot and warm red/orange leaf. This pack is a **clean vector reconstruction** inspired by the selected screenshot, not an exact extraction of the original design. Please review the preview before release.

## Files

- `assets/icon.png` — 1024×1024 opaque square for Expo iOS and base icon. Do not pre-round: the OS masks it.
- `assets/adaptive-icon.png` — transparent 1024×1024 Android foreground, safely inset.
- `assets/monochrome-icon.png` — white transparent Android themed icon.
- `assets/splash-icon.png` — transparent 1024×1024 splash artwork.
- `assets/icon-light.png` — optional light variant, not default.
- Matching `.svg` files — editable vector masters.
- `preview.png` — overview.
- `app-config.example.json` — suggested Expo settings.

## Expo configuration

Copy PNGs into your project's assets folder, then adjust paths in `app.json` or `app.config.ts`. For modern Expo versions, the splash screen uses the `expo-splash-screen` config plugin. Preserve existing plugins/settings.

## QA checklist

1. Check on a real iPhone and Android device at home-screen size.
2. Confirm Android adaptive mask never clips the symbol.
3. Confirm Android themed monochrome icon.
4. Validate launch screen and icon after a clean native rebuild.
5. Avoid embedding text or rounded corners into the iOS source PNG.
6. Use existing bundle/package IDs, do not replace them.
