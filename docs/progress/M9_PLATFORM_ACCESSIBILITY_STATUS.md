# M9 — broader platform and accessibility qualification

## Owner decision — 5 November 2026

The owner removes Android work and the dedicated accessibility qualification from the current M8 iPhone pilot. Keep them here as deferred work, not completed or silently dropped requirements. M9 is not started and has no committed delivery date. It does not reopen accepted M0–M7 business recipes or add new product features.

## M9-A01 — dedicated accessibility qualification, deferred

Transferred from former M8-T07: VoiceOver/TalkBack, enlarged text, focus/keyboard behavior, touch targets, contrast and understandable status labels. Reuse existing accessible components and fixes; do not remove them. This dedicated acceptance pass is not required to close M8.

## M9-A02 — Android qualification and distribution, deferred

Transfer Android-specific work from the former M8 matrix: local SQLite upgrades/recovery, interruption and two-device cases where Android participates, retained original access, representative device performance/network/battery, notification permissions/tokens/deep links, Android release profiles and Google Play internal distribution. Reuse canonical shared logic, contracts and existing tests. Shared CI remains enabled; no Android runtime removal or platform redesign is authorized by this deferral.

## Boundary with M8

[M8](M8_HARDENING_STATUS.md) retains the four reliability pillars (data protection; interruptions/concurrency; performance/consumption; security/monitoring/release) **and useful iPhone notifications, including chat completion**. Two-device M8 checks can use two authorized iOS installations; deferring Android does not waive conflict recovery or data protection. Current M8 evidence is reused when M9 starts, with only platform-specific or changed behavior requalified.

No deferred item is counted as passed. Full multi-platform/accessibility qualification is distinct from acceptance of the limited iPhone pilot.
