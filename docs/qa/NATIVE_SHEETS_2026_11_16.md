# Native interactive sheets — 16 November 2026

## Correction and choice

Build 70 fixed the stationary scrim and slide animation, but its PanResponder
only requested closure after release. The owner supplied a reference showing
continuous direct manipulation and questioned that component choice. A generic
native Modal is not itself an interactive bottom-sheet implementation.

The iPhone implementation now delegates presentation and gesture physics to the
SDK 57 Expo UI SwiftUI BottomSheet. Expo UI 57.0.26 was already resolved through
Expo Router; the mobile package now declares its dependency explicitly. No SDK,
Reanimated, Gesture Handler, global Mac toolchain or provider upgrade is needed.
The existing public UI properties, children, controller state and scroll refs
remain local. No conversion into 32 new navigation routes or shared form registry
is introduced. Android/web retain their existing component via Metro's platform
file resolution; that fallback is not claimed as native Android qualification.

The SwiftUI API is used directly because its onDismiss is dispatched after the
native presentation finishes. The current SDK 57 universal wrapper reports its
onDismiss from the earlier isPresented change, which cannot release a queued
native file picker safely. RNHostView explicitly hosts existing React Native
controls in the sheet's own native window.

The sheet uses the system medium/large detents. RNHostView accepts the native
available size, with a bounded flex body and fixed header/footer. It does not
combine fitToContents with a vertically self-sized RN ScrollView: the exploratory
version exposed a clipped last action. The corrected native recipe proves the
expansion and access to both bottom actions. iOS owns the keyboard safe area;
there is no additional iPhone KeyboardAvoidingView or JavaScript height cap.

Existing RN text inputs need one viewport adapter: the scroll body measures its
focused field against its actual native bounds, above the fixed footer. It runs
on local focus/layout and native keyboard completion, after UIKit's focus scroll.
Measurements share a window coordinate system and stale callbacks are discarded.
There is no guessed keyboard height, delayed retry or per-field exception. The
native recipe exposed this ordering issue; manually invoking a callback was used
only to diagnose it and is not relabeled as natural interaction acceptance.

## Existing close guards

Nine guarded locations expose the same existing dirty/busy predicate as
`dismissible`. No new business restriction is added. Native interactive dismissal
is disabled for such a state; iOS rebounds instead of hiding unsaved content.
The fixed X still invokes the existing owner's close handler and confirmation.
Expo does not expose a callback for an attempted blocked swipe, so the app does
not fabricate a confirmation event after the sheet has already closed.

Actual native dismissal still gates Mercalys, Imports and chat picker queues.
The outgoing title/body/footer remain retained until that event; a quick reopen
waits for it. References to outgoing content are then released. No save or
synchronization is caused by presenting or dragging the sheet.

## Verification boundaries

The mounted tests exercise native sheet configuration, existing close guards,
content retained through dismissal, queued completion exactly once and rapid
reopen. They do not prove native finger tracking or keyboard layout.

The exploratory handle recipe uses real XCTest press/drag gestures with two-second
holds. Timestamped host screenshots complete before the native gesture returns;
visual inspection confirms the panel is displaced before release. Small drag
returns to the same rest position and large drag dismisses. Body/scroll, keyboard
and nested picker journeys remain distinct gates. No TestFlight delivery or
physical iPhone acceptance follows solely from the exploratory result.

Private recordings, source fingerprints, preliminary diagnostics and delivery
receipts live outside the repo under workspace
`maintenance/sheet-gesture-2026-11-16/`. Previous native tests that only checked
post-release dismissal are not relabeled as continuous-gesture proof.

## Primary references

- https://docs.expo.dev/versions/v57.0.0/sdk/ui/universal/bottomsheet/
- https://github.com/expo/expo/tree/sdk-57/packages/expo-ui/src/swift-ui/BottomSheet
- https://github.com/expo/expo/blob/sdk-57/packages/expo-ui/ios/BottomSheetView.swift
- https://docs.expo.dev/versions/v57.0.0/sdk/ui/swift-ui/rnhostview/
