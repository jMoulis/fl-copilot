# UX/UI foundations

Date: 2026-10-04.

## Purpose

This cross-cutting track gives the native product a coherent visual and interaction foundation before `Aujourd’hui` becomes the reference screen for M3 and later field workflows.

The direction favors fast one-handed use in a store: calm neutral surfaces, strong hierarchy, explicit trust states, large touch targets and concise French labels.

## Initial foundation

- Central native color tokens cover the brand surface plus neutral, positive, warning, critical, informational and pending states.
- Tailwind tokens mirror the native color values for consistent class-based and JavaScript-driven styling.
- Synchronization and trust badges use an icon, a label and a semantic surface; meaning never depends on color alone.
- The selected bottom tab uses a filled icon while retaining visible labels and Dynamic Type-aware height.
- A reusable menu row provides a 64-point minimum target, icon, description and navigation affordance.
- Empty states can expose clear primary and secondary recovery actions.

## Information architecture applied

`Plus` now separates:

1. department data (`Produits`, `Imports Mercalys`);
2. synchronization status and exceptions;
3. account and application information;
4. development-only diagnostics, hidden in production.

The empty `Aujourd’hui` state now explains why no day can be analyzed and links directly to the Mercalys import flow.

## Verification

- monorepo lint and strict TypeScript pass;
- 152 automated tests pass and 10 MongoDB capability tests remain intentionally skipped;
- Expo exports complete for iOS and Android;
- accessibility semantics retain text labels, icons and minimum touch targets.

## Device acceptance still required

On the target iPhone, verify:

- all five tab labels remain readable and only the five canonical tabs appear;
- `Plus` is understandable without prior knowledge of M2 development tools;
- the semantic badges remain legible in light mode and at increased text size;
- the `Aujourd’hui` empty-state actions open the correct screens;
- VoiceOver reads menu rows and status badges with useful labels.

The M3 Today implementation will reuse these foundations and add KPI, priority, movement and data-quality components as their actual data contracts become available.
